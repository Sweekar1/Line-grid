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
from fastapi.responses import StreamingResponse, FileResponse, Response
from starlette.background import BackgroundTask

app = FastAPI(title="Line Grid API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Get YouTube API key from environment
YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "")

YDL_SEARCH_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "extract_flat": True,
    "default_search": "ytsearch",
    "noplaylist": True,
    "socket_timeout": 30,
    "http_headers": {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    },
}

# Use innertube extractor for better compatibility
YDL_STREAM_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "format": "bestaudio[ext=m4a]/bestaudio/best",
    "noplaylist": True,
    "socket_timeout": 30,
    "youtube_include_dash_manifest": False,
    "extractor_args": {
        "youtube": {
            "player_client": ["web_embedded"],  # Use web_embedded for innertube
            "player_skip_js_execution": False,
        }
    },
    "http_headers": {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    },
}

YDL_PLAYLIST_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "extract_flat": "in_playlist",
    "playlistend": 50,
    "noplaylist": False,
    "socket_timeout": 30,
    "http_headers": {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    },
}


def _run_ydl(opts: dict, url: str) -> dict:
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=False)


async def _extract_stream_with_innertube(url: str, max_retries: int = 3) -> dict:
    """Extract stream using innertube (unofficial YouTube API)."""
    last_error = None
    
    # Try different player clients
    player_clients = ["web_embedded", "web", "android", "ios"]
    
    for client in player_clients:
        for attempt in range(max_retries):
            try:
                opts = YDL_STREAM_OPTS.copy()
                opts["extractor_args"] = {
                    "youtube": {
                        "player_client": [client],
                        "player_skip_js_execution": False,
                    }
                }
                
                print(f"Trying {client} client, attempt {attempt + 1}/{max_retries}")
                info = await asyncio.wait_for(
                    asyncio.to_thread(_run_ydl, opts, url),
                    timeout=25.0
                )
                print(f"✓ Success with {client} client")
                return info
            except asyncio.TimeoutError:
                last_error = "Timeout"
                print(f"✗ {client} attempt {attempt + 1} timed out")
                if attempt < max_retries - 1:
                    await asyncio.sleep(1)
                continue
            except Exception as e:
                last_error = str(e)
                print(f"✗ {client} attempt {attempt + 1} failed: {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(1)
                continue
    
    raise Exception(f"Failed with all clients. Last error: {last_error}")


@app.get("/api/search")
async def search(q: str = Query(..., min_length=1), limit: int = Query(8, ge=1, le=20)):
    """Search YouTube for tracks."""
    query = q.strip()
    if not query:
        raise HTTPException(400, "Empty query")

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


@app.get("/api/playlist/youtube")
async def youtube_playlist(url: str = Query(...)):
    """Extract songs from a YouTube playlist."""
    raw = (url or "").strip()
    # Accept watch?v=…&list=… or playlist?list=…
    m = re.search(r"[?&]list=([\w-]+)", raw)
    if m:
        playlist_url = f"https://www.youtube.com/playlist?list={m.group(1)}"
    elif "/playlist" in raw.lower():
        playlist_url = raw
    else:
        raise HTTPException(
            400,
            "Not a playlist URL. It must contain list=… (playlist id).",
        )

    try:
        info = await asyncio.to_thread(_run_ydl, YDL_PLAYLIST_OPTS, playlist_url)
    except Exception as e:
        raise HTTPException(502, f"Failed to extract playlist: {e}") from e

    if not info:
        raise HTTPException(404, "Playlist not found or private")

    results = []
    for entry in info.get("entries") or []:
        if not entry:
            continue
        if entry.get("_type") == "playlist":
            continue
        vid = entry.get("id")
        if not vid or not re.fullmatch(r"[\w-]{6,20}", str(vid)):
            continue
        title = entry.get("title") or "Unknown"
        if title in ("[Deleted video]", "[Private video]"):
            continue
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

    if not results:
        raise HTTPException(404, "No playable videos in this playlist")

    return {
        "playlist": True,
        "title": info.get("title") or "Playlist",
        "count": len(results),
        "results": results,
    }


@app.get("/api/playlist/spotify")
async def spotify_playlist(url: str = Query(...)):
    """Extract songs from a Spotify playlist (convert to YouTube search)."""
    raise HTTPException(501, "Spotify playlist support requires additional setup. Use YouTube playlists instead.")


@app.get("/api/stream/{video_id}")
async def stream_info(video_id: str):
    """Return metadata + a direct (short-lived) audio URL."""
    if not re.fullmatch(r"[\w-]{6,20}", video_id):
        raise HTTPException(400, "Invalid video id")

    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        info = await _extract_stream_with_innertube(url)
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
        info = await _extract_stream_with_innertube(url)
    except Exception as e:
        print(f"Extraction error for {video_id}: {e}")
        raise HTTPException(502, f"Could not extract stream") from e

    stream_url = info.get("url")
    if not stream_url:
        for f in info.get("formats") or []:
            if f.get("url") and f.get("acodec") not in (None, "none") and f.get("vcodec") in (None, "none"):
                stream_url = f["url"]
                break
    if not stream_url:
        raise HTTPException(404, "No audio stream found")

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
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
        print(f"Upstream error for {video_id}: {e}")
        raise HTTPException(502, f"Upstream error") from e

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
    """Fetch synced lyrics from LRCLIB with robust cleanup for YouTube titles."""
    headers = {"User-Agent": "LineGrid/1.0 (personal player)"}

    def clean_noise(s: str) -> str:
        s = re.sub(r"\s*[\(\[\{].*?[\)\]\}]", " ", s)
        s = re.sub(
            r"\b(official|audio|video|lyrics?|visualizer|mv|hd|4k|remaster(ed)?|"
            r"topic|sped\s*up|slowed|nightcore|tradu[cç][aã]o|legendado|"
            r"subtitles?|full\s*version|single\s*version)\b",
            " ",
            s,
            flags=re.I,
        )
        s = re.sub(r"\s{2,}", " ", s).strip(" -–—|/\\")
        return s.strip()

    raw_title = (title or "").strip()
    raw_artist = (artist or "").strip()

    # Parse "Artist - Track" / "Artist – Track" from YouTube titles
    parsed_artist, parsed_title = "", raw_title
    m = re.match(r"^(.{2,60}?)\s*[-–—]\s*(.+)$", raw_title)
    if m:
        parsed_artist, parsed_title = m.group(1).strip(), m.group(2).strip()

    track_candidates = []
    for t in (
        parsed_title,
        raw_title,
        re.split(r"\s*/\s*", parsed_title)[0] if parsed_title else "",
        re.split(r"\s*/\s*", parsed_title)[-1] if "/" in (parsed_title or "") else "",
    ):
        c = clean_noise(t)
        if c and c not in track_candidates:
            track_candidates.append(c)

    artist_candidates = []
    for a in (parsed_artist, raw_artist):
        c = clean_noise(a)
        # skip obvious channel-only noise if we have a better parse
        if c and c not in artist_candidates:
            artist_candidates.append(c)
    if not artist_candidates:
        artist_candidates = [" "]

    search_queries = []
    for a in artist_candidates:
        for t in track_candidates:
            search_queries.append(f"{a} {t}".strip())
            search_queries.append(t)
    # unique preserve order
    seen = set()
    search_queries = [q for q in search_queries if q and not (q in seen or seen.add(q))]

    async def try_get(client: httpx.AsyncClient, track_name: str, artist_name: str):
        params: dict[str, Any] = {
            "track_name": track_name,
            "artist_name": artist_name or " ",
        }
        # Only send duration on exact get as a soft hint; skip if it causes misses
        r = await client.get("https://lrclib.net/api/get", params=params, headers=headers)
        if r.status_code == 200:
            return r.json()
        return None

    async def try_search(client: httpx.AsyncClient, q: str):
        r = await client.get(
            "https://lrclib.net/api/search",
            params={"q": q},
            headers=headers,
        )
        if r.status_code != 200:
            return None
        candidates = r.json() or []
        if not candidates:
            return None

        def score(c: dict) -> float:
            s = 0.0
            if c.get("syncedLyrics"):
                s += 100
            if c.get("plainLyrics"):
                s += 10
            if duration and c.get("duration"):
                s -= min(40, abs(float(c["duration"]) - duration) * 0.5)
            # prefer matching artist tokens
            an = (c.get("artistName") or "").lower()
            tn = (c.get("trackName") or "").lower()
            for a in artist_candidates:
                if a and a.lower() in an:
                    s += 25
            for t in track_candidates:
                if t and t.lower()[:8] in tn:
                    s += 15
            return s

        candidates = sorted(candidates, key=score, reverse=True)
        return candidates[0]

    data = None
    async with httpx.AsyncClient(timeout=12.0) as client:
        # 1) exact get with cleaned pairs
        for a in artist_candidates:
            for t in track_candidates:
                data = await try_get(client, t, a)
                if data and (data.get("syncedLyrics") or data.get("plainLyrics")):
                    break
            if data and (data.get("syncedLyrics") or data.get("plainLyrics")):
                break

        # 2) search fallbacks
        if not data or not (data.get("syncedLyrics") or data.get("plainLyrics")):
            for q in search_queries[:12]:
                found = await try_search(client, q)
                if found and (found.get("syncedLyrics") or found.get("plainLyrics")):
                    data = found
                    break
                if found and not data:
                    data = found

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




@app.get("/api/img")
async def proxy_image(url: str = Query(..., min_length=8)):
    """Same-origin image proxy so the player can sample album color."""
    from urllib.parse import urlparse

    raw = url.strip()
    if not raw.startswith(("https://", "http://")):
        raise HTTPException(400, "Invalid image url")
    host = (urlparse(raw).hostname or "").lower()
    allowed = (
        "i.ytimg.com",
        "yt3.ggpht.com",
        "yt3.googleusercontent.com",
        "lh3.googleusercontent.com",
        "img.youtube.com",
        "i9.ytimg.com",
    )
    if not any(host == a or host.endswith("." + a) for a in allowed):
        raise HTTPException(400, "Host not allowed")
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=12.0) as client:
            r = await client.get(
                raw,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Accept": "image/*,*/*;q=0.8",
                },
            )
    except Exception as e:
        raise HTTPException(502, f"Image fetch failed: {e}") from e
    if r.status_code != 200 or not r.content:
        raise HTTPException(404, "Image not found")
    media = r.headers.get("content-type") or "image/jpeg"
    if ";" in media:
        media = media.split(";", 1)[0].strip()
    if not media.startswith("image/"):
        media = "image/jpeg"
    return Response(content=r.content, media_type=media, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/")
async def serve_index():
    """Serve index.html from the application root."""
    index_path = Path("/app/index.html")
    if not index_path.exists():
        index_path = Path("./index.html")
    if index_path.exists():
        return FileResponse(index_path, media_type="text/html")
    return {"error": "index.html not found"}


@app.get("/{file_path:path}")
async def serve_static(file_path: str):
    """Serve any other static files (CSS, JS, images, etc.)."""
    if ".." in file_path:
        raise HTTPException(400, "Invalid path")
    
    file = Path(file_path)
    
    for base_path in [Path("/app"), Path(".")]:
        full_path = (base_path / file).resolve()
        
        try:
            full_path.relative_to(base_path.resolve())
        except ValueError:
            continue
        
        if full_path.is_file():
            media_type = "application/octet-stream"
            if file_path.endswith(".css"):
                media_type = "text/css"
            elif file_path.endswith(".js"):
                media_type = "application/javascript"
            elif file_path.endswith(".html"):
                media_type = "text/html"
            elif file_path.endswith(".json"):
                media_type = "application/json"
            elif file_path.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
                media_type = "image/" + file_path.split(".")[-1]
            
            return FileResponse(full_path, media_type=media_type)
    
    raise HTTPException(404, f"File not found: {file_path}")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8080"))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"\n  Line Grid server → http://{host}:{port}/")
    if YOUTUBE_API_KEY:
        print(f"  ✓ YouTube API Key configured")
    else:
        print(f"  ⚠ No YouTube API Key")
    print(f"  ✓ Using innertube for extraction")
    print()
    uvicorn.run(app, host=host, port=port, log_level="info")
