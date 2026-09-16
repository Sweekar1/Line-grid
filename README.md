# Line Grid — synced lyric player + YouTube search

## Quick start
make sure python is installed 
For linux run in terminal: 
```bash
cd line-grid
pip install yt-dlp fastapi "uvicorn[standard]" httpx
python3 server.py
```
For Windows run in powershell: 
```bash
cd line-grid
pip install yt-dlp fastapi "uvicorn[standard]" httpx
python server.py
```

Open **http://127.0.0.1:8765/**


## Features

- Original 6 synthesised demo tracks (no download)
- **Search YouTube** from the Tracks panel
- Click a result → plays audio (proxied by the local server, ad-free stream)
- **Synced lyrics** via [LRCLIB](https://lrclib.net) when available
- Light / dark theme toggle (dark by default)

## Notes

- You need the **local server** running for search & online playback. Opening `index.html` as a file only works for the demo tracks.
- Stream extraction uses **yt-dlp**. Some videos may be region-blocked or unavailable.
- Extracting YouTube audio can conflict with YouTube’s Terms of Service — use only for personal listening.
- Stream URLs expire; the proxy re-extracts on each play/seek.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/search?q=…` | YouTube search results |
| `GET /api/stream/{id}` | Metadata + direct stream URL |
| `GET /api/proxy/{id}` | Proxied audio (recommended for the player) |
| `GET /api/lyrics?title=…&artist=…` | Synced lyrics from LRCLIB |
