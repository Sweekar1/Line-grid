#!/usr/bin/env python3
"""
Line Grid — local backend for YouTube search + audio streams + lyrics.

Run:  python3 server.py
Then open http://127.0.0.1:8765/

Personal use only. Extracting YouTube streams may violate YouTube ToS.
"""

from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

import httpx
import yt_dlp
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask

app = FastAPI(title="Line Grid API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

YDL_SEARCH_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "extract_flat": True,
    "default_search": "ytsearch",
    "noplaylist": True,
}

YDL_STREAM_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "format": "bestaudio[ext=m4a]/bestaudio/best",
    "noplaylist": True,
    "extractor_args": {"youtube": {"player_client": ["android", "web", "ios"]}},
}


def _run_ydl(opts: dict, url: str) -> dict:
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=False)


@app.get("/api/search")
async def search(q: str = Query(..., min_length=1), limit: int = Query(8, ge=1, le=20)):
    """Search YouTube for tracks."""
    query = q.strip()
    if not query:
        raise HTTPException(400, "Empty query")

    # Prefer official audio / lyric results when possible
    search_q = f"ytsearch{limit}:{query}"

    try:
        info = await asyncio.to_thread(_run_ydl, YDL_SEARCH_OPTS, search_q)
    except Exception as e:
        raise HTTPException(502, f"Search failed: {e}") from e

    results = []
    for entry in info.get("entries") or []:
        if not entry:
            continue
        vid = entry.get("id")
        if not vid:
            continue
        title = entry.get("title") or "Unknown"
        uploader = entry.get("uploader") or entry.get("channel") or "Unknown"
        duration = entry.get("duration")
        thumb = None
        thumbs = entry.get("thumbnails") or []
        if thumbs:
            thumb = thumbs[-1].get("url")
        elif entry.get("thumbnail"):
            thumb = entry["thumbnail"]

        results.append(
            {
                "id": vid,
                "title": title,
                "artist": uploader,
                "duration": float(duration) if duration else None,
                "thumbnail": thumb,
                "url": f"https://www.youtube.com/watch?v={vid}",
            }
        )

    return {"query": query, "results": results}


@app.get("/api/stream/{video_id}")
async def stream_info(video_id: str):
    """Return metadata + a direct (short-lived) audio URL."""
    if not re.fullmatch(r"[\w-]{6,20}", video_id):
        raise HTTPException(400, "Invalid video id")

    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        info = await asyncio.to_thread(_run_ydl, YDL_STREAM_OPTS, url)
    except Exception as e:
        raise HTTPException(502, f"Could not extract stream: {e}") from e

    stream_url = info.get("url")
    if not stream_url:
        # pick first audio-only format
        for f in info.get("formats") or []:
            if f.get("url") and f.get("acodec") not in (None, "none") and f.get("vcodec") in (None, "none"):
                stream_url = f["url"]
                break
    if not stream_url:
        raise HTTPException(404, "No audio stream found")

    return {
        "id": video_id,
        "title": info.get("title") or "Unknown",
        "artist": info.get("uploader") or info.get("channel") or "Unknown",
        "duration": float(info.get("duration") or 0),
        "thumbnail": info.get("thumbnail"),
        "stream_url": stream_url,
        "proxy_url": f"/api/proxy/{video_id}",
        "ext": info.get("ext") or "m4a",
    }


