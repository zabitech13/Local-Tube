import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const IS_PROD = process.env.NODE_ENV === "production";
const TEMP_ROOT = path.join(os.tmpdir(), "localtube_preview_jobs");
fs.mkdirSync(TEMP_ROOT, { recursive: true });

const ALLOWED_YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

interface PreviewJob {
  id: string;
  status: "queued" | "downloading" | "merging" | "finished" | "error";
  phase: string;
  percent: number;
  speed: string;
  eta: string;
  filename: string;
  filepath: string;
  filesize: number;
  filesize_formatted: string;
  error: string;
  createdAt: number;
  isPreviewSample: boolean;
}

const JOBS = new Map<string, PreviewJob>();
const VIDEO_META_CACHE = new Map<string, { title: string; channel: string }>();

// ---------------------------------------------------------------------------
// Standard PKWARE ZIP builder (Store mode, method 0, exact CRC-32)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildZipArchive(entries: Array<{ name: string; content: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const dataBuf = entry.content;
    const checksum = crc32(dataBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(0, 8); // STORE
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, dataBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(0, 10); // STORE
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + dataBuf.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateYouTubeUrl(rawUrl: string): { valid: boolean; url?: string; videoId?: string; error?: string } {
  const trimmed = (rawUrl || "").trim();
  if (!trimmed) {
    return { valid: false, error: "Please enter a YouTube URL." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: "The URL format is invalid. Please paste a full YouTube link." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, error: "URL must start with http:// or https://." };
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_YOUTUBE_HOSTS.has(host)) {
    return {
      valid: false,
      error: "That does not look like a YouTube link. Supported domains: youtube.com, youtu.be, and music.youtube.com.",
    };
  }

  let videoId = "";
  if (host === "youtu.be" || host === "www.youtu.be") {
    videoId = parsed.pathname.replace(/^\/+/, "").split("/")[0] || "";
  } else if (parsed.pathname === "/watch") {
    videoId = parsed.searchParams.get("v") || "";
  } else {
    const match = parsed.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
    if (match) {
      videoId = match[2];
    }
  }

  if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    return {
      valid: false,
      error: "Please paste a link to a specific YouTube video with a valid video ID.",
    };
  }

  return {
    valid: true,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    videoId,
  };
}

function sanitizeFilename(title: string, maxLength = 150): string {
  const cleaned = (title || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[ .]+|[ .]+$/g, "");
  const fallback = cleaned || "youtube_video";
  return fallback.length > maxLength ? fallback.slice(0, maxLength).replace(/[ .]+$/, "") : fallback;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return "Detected locally";
  }
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let val = bytes;
  for (const unit of units) {
    if (val < 1024 || unit === units[units.length - 1]) {
      return unit === "B" ? `${Math.round(val)} B` : `${val.toFixed(1)} ${unit}`;
    }
    val /= 1024;
  }
  return `${bytes} B`;
}

function parseIsoDuration(iso: string): number | null {
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  const h = Number(match[1] || 0);
  const m = Number(match[2] || 0);
  const s = Number(match[3] || 0);
  return h * 3600 + m * 60 + s;
}

function readSourceFiles() {
  const specs = [
    {
      id: "app.py",
      path: "app.py",
      language: "python",
      description: "Flask backend, yt-dlp metadata & format reader, background thread worker, FFmpeg merger, and 127.0.0.1 server.",
    },
    {
      id: "templates/index.html",
      path: "templates/index.html",
      language: "html",
      description: "Single-page zero-framework HTML/CSS/JS frontend with dark red-accented UI, quality selector, MKV/MP4 toggle, and progress poller.",
    },
    {
      id: "requirements.txt",
      path: "requirements.txt",
      language: "text",
      description: "Python dependencies for Flask and yt-dlp.",
    },
    {
      id: "README.md",
      path: "README.md",
      language: "markdown",
      description: "Quick-start install steps and run commands for Windows, macOS, and Linux.",
    },
  ];

  return specs.map((spec) => {
    const absPath = path.join(__dirname, spec.path);
    const content = fs.existsSync(absPath) ? fs.readFileSync(absPath, "utf8") : "";
    return {
      ...spec,
      content,
      lines: content ? content.split("\n").length : 0,
      bytes: Buffer.byteLength(content, "utf8"),
    };
  });
}

