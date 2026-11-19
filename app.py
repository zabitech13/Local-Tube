"""
LocalTube — Personal-use local YouTube downloader utility.
Stack: Python Flask + yt-dlp + FFmpeg, bound strictly to 127.0.0.1.
"""

from __future__ import annotations

import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from flask import Flask, abort, jsonify, render_template, request, send_file
import yt_dlp
from yt_dlp.utils import DownloadError

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

HOST = "127.0.0.1"
PORT = int(os.environ.get("LOCALTUBE_PORT", "5000"))
TEMP_ROOT = Path(tempfile.gettempdir()) / "localtube_downloads"
TEMP_ROOT.mkdir(parents=True, exist_ok=True)
JOB_TTL_SECONDS = 2 * 60 * 60  # Clean up completed temp downloads after 2 hours

ALLOWED_YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
}

ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")
INVALID_FILENAME_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False

JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def strip_ansi(text: str) -> str:
    return ANSI_ESCAPE_RE.sub("", text or "").strip()


def validate_youtube_url(raw_url: str) -> tuple[bool, str]:
    url = (raw_url or "").strip()
    if not url:
        return False, "Please enter a YouTube URL."

    try:
        parsed = urlparse(url)
    except ValueError:
        return False, "The URL format is invalid. Please paste a full YouTube link."

    if parsed.scheme not in ("http", "https"):
        return False, "URL must start with http:// or https://."

    host = (parsed.hostname or "").lower()
    if host not in ALLOWED_YOUTUBE_HOSTS:
        return (
            False,
            "That does not look like a YouTube link. Supported domains: youtube.com, youtu.be, and music.youtube.com.",
        )

    if host in ("youtu.be", "www.youtu.be"):
        if not parsed.path.strip("/"):
            return False, "This youtu.be link is missing a video ID."
    else:
        path = parsed.path or ""
        valid_paths = ("/watch", "/shorts/", "/embed/", "/live/", "/v/")
        if not any(path.startswith(prefix) for prefix in valid_paths):
            return False, "Please paste a link to a specific YouTube video (not a channel or home page)."

    return True, url


def friendly_error_message(raw_error: str) -> str:
    clean = strip_ansi(str(raw_error))
    lower = clean.lower()

    if "private video" in lower or "sign in if you've been granted access" in lower:
        return "This video is private and cannot be downloaded without authorization."
    if "members-only" in lower or "join this channel" in lower or "available to this channel's members" in lower:
        return "This video is restricted to channel members only."
    if "sign in to confirm your age" in lower or "age-restricted" in lower:
        return "This video is age-restricted and requires signed-in browser cookies."
    if "not available in your country" in lower or "uploader has not made this video available" in lower:
        return "This video is geo-restricted and not available in your region."
    if "this live event will begin" in lower or "premieres in" in lower:
        return "This is an upcoming premiere or scheduled live stream and cannot be downloaded yet."
    if "video unavailable" in lower or "this video has been removed" in lower or "does not exist" in lower:
        return "This video is unavailable, deleted, or the link is incorrect."
    if "incomplete youtube id" in lower or "is not a valid url" in lower or "unsupported url" in lower:
        return "Invalid YouTube URL. Please check the link and try again."
    if "ffmpeg" in lower and ("not found" in lower or "not installed" in lower or "ffprobe" in lower):
        return "FFmpeg was not found on your system PATH. Install FFmpeg and restart app.py."
    if "sign in to confirm you're not a bot" in lower or "sign in to confirm you’re not a bot" in lower:
        return "YouTube requested bot verification. Update yt-dlp (pip install -U yt-dlp) or retry in a moment."
    if "timed out" in lower or "temporary failure in name resolution" in lower or "failed to establish a new connection" in lower:
        return "Could not connect to YouTube. Check your internet connection and try again."

    # Strip leading "ERROR: [youtube] <id>:" noise if present
    simplified = re.sub(r"^ERROR:\s*(\[[^\]]+\]\s*[^:]+:\s*)?", "", clean, flags=re.IGNORECASE).strip()
    return simplified or "An unexpected error occurred while communicating with YouTube."


def format_duration(seconds: int | float | None) -> str:
    if seconds is None:
        return "Unknown"
    total = max(0, int(round(seconds)))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def format_bytes(num_bytes: int | float | None) -> str:
    if not num_bytes or num_bytes <= 0:
        return ""
    units = ("B", "KB", "MB", "GB", "TB")
    value = float(num_bytes)
    for unit in units:
        if value < 1024.0 or unit == units[-1]:
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024.0
    return ""