@app.get("/api/proxy/{video_id}")
async def proxy_audio(video_id: str, request: Request):
    """
    Proxy the audio stream so the browser can play it without CORS issues.
    Re-extracts the URL each time (they expire).
    """
    if not re.fullmatch(r"[\w-]{6,20}", video_id):
        raise HTTPException(400, "Invalid video id")

    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        info = await asyncio.to_thread(_run_ydl, YDL_STREAM_OPTS, url)
    except Exception as e:
        raise HTTPException(502, f"Could not extract stream: {e}") from e

    stream_url = info.get("url")
    if not stream_url:
        for f in info.get("formats") or []:
            if f.get("url") and f.get("acodec") not in (None, "none") and f.get("vcodec") in (None, "none"):
                stream_url = f["url"]
                break
    if not stream_url:
        raise HTTPException(404, "No audio stream found")

    # Forward Range header for seeking
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
    }
    range_header = request.headers.get("range")
    if range_header:
        headers["Range"] = range_header

    client = httpx.AsyncClient(follow_redirects=True, timeout=60.0)
    try:
        upstream = await client.send(
            client.build_request("GET", stream_url, headers=headers),
            stream=True,
        )
    except Exception as e:
        await client.aclose()
        raise HTTPException(502, f"Upstream error: {e}") from e

    if upstream.status_code not in (200, 206):
        await upstream.aclose()
        await client.aclose()
        raise HTTPException(upstream.status_code, "Upstream returned error")

    media_type = upstream.headers.get("content-type") or "audio/mp4"
    out_headers = {}
    for h in ("content-length", "content-range", "accept-ranges"):
        if h in upstream.headers:
            out_headers[h] = upstream.headers[h]

    async def body():
        try:
            async for chunk in upstream.aiter_bytes(65536):
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        body(),
        status_code=upstream.status_code,
        media_type=media_type,
        headers=out_headers,
        background=BackgroundTask(lambda: None),
    )


@app.get("/api/lyrics")
async def lyrics(
    title: str = Query(...),
    artist: str = Query(""),
    duration: Optional[float] = Query(None),
):
    """Fetch synced lyrics from LRCLIB (free, no key)."""
    params: dict[str, Any] = {
        "track_name": title.strip(),
        "artist_name": (artist or "").strip() or " ",
    }
    if duration and duration > 0:
        params["duration"] = int(round(duration))

    headers = {"User-Agent": "LineGrid/1.0 (personal player)"}

    async with httpx.AsyncClient(timeout=8.0) as client:
        # Exact match first
        r = await client.get("https://lrclib.net/api/get", params=params, headers=headers)
        data = None
        if r.status_code == 200:
            data = r.json()
        else:
            # Fallback search
            r2 = await client.get(
                "https://lrclib.net/api/search",
                params={"q": f"{artist} {title}".strip()},
                headers=headers,
            )
            if r2.status_code == 200:
                candidates = r2.json() or []
                if candidates:
                    # pick closest duration if available
                    best = candidates[0]
                    if duration:
                        best = min(
                            candidates,
                            key=lambda c: abs((c.get("duration") or 0) - duration),
                        )
                    data = best

    if not data:
        return {"found": False, "synced": [], "plain": None}

    synced_raw = data.get("syncedLyrics") or ""
    plain = data.get("plainLyrics")
    lines = []
    for line in synced_raw.splitlines():
        m = re.match(r"\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)", line.strip())
        if not m:
            continue
        mins, secs, text = m.groups()
        t = int(mins) * 60 + float(secs)
        text = text.strip()
        if text:
            lines.append({"t": round(t, 2), "text": text})

    return {
        "found": bool(lines or plain),
        "synced": lines,
        "plain": plain,
        "source": "lrclib",
        "meta": {
            "title": data.get("trackName"),
            "artist": data.get("artistName"),
            "album": data.get("albumName"),
            "duration": data.get("duration"),
        },
    }


# Health check endpoint
@app.get("/")
async def health_check():
    """Health check endpoint that returns a simple response."""
    index_file = Path("index.html")
    if index_file.exists():
        return FileResponse(index_file, media_type="text/html")
    else:
        return {
            "status": "ok",
            "message": "Line Grid API is running",
            "info": "Visit /api/search?q=your_query to search YouTube"
        }


# Serve static files AFTER defining the routes above
# This ensures that explicit routes take priority
app.mount("/", StaticFiles(directory=".", html=True), name="static")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    host = "0.0.0.0"
    
    print(f"\n{'='*60}")
    print(f"  Line Grid API Server")
    print(f"  Running on http://{host}:{port}/")
    print(f"  Press CTRL+C to quit")
    print(f"{'='*60}\n")
    
    import uvicorn
    uvicorn.run(app, host=host, port=port, log_level="info")