function runFfmpegSample(
  outputPath: string,
  ext: "mkv" | "mp4" | "mp3",
  title: string,
  channel: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args =
      ext === "mp3"
        ? [
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "0",
            "-metadata",
            `title=${title}`,
            "-metadata",
            `artist=${channel}`,
            outputPath,
          ]
        : [
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=#0a0a0c:s=640x360:d=1",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=44100:cl=stereo",
            "-t",
            "1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            "-metadata",
            `title=${title}`,
            "-metadata",
            `artist=${channel}`,
            outputPath,
          ];

    const proc = spawn("ffmpeg", args, { stdio: "ignore" });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
  });
}

function cleanupOldPreviewJobs() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of JOBS.entries()) {
    if (job.createdAt < cutoff && (job.status === "finished" || job.status === "error")) {
      JOBS.delete(id);
      if (job.filepath && fs.existsSync(job.filepath)) {
        fs.rmSync(path.dirname(job.filepath), { recursive: true, force: true });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Express Application
// ---------------------------------------------------------------------------

async function createServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Serve raw standalone templates/index.html for direct zero-framework inspection
  app.get("/standalone", (_req, res) => {
    const templatePath = path.join(__dirname, "templates", "index.html");
    if (!fs.existsSync(templatePath)) {
      res.status(404).send("templates/index.html not found.");
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.sendFile(templatePath);
  });

  // Return all real source files on disk for the Source Explorer view
  app.get("/api/sources", (_req, res) => {
    res.json({ files: readSourceFiles() });
  });

  // Download an individual source file
  app.get("/api/source/:fileId", (req, res) => {
    const allowed: Record<string, { relPath: string; downloadName: string }> = {
      "app.py": { relPath: "app.py", downloadName: "app.py" },
      "index.html": { relPath: "templates/index.html", downloadName: "index.html" },
      "requirements.txt": { relPath: "requirements.txt", downloadName: "requirements.txt" },
      "README.md": { relPath: "README.md", downloadName: "README.md" },
    };
    const match = allowed[req.params.fileId];
    if (!match) {
      res.status(404).json({ error: "Unknown source file." });
      return;
    }
    const absPath = path.join(__dirname, match.relPath);
    if (!fs.existsSync(absPath)) {
      res.status(404).json({ error: "Source file missing." });
      return;
    }
    res.download(absPath, match.downloadName);
  });

  // Download complete ready-to-run local ZIP bundle
  app.get("/api/bundle.zip", (_req, res) => {
    const files = readSourceFiles();
    const entries = files.map((file) => ({
      name: `localtube/${file.path}`,
      content: Buffer.from(file.content, "utf8"),
    }));
    const zipBuffer = buildZipArchive(entries);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="localtube-downloader.zip"');
    res.setHeader("Content-Length", String(zipBuffer.length));
    res.send(zipBuffer);
  });

  // Live YouTube metadata lookup (real YouTube oEmbed + duration attempt)
  app.post("/api/info", async (req, res) => {
    const check = validateYouTubeUrl(req.body?.url || "");
    if (!check.valid || !check.url || !check.videoId) {
      res.status(400).json({ error: check.error || "Invalid YouTube URL." });
      return;
    }

    const canonicalUrl = check.url;
    const videoId = check.videoId;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`,
        {
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0" },
        }
      );
      clearTimeout(timeout);

      if (oembedRes.status === 401 || oembedRes.status === 403) {
        res.status(400).json({
          error: "This video is private or restricted and cannot be accessed without authorization.",
        });
        return;
      }

      if (oembedRes.status === 404 || oembedRes.status === 400) {
        res.status(400).json({
          error: "This video is unavailable, deleted, or the YouTube URL is invalid.",
        });
        return;
      }

      if (!oembedRes.ok) {
        res.status(502).json({
          error: `YouTube returned HTTP ${oembedRes.status}. Please check the link and try again.`,
        });
        return;
      }

      const oembed = (await oembedRes.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
      };

      // Best-effort duration check from public watch meta tags
      let durationSeconds: number | null = null;
      try {
        const pageController = new AbortController();
        const pageTimeout = setTimeout(() => pageController.abort(), 4000);
        const pageRes = await fetch(canonicalUrl, {
          signal: pageController.signal,
          headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9" },
        });
        clearTimeout(pageTimeout);
        if (pageRes.ok) {
          const html = await pageRes.text();
          const isoMatch = html.match(/itemprop="duration"\s+content="(PT[^"]+)"/);
          if (isoMatch) {
            durationSeconds = parseIsoDuration(isoMatch[1]);
          } else {
            const scopedLen = html.match(
              new RegExp(`"videoId":"${videoId}"[\\s\\S]{0,1200}?"lengthSeconds":"(\\d+)"`)
            );
            if (scopedLen) {
              durationSeconds = Number(scopedLen[1]);
            }
          }
        }
      } catch {
        // Duration falls back cleanly when datacenter IP hits YouTube bot gate
      }

      const title = oembed.title || "Untitled Video";
      const channel = oembed.author_name || "Unknown Channel";
      VIDEO_META_CACHE.set(canonicalUrl, { title, channel });

      const formats = [
        {
          id: "best",
          label: "Best Quality (Original)",
          type: "video",
          height: 2160,
          detail: "bestvideo+bestaudio merged via FFmpeg (exact streams read by yt-dlp locally)",
        },
        {
          id: "2160",
          label: "2160p (4K) · 60fps",
          type: "video",
          height: 2160,
          detail: "2160p video + best audio merged via FFmpeg",
        },
        {
          id: "1440",
          label: "1440p (2K) · 60fps",
          type: "video",
          height: 1440,
          detail: "1440p video + best audio merged via FFmpeg",
        },
        {
          id: "1080",
          label: "1080p (Full HD) · 60fps",
          type: "video",
          height: 1080,
          detail: "1080p video + best audio merged via FFmpeg",
        },
        {
          id: "720",
          label: "720p (HD)",
          type: "video",
          height: 720,
          detail: "720p video + best audio merged via FFmpeg",
        },
        {
          id: "480",
          label: "480p",
          type: "video",
          height: 480,
          detail: "480p video + best audio merged via FFmpeg",
        },
        {
          id: "360",
          label: "360p",
          type: "video",
          height: 360,
          detail: "360p video + best audio merged via FFmpeg",
        },
        {
          id: "audio_mp3",
          label: "Audio only (MP3, best quality)",
          type: "audio",
          height: null,
          detail: "Highest quality audio extracted to MP3 via FFmpeg",
        },
      ];

      res.json({
        id: videoId,
        title,
        channel,
        duration: durationSeconds ?? 0,
        duration_string: formatDuration(durationSeconds),
        thumbnail: oembed.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        webpage_url: canonicalUrl,
        formats,
        preview_mode: true,
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      res.status(504).json({
        error: isAbort
          ? "Timed out while contacting YouTube. Please try again."
          : "Could not reach YouTube right now. Check your connection and try again.",
      });
    }
  });

  // Preview download job (runs real FFmpeg container muxing + polling status lifecycle)
  app.post("/api/download", (req, res) => {
    cleanupOldPreviewJobs();

    const check = validateYouTubeUrl(req.body?.url || "");
    if (!check.valid || !check.url) {
      res.status(400).json({ error: check.error || "Invalid YouTube URL." });
      return;
    }

    const quality = String(req.body?.quality || "best").trim();
    const rawContainer = String(req.body?.container || "mkv").trim().toLowerCase();
    const isAudio = quality === "audio_mp3";
    const ext: "mkv" | "mp4" | "mp3" = isAudio ? "mp3" : rawContainer === "mp4" ? "mp4" : "mkv";

    const cached = VIDEO_META_CACHE.get(check.url);
    const title = cached?.title || "YouTube Video";
    const channel = cached?.channel || "YouTube";

    const jobId = crypto.randomBytes(12).toString("hex");
    const jobDir = path.join(TEMP_ROOT, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    const outputPath = path.join(jobDir, `output.${ext}`);
    const properFilename = `${sanitizeFilename(title)}.${ext}`;

    const job: PreviewJob = {
      id: jobId,
      status: "queued",
      phase: "Queued…",
      percent: 0,
      speed: "",
      eta: "",
      filename: properFilename,
      filepath: outputPath,
      filesize: 0,
      filesize_formatted: "",
      error: "",
      createdAt: Date.now(),
      isPreviewSample: true,
    };

    JOBS.set(jobId, job);

    // Run staged background progression + real FFmpeg container build
    (async () => {
      const stages: Array<{ delay: number; patch: Partial<PreviewJob> }> = [
        {
          delay: 300,
          patch: {
            status: "downloading",
            phase: isAudio ? "Fetching audio stream (preview)…" : "Fetching video stream (preview)…",
            percent: 24.5,
            speed: "11.4 MB/s",
            eta: "00:02",
          },
        },
        {
          delay: 500,
          patch: {
            status: "downloading",
            phase: isAudio ? "Buffering audio frames (preview)…" : "Fetching video + audio streams (preview)…",
            percent: 62.0,
            speed: "14.2 MB/s",
            eta: "00:01",
          },
        },
        {
          delay: 500,
          patch: {
            status: "downloading",
            phase: isAudio ? "Finalizing audio buffer…" : "Finalizing stream segments…",
            percent: 91.5,
            speed: "12.8 MB/s",
            eta: "00:00",
          },
        },
        {
          delay: 350,
          patch: {
            status: "merging",
            phase: isAudio
              ? "Encoding MP3 verification clip via FFmpeg…"
              : `Muxing ${ext.toUpperCase()} verification container via FFmpeg…`,
            percent: 99.0,
            speed: "",
            eta: "00:00",
          },
        },
      ];

      try {
        for (const step of stages) {
          await new Promise((r) => setTimeout(r, step.delay));
          Object.assign(job, step.patch);
        }

        await runFfmpegSample(outputPath, ext, title, channel);
        const stat = fs.statSync(outputPath);

        Object.assign(job, {
          status: "finished",
          phase: "Ready to save (FFmpeg verification container)",
          percent: 100.0,
          speed: "",
          eta: "00:00",
          filesize: stat.size,
          filesize_formatted: formatBytes(stat.size),
        });
      } catch (err) {
        Object.assign(job, {
          status: "error",
          phase: "Failed",
          error: err instanceof Error ? err.message : "FFmpeg failed to build the output container.",
        });
      }
    })();

    res.status(202).json({ job_id: jobId });
  });

  app.get("/api/status/:jobId", (req, res) => {
    const job = JOBS.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Download job not found or expired." });
      return;
    }
    const { filepath: _hidden, ...publicJob } = job;
    res.json(publicJob);
  });

  app.get("/api/file/:jobId", (req, res) => {
    const job = JOBS.get(req.params.jobId);
    if (!job || job.status !== "finished" || !fs.existsSync(job.filepath)) {
      res.status(404).json({ error: "File is not ready or job has expired." });
      return;
    }
    res.download(job.filepath, job.filename);
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`LocalTube workbench running on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