def format_eta(seconds: int | float | None) -> str:
    if seconds is None or seconds < 0:
        return ""
    total = int(seconds)
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def sanitize_filename(title: str, max_length: int = 160) -> str:
    cleaned = INVALID_FILENAME_CHARS_RE.sub("", title or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    if not cleaned:
        cleaned = "youtube_video"
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length].rstrip(" .")
    return cleaned


def extract_quality_options(info: dict[str, Any]) -> list[dict[str, Any]]:
    """Build dropdown options from the video's actual available formats."""
    formats = info.get("formats") or []
    resolutions: dict[int, dict[str, Any]] = {}

    for fmt in formats:
        vcodec = fmt.get("vcodec")
        height = fmt.get("height")
        if not vcodec or vcodec == "none" or not isinstance(height, int) or height <= 0:
            continue

        fps = fmt.get("fps") or 0
        fps_int = int(round(fps)) if isinstance(fps, (int, float)) else 0
        tbr = fmt.get("tbr") or 0

        existing = resolutions.get(height)
        if existing is None or fps_int > existing["fps"] or (fps_int == existing["fps"] and tbr > existing["tbr"]):
            resolutions[height] = {
                "height": height,
                "fps": fps_int,
                "tbr": tbr,
            }

    sorted_heights = sorted(resolutions.keys(), reverse=True)
    max_height = sorted_heights[0] if sorted_heights else None

    options: list[dict[str, Any]] = [
        {
            "id": "best",
            "label": "Best Quality (Original)",
            "type": "video",
            "height": max_height,
            "detail": (
                f"Up to {max_height}p · bestvideo+bestaudio merged via FFmpeg"
                if max_height
                else "bestvideo+bestaudio merged via FFmpeg"
            ),
        }
    ]

    tier_tags = {
        4320: "8K",
        2160: "4K",
        1440: "2K",
        1080: "Full HD",
        720: "HD",
    }

    for height in sorted_heights:
        meta = resolutions[height]
        fps = meta["fps"]
        tag = tier_tags.get(height, "")
        label = f"{height}p"
        if tag:
            label += f" ({tag})"
        if fps >= 48:
            label += f" · {fps}fps"

        options.append(
            {
                "id": str(height),
                "label": label,
                "type": "video",
                "height": height,
                "detail": f"{height}p video + best audio merged via FFmpeg",
            }
        )

    options.append(
        {
            "id": "audio_mp3",
            "label": "Audio only (MP3, best quality)",
            "type": "audio",
            "height": None,
            "detail": "Highest quality audio extracted to MP3 via FFmpeg",
        }
    )

    return options


def cleanup_old_jobs() -> None:
    """Delete expired temporary job directories to keep disk usage tidy."""
    now = time.time()
    expired_ids: list[str] = []

    with JOBS_LOCK:
        for job_id, job in list(JOBS.items()):
            if job["status"] in ("finished", "error") and (now - job["created_at"]) > JOB_TTL_SECONDS:
                expired_ids.append(job_id)
                JOBS.pop(job_id, None)

    for job_id in expired_ids:
        job_dir = TEMP_ROOT / job_id
        if job_dir.exists():
            shutil.rmtree(job_dir, ignore_errors=True)


def update_job(job_id: str, **fields: Any) -> None:
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(fields)


def locate_output_file(job_dir: Path, expected_ext: str) -> Path | None:
    """Locate the final merged or converted file inside the job temp directory."""
    candidates = [
        p
        for p in job_dir.iterdir()
        if p.is_file() and not p.name.endswith((".part", ".ytdl", ".temp"))
    ]
    if not candidates:
        return None

    exact_ext = [p for p in candidates if p.suffix.lower() == f".{expected_ext.lower()}"]
    if exact_ext:
        return max(exact_ext, key=lambda p: p.stat().st_size)
    return max(candidates, key=lambda p: p.stat().st_mtime)


# ---------------------------------------------------------------------------
# Background download worker
# ---------------------------------------------------------------------------

