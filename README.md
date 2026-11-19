# LocalTube — Personal YouTube Downloader

A personal-use YouTube video and audio downloader that runs locally on your PC (`127.0.0.1:5000`).

## Stack
- **Backend:** Python 3.10+, Flask, `yt-dlp`, FFmpeg
- **Frontend:** Single-page HTML/CSS/JS (zero frameworks)

## Prerequisites
1. **Python 3.10+** — https://www.python.org/downloads/
2. **FFmpeg** (must be available on your system `PATH`):
   - **Windows:** `winget install Gyan.FFmpeg` (then open a new terminal)
   - **macOS:** `brew install ffmpeg`
   - **Linux (Ubuntu/Debian):** `sudo apt update && sudo apt install -y ffmpeg`

Verify FFmpeg is installed:
```bash
ffmpeg -version
```

## Installation
```bash
python -m venv .venv
```

Activate the virtual environment:
- **Windows (PowerShell):** `.\.venv\Scripts\Activate.ps1`
- **macOS / Linux:** `source .venv/bin/activate`

Install Python dependencies:
```bash
pip install -r requirements.txt
```

## Run Locally
```bash
python app.py
```

Open your browser to:
```
http://127.0.0.1:5000
```

## Keeping yt-dlp Updated
YouTube updates its player signatures regularly. If downloads stop working, update `yt-dlp`:
```bash
pip install -U yt-dlp
```