def run_download_job(job_id: str, url: str, quality: str, container: str) -> None:
    job_dir = TEMP_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    is_audio_only = quality == "audio_mp3"
    target_ext = "mp3" if is_audio_only else ("mp4" if container == "mp4" else "mkv")
    final_filepath_holder: dict[str, str] = {}

    def progress_hook(data: dict[str, Any]) -> None:
        status = data.get("status")
        if status == "downloading":
            downloaded = data.get("downloaded_bytes") or 0
            total = data.get("total_bytes") or data.get("total_bytes_estimate") or 0
            if total > 0:
                percent = min(99.0, round((downloaded / total) * 100.0, 1))
            else:
                raw_pct = strip_ansi(str(data.get("_percent_str", "0"))).replace("%", "").strip()
                try:
                    percent = min(99.0, float(raw_pct))
                except ValueError:
                    percent = 0.0

            speed_val = data.get("speed")
            speed_str = f"{format_bytes(speed_val)}/s" if speed_val else strip_ansi(str(data.get("_speed_str", "")))
            eta_val = data.get("eta")
            eta_str = format_eta(eta_val) if eta_val is not None else strip_ansi(str(data.get("_eta_str", "")))

            info_dict = data.get("info_dict") or {}
            vcodec = info_dict.get("vcodec")
            acodec = info_dict.get("acodec")
            if is_audio_only or (vcodec == "none" and acodec and acodec != "none"):
                phase = "Downloading audio stream…"
            elif acodec == "none" and vcodec and vcodec != "none":
                phase = "Downloading video stream…"
            else:
                phase = "Downloading media stream…"

            update_job(
                job_id,
                status="downloading",
                phase=phase,
                percent=percent,
                speed=speed_str,
                eta=eta_str,
                downloaded_bytes=downloaded,
                total_bytes=total,
            )
        elif status == "finished":
            phase = (
                "Converting audio to MP3 with FFmpeg…"
                if is_audio_only
                else f"Merging streams into {target_ext.upper()} with FFmpeg…"
            )
            update_job(
                job_id,
                status="merging",
                phase=phase,
                percent=99.0,
                speed="",
                eta="00:00",
            )

    def postprocessor_hook(data: dict[str, Any]) -> None:
        pp_status = data.get("status")
        if pp_status in ("started", "processing"):
            phase = (
                "Encoding best-quality MP3 with FFmpeg…"
                if is_audio_only
                else f"Merging video + audio into {target_ext.upper()}…"
            )
            update_job(job_id, status="merging", phase=phase, percent=99.0)
        elif pp_status == "finished":
            info_dict = data.get("info_dict") or {}
            fp = info_dict.get("filepath")
            if fp:
                final_filepath_holder["path"] = fp

    ydl_opts: dict[str, Any] = {
        "outtmpl": str(job_dir / "media.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "progress_hooks": [progress_hook],
        "postprocessor_hooks": [postprocessor_hook],
    }

    if is_audio_only:
        ydl_opts["format"] = "bestaudio/best"
        ydl_opts["postprocessors"] = [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "0",  # V0 / highest MP3 quality
            }
        ]
    elif quality == "best":
        ydl_opts["format"] = "bestvideo+bestaudio/best"
        ydl_opts["merge_output_format"] = target_ext
    else:
        try:
            height = int(quality)
        except ValueError:
            update_job(job_id, status="error", error="Invalid quality option selected.")
            return

        if target_ext == "mp4":
            ydl_opts["format"] = (
                f"bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/"
                f"bestvideo[height<={height}]+bestaudio/"
                f"best[height<={height}]/best"
            )
        else:
            ydl_opts["format"] = f"bestvideo[height<={height}]+bestaudio/best[height<={height}]/best"
        ydl_opts["merge_output_format"] = target_ext

    try:
        update_job(job_id, status="downloading", phase="Connecting to YouTube…", percent=0.0)

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)

        title = (info or {}).get("title") or "youtube_video"

        # Resolve the final output file on disk
        output_path: Path | None = None
        if final_filepath_holder.get("path"):
            candidate = Path(final_filepath_holder["path"])
            if candidate.is_file():
                output_path = candidate

        if output_path is None and info:
            req_downloads = info.get("requested_downloads") or []
            if req_downloads and req_downloads[0].get("filepath"):
                candidate = Path(req_downloads[0]["filepath"])
                if candidate.is_file():
                    output_path = candidate

        if output_path is None:
            output_path = locate_output_file(job_dir, target_ext)

        if output_path is None or not output_path.is_file():
            raise RuntimeError("Download completed, but the merged output file could not be located.")

        actual_ext = output_path.suffix.lstrip(".") or target_ext
        proper_filename = f"{sanitize_filename(title)}.{actual_ext}"
        filesize = output_path.stat().st_size

        update_job(
            job_id,
            status="finished",
            phase="Ready to save",
            percent=100.0,
            speed="",
            eta="00:00",
            filename=proper_filename,
            filepath=str(output_path),
            filesize=filesize,
            filesize_formatted=format_bytes(filesize),
        )
    except DownloadError as exc:
        update_job(
            job_id,
            status="error",
            phase="Download failed",
            error=friendly_error_message(str(exc)),
        )
        shutil.rmtree(job_dir, ignore_errors=True)
    except Exception as exc:
        update_job(
            job_id,
            status="error",
            phase="Download failed",
            error=friendly_error_message(str(exc)),
        )
        shutil.rmtree(job_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/info", methods=["POST"])
def api_info():
    payload = request.get_json(silent=True) or {}
    is_valid, result = validate_youtube_url(payload.get("url", ""))
    if not is_valid:
        return jsonify({"error": result}), 400

    url = result
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except DownloadError as exc:
        return jsonify({"error": friendly_error_message(str(exc))}), 400
    except Exception as exc:
        return jsonify({"error": friendly_error_message(str(exc))}), 500

    if not info:
        return jsonify({"error": "Could not retrieve video metadata from YouTube."}), 404

    if info.get("is_live"):
        return jsonify({"error": "Active live streams cannot be downloaded while live."}), 400

    thumbnails = info.get("thumbnails") or []
    best_thumb = info.get("thumbnail") or (thumbnails[-1].get("url") if thumbnails else "")

    return jsonify(
        {
            "id": info.get("id", ""),
            "title": info.get("title") or "Untitled Video",
            "channel": info.get("channel") or info.get("uploader") or "Unknown Channel",
            "duration": info.get("duration") or 0,
            "duration_string": format_duration(info.get("duration")),
            "thumbnail": best_thumb,
            "webpage_url": info.get("webpage_url") or url,
            "formats": extract_quality_options(info),
        }
    )


@app.route("/api/download", methods=["POST"])
def api_download():
    cleanup_old_jobs()

    if not shutil.which("ffmpeg"):
        return (
            jsonify(
                {
                    "error": "FFmpeg was not found on your system PATH. Please install FFmpeg and restart app.py."
                }
            ),
            500,
        )

    payload = request.get_json(silent=True) or {}
    is_valid, result = validate_youtube_url(payload.get("url", ""))
    if not is_valid:
        return jsonify({"error": result}), 400

    url = result
    quality = str(payload.get("quality") or "best").strip()
    container = str(payload.get("container") or "mkv").strip().lower()
    if container not in ("mkv", "mp4"):
        container = "mkv"

    job_id = uuid.uuid4().hex
    with JOBS_LOCK:
        JOBS[job_id] = {
            "id": job_id,
            "status": "queued",
            "phase": "Queued…",
            "percent": 0.0,
            "speed": "",
            "eta": "",
            "downloaded_bytes": 0,
            "total_bytes": 0,
            "filename": "",
            "filepath": "",
            "filesize": 0,
            "filesize_formatted": "",
            "error": "",
            "created_at": time.time(),
        }

    worker = threading.Thread(
        target=run_download_job,
        args=(job_id, url, quality, container),
        daemon=True,
    )
    worker.start()

    return jsonify({"job_id": job_id}), 202


@app.route("/api/status/<job_id>", methods=["GET"])
def api_status(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return jsonify({"error": "Download job not found or expired."}), 404
        public_state = {k: v for k, v in job.items() if k != "filepath"}
    return jsonify(public_state)


@app.route("/api/file/<job_id>", methods=["GET"])
def api_file(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job or job["status"] != "finished":
            abort(404, description="File is not ready or job has expired.")
        filepath = Path(job["filepath"])
        filename = job["filename"]

    if not filepath.is_file():
        abort(404, description="Output file no longer exists on disk.")

    return send_file(
        filepath,
        as_attachment=True,
        download_name=filename,
    )


if __name__ == "__main__":
    print(f"LocalTube running locally at http://{HOST}:{PORT} (127.0.0.1 only)")
    if not shutil.which("ffmpeg"):
        print("WARNING: FFmpeg was not found in PATH. Merging video+audio and MP3 export require FFmpeg.")
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
