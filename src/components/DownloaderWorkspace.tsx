import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Clipboard,
  Copy,
  Download,
  FileCode2,
  Film,
  Loader2,
  Monitor,
  RotateCcw,
  Smartphone,
  Terminal,
} from "lucide-react";
import type { ActiveTab, DownloadStatus, SourceFileRecord, VideoInfo } from "../types";

interface DownloaderWorkspaceProps {
  sourceFiles: SourceFileRecord[];
  onInspectFile: (fileId: string) => void;
  onNavigate: (tab: ActiveTab) => void;
}

const SAMPLE_LINKS = [
  {
    label: "Big Buck Bunny (4K)",
    url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  },
  {
    label: "Me at the zoo",
    url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  },
  {
    label: "Invalid URL test",
    url: "https://example.com/not-a-youtube-video",
  },
  {
    label: "Unavailable video test",
    url: "https://www.youtube.com/watch?v=00000000000",
  },
];

const QUICK_COMMANDS = [
  { label: "Install FFmpeg (Win)", cmd: "winget install Gyan.FFmpeg" },
  { label: "Install Python deps", cmd: "pip install -r requirements.txt" },
  { label: "Start local server", cmd: "python app.py" },
];

export function DownloaderWorkspace({
  sourceFiles,
  onInspectFile,
  onNavigate,
}: DownloaderWorkspaceProps) {
  const [viewMode, setViewMode] = useState<"interactive" | "standalone">("interactive");
  const [standaloneWidth, setStandaloneWidth] = useState<"desktop" | "mobile">("desktop");

  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [thumbFailed, setThumbFailed] = useState(false);

  const [selectedQuality, setSelectedQuality] = useState("best");
  const [container, setContainer] = useState<"mkv" | "mp4">("mkv");

  const [downloading, setDownloading] = useState(false);
  const [jobStatus, setJobStatus] = useState<DownloadStatus | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  const fetchInfo = async (targetUrl?: string) => {
    const queryUrl = (targetUrl ?? url).trim();
    setError(null);
    stopPolling();
    setJobStatus(null);
    setActiveJobId(null);
    setDownloading(false);

    if (!queryUrl) {
      setError("Please paste a YouTube URL first.");
      inputRef.current?.focus();
      return;
    }

    setFetching(true);
    setThumbFailed(false);

    try {
      const res = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: queryUrl }),
      });
      const data = await res.json();

      if (!res.ok) {
        setVideo(null);
        setError(data.error || "Failed to retrieve video information.");
        return;
      }

      setVideo(data as VideoInfo);
      setSelectedQuality(data.formats?.[0]?.id || "best");
      setContainer("mkv");
    } catch {
      setVideo(null);
      setError("Could not reach the backend server. Please retry.");
    } finally {
      setFetching(false);
    }
  };

  const handlePaste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) {
        setUrl(clip.trim());
        setError(null);
        inputRef.current?.focus();
      }
    } catch {
      setError("Clipboard access was blocked by the browser. Paste with Ctrl+V or Cmd+V.");
      inputRef.current?.focus();
    }
  };

  const handleStartDownload = async () => {
    if (!video) return;
    setError(null);
    stopPolling();
    setDownloading(true);
    setActiveJobId(null);
    setJobStatus({
      id: "",
      status: "queued",
      phase: "Starting background worker…",
      percent: 0,
      speed: "",
      eta: "",
      filename: "",
      filesize: 0,
      filesize_formatted: "",
      error: "",
    });

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: video.webpage_url || url.trim(),
          quality: selectedQuality,
          container,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setDownloading(false);
        setJobStatus(null);
        setError(data.error || "Could not start the download.");
        return;
      }

      const jobId = data.job_id as string;
      setActiveJobId(jobId);

      pollRef.current = window.setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/status/${encodeURIComponent(jobId)}`);
          const statusData = (await statusRes.json()) as DownloadStatus & { error?: string };

          if (!statusRes.ok) {
            stopPolling();
            setDownloading(false);
            setError(statusData.error || "Lost track of background job.");
            return;
          }

          setJobStatus(statusData);

          if (statusData.status === "finished") {
            stopPolling();
            setDownloading(false);
          } else if (statusData.status === "error") {
            stopPolling();
            setDownloading(false);
            setError(statusData.error || "Download failed.");
          }
        } catch {
          stopPolling();
          setDownloading(false);
          setError("Connection interrupted while polling /api/status.");
        }
      }, 450);
    } catch {
      setDownloading(false);
      setJobStatus(null);
      setError("Could not contact /api/download.");
    }
  };

  const handleReset = () => {
    stopPolling();
    setError(null);
    setVideo(null);
    setJobStatus(null);
    setActiveJobId(null);
    setDownloading(false);
    setUrl("");
    inputRef.current?.focus();
  };

  const handleCopyCommand = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCmd(cmd);
      window.setTimeout(() => setCopiedCmd((prev) => (prev === cmd ? null : prev)), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const isAudioOnly = selectedQuality === "audio_mp3";
  const currentFormatObj = video?.formats.find((f) => f.id === selectedQuality);

  const containerSummaryText = isAudioOnly
    ? "Extracts bestaudio and converts to V0 MP3 via FFmpeg."
    : selectedQuality === "best"
      ? `Merges bestvideo + bestaudio into ${container.toUpperCase()} via FFmpeg.`
      : `Merges ${selectedQuality}p video + best audio into ${container.toUpperCase()} via FFmpeg.`;

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      {/* Section Heading + Workspace Mode Toolbar */}
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-balance font-display text-3xl font-bold tracking-tight text-[#f4f4f6] sm:text-4xl">
            Personal YouTube downloader for local use
          </h1>
          <p className="mt-2 max-w-[64ch] text-sm leading-relaxed text-[#a1a1b0] sm:text-[15px]">
            Python Flask + yt-dlp + FFmpeg backend bound strictly to{" "}
            <code className="font-mono text-[13px] text-[#e4e4eb]">127.0.0.1:5000</code>, paired
            with a zero-framework HTML/CSS/JS frontend.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Preview view mode"
            className="inline-flex rounded-lg border border-[#24242d] bg-[#121216] p-1"
          >
            <button
              type="button"
              onClick={() => setViewMode("interactive")}
              className={`h-8 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors duration-150 ${
                viewMode === "interactive"
                  ? "bg-[#22222b] text-white"
                  : "text-[#9a9aa8] hover:text-white"
              }`}
            >
              Interactive Preview
            </button>
            <button
              type="button"
              onClick={() => setViewMode("standalone")}
              className={`h-8 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors duration-150 ${
                viewMode === "standalone"
                  ? "bg-[#22222b] text-white"
                  : "text-[#9a9aa8] hover:text-white"
              }`}
            >
              Raw templates/index.html
            </button>
          </div>

          {viewMode === "standalone" && (
            <div
              role="group"
              aria-label="Standalone viewport size"
              className="inline-flex rounded-lg border border-[#24242d] bg-[#121216] p-1"
            >
              <button
                type="button"
                onClick={() => setStandaloneWidth("desktop")}
                className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors ${
                  standaloneWidth === "desktop"
                    ? "bg-[#22222b] text-white"
                    : "text-[#9a9aa8] hover:text-white"
                }`}
              >
                <Monitor className="h-3.5 w-3.5" />
                <span>Desktop</span>
              </button>
              <button
                type="button"
                onClick={() => setStandaloneWidth("mobile")}
                className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors ${
                  standaloneWidth === "mobile"
                    ? "bg-[#22222b] text-white"
                    : "text-[#9a9aa8] hover:text-white"
                }`}
              >
                <Smartphone className="h-3.5 w-3.5" />
                <span>390px</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main 2-Column Desktop Split */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
        {/* Left Dominant Focal Anchor (8 cols) */}
        <div className="lg:col-span-8">
          {viewMode === "standalone" ? (
            <div className="rounded-2xl border border-[#24242d] bg-[#121216] p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#22222b] pb-3 text-xs text-[#a1a1b0]">
                <div className="flex items-center gap-2 font-mono">
                  <span className="text-[#f4f4f6]">templates/index.html</span>
                  <span aria-hidden="true" className="text-[#525260]">
                    ·
                  </span>
                  <span>Zero-framework HTML / CSS / JS rendered directly</span>
                </div>
                <button
                  type="button"
                  onClick={() => onInspectFile("templates/index.html")}
                  className="inline-flex items-center gap-1 font-medium text-[#e51d2e] hover:text-[#ff4655] whitespace-nowrap"
                >
                  <span>Inspect source</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex justify-center overflow-x-auto rounded-xl bg-[#070709] p-2">
                <iframe
                  title="Standalone templates/index.html preview"
                  src="/standalone"
                  className={`h-[680px] rounded-lg border border-[#24242d] bg-[#0a0a0c] transition-all duration-200 ${
                    standaloneWidth === "mobile" ? "w-[390px]" : "w-full"
                  }`}
                />
              </div>
            </div>
          ) : (
            <section
              aria-label="YouTube Downloader Utility"
              className="rounded-2xl border border-[#24242d] bg-[#121216] p-5 sm:p-7"
            >
              {/* URL Input Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  fetchInfo();
                }}
                noValidate
              >
                <label
                  htmlFor="yt-url-input"
                  className="mb-2 block text-xs font-semibold tracking-wide text-[#a1a1b0]"
                >
                  YouTube URL
                </label>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex flex-1 items-center">
                    <input
                      ref={inputRef}
                      id="yt-url-input"
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      value={url}
                      disabled={fetching || downloading}
                      onChange={(e) => {
                        setUrl(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="h-12 w-full rounded-[10px] border border-[#2f2f3b] bg-[#0a0a0c] pl-4 pr-20 text-sm text-[#f4f4f6] placeholder:text-[#686878] transition-colors focus:border-[#e51d2e] focus:outline-none focus:ring-2 focus:ring-[#e51d2e]/30 disabled:opacity-55"
                    />
                    <button
                      type="button"
                      onClick={handlePaste}
                      disabled={fetching || downloading}
                      className="absolute right-2 inline-flex h-8 items-center gap-1 rounded-md border border-[#272732] bg-[#18181f] px-2.5 text-xs font-medium text-[#b4b4c2] transition-colors hover:border-[#3b3b4a] hover:text-white disabled:opacity-45"
                    >
                      <Clipboard className="h-3.5 w-3.5" />
                      <span>Paste</span>
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={fetching || downloading}
                    className="inline-flex h-12 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-[#e51d2e] px-6 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#f22e3f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e51d2e] focus-visible:ring-offset-2 focus-visible:ring-offset-[#121216] disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {fetching ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Fetching…</span>
                      </>
                    ) : (
                      <span>Fetch Info</span>
                    )}
                  </button>
                </div>

                {/* Quick test links (clean unboxed text links, zero pill clutter) */}
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[#7c7c8d]">
                  <span>Try:</span>
                  {SAMPLE_LINKS.map((sample, idx) => (
                    <span key={sample.label} className="inline-flex items-center gap-3">
                      <button
                        type="button"
                        disabled={fetching || downloading}
                        onClick={() => {
                          setUrl(sample.url);
                          fetchInfo(sample.url);
                        }}
                        className="text-[#a8a8b8] underline decoration-[#343442] underline-offset-4 transition-colors hover:text-[#f4f4f6] hover:decoration-[#e51d2e] disabled:opacity-45"
                      >
                        {sample.label}
                      </button>
                      {idx < SAMPLE_LINKS.length - 1 && (
                        <span aria-hidden="true" className="text-[#3e3e4d]">
                          ·
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </form>

              {/* Inline Error Banner (icon + readable copy, no thick left border) */}
              {error && (
                <div
                  role="alert"
                  className="mt-5 flex items-start gap-3 rounded-[10px] border border-[#ef4444]/30 bg-[#ef4444]/10 px-4 py-3.5 text-sm text-[#fecaca]"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#f87171]" />
                  <span>{error}</span>
                </div>
              )}

              {/* Empty State Prompt (before first fetch) */}
              {!video && !error && !fetching && (
                <div className="mt-6 border-t border-[#22222b] pt-6">
                  <div className="flex flex-col gap-2 text-sm text-[#8e8e9e]">
                    <p className="font-medium text-[#d4d4dc]">Ready to inspect a YouTube link</p>
                    <p className="leading-relaxed">
                      Paste any public YouTube video URL above to load its live thumbnail, title,
                      channel name, quality options (up to 4K / Best Original + MP3), and test the
                      background polling progress flow.
                    </p>
                  </div>
                </div>
              )}

              {/* Loading Skeleton (matching video preview geometry) */}
              {fetching && (
                <div className="mt-6 border-t border-[#22222b] pt-6" aria-busy="true">
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-[240px_1fr]">
                    <div className="aspect-video w-full animate-pulse rounded-[10px] bg-[#1c1c24]" />
                    <div className="space-y-3 py-1">
                      <div className="h-5 w-4/5 animate-pulse rounded bg-[#1c1c24]" />
                      <div className="h-5 w-3/5 animate-pulse rounded bg-[#1c1c24]" />
                      <div className="h-4 w-2/5 animate-pulse rounded bg-[#181820]" />
                    </div>
                  </div>
                </div>
              )}

              {/* Fetched Video Info + Format & Container Controls */}
              {video && !fetching && (
                <div className="mt-6 border-t border-[#22222b] pt-6">
                  {/* Thumbnail + Metadata */}
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-[240px_1fr] sm:items-start">
                    <div className="relative aspect-video overflow-hidden rounded-[10px] border border-[#262630] bg-[#0b0b0e]">
                      {video.thumbnail && !thumbFailed ? (
                        <img
                          src={video.thumbnail}
                          alt={`Thumbnail for ${video.title}`}
                          referrerPolicy="no-referrer"
                          onError={() => setThumbFailed(true)}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#17171f] to-[#0d0d11] p-4 text-center">
                          <Film className="h-6 w-6 text-[#717182]" />
                          <span className="line-clamp-2 text-xs text-[#a1a1b0]">{video.title}</span>
                        </div>
                      )}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
                      <span className="tabular-nums absolute bottom-2 right-2 rounded bg-black/85 px-1.5 py-0.5 font-mono text-xs font-medium text-white">
                        {video.duration_string}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <h2 className="text-balance font-display text-lg font-semibold leading-snug text-[#f4f4f6] sm:text-xl">
                        {video.title}
                      </h2>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#a1a1b0]">
                        <span>{video.channel}</span>
                        <span aria-hidden="true" className="text-[#525260]">
                          ·
                        </span>
                        <span className="tabular-nums font-mono text-xs text-[#c7c7d4]">
                          {video.duration_string}
                        </span>
                      </div>
                      <p className="mt-3 text-xs leading-relaxed text-[#7c7c8d]">
                        Cloud preview fetches real YouTube metadata. Because YouTube restricts cloud
                        server IPs, starting a download here runs local FFmpeg to produce a 1-second
                        container verification file — run{" "}
                        <code className="font-mono text-[#c4c4d0]">app.py</code> on your PC for full
                        YouTube stream downloads.
                      </p>
                    </div>
                  </div>

                  {/* Quality Dropdown + MKV / MP4 Toggle */}
                  <div className="mt-6 border-t border-[#22222b] pt-6">
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
                      <div className="min-w-0">
                        <label
                          htmlFor="quality-select"
                          className="mb-2 block text-xs font-semibold tracking-wide text-[#a1a1b0]"
                        >
                          Quality
                        </label>
                        <select
                          id="quality-select"
                          value={selectedQuality}
                          disabled={downloading}
                          onChange={(e) => setSelectedQuality(e.target.value)}
                          className="h-11 w-full cursor-pointer rounded-[10px] border border-[#2f2f3b] bg-[#0a0a0c] px-3.5 text-sm font-medium text-[#f4f4f6] transition-colors focus:border-[#e51d2e] focus:outline-none focus:ring-2 focus:ring-[#e51d2e]/30 disabled:cursor-not-allowed disabled:opacity-55"
                        >
                          {video.formats.map((fmt) => (
                            <option key={fmt.id} value={fmt.id} className="bg-[#121216] text-white">
                              {fmt.label}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1.5 text-xs text-[#7c7c8d]">
                          {currentFormatObj?.detail || ""}
                        </p>
                      </div>

                      <div>
                        <span className="mb-2 block text-xs font-semibold tracking-wide text-[#a1a1b0]">
                          Output Container
                        </span>
                        <div
                          role="group"
                          aria-label="Output container format"
                          className="inline-flex h-11 w-full items-center gap-1 rounded-[10px] border border-[#2f2f3b] bg-[#0a0a0c] p-1 sm:w-auto"
                        >
                          <button
                            type="button"
                            disabled={downloading || isAudioOnly}
                            aria-pressed={!isAudioOnly && container === "mkv"}
                            onClick={() => setContainer("mkv")}
                            className={`h-9 flex-1 whitespace-nowrap rounded-[7px] px-4 font-mono text-xs font-medium transition-colors sm:flex-none ${
                              !isAudioOnly && container === "mkv"
                                ? "bg-[#22222c] text-white shadow-[inset_0_0_0_1px_#3a3a4a]"
                                : "text-[#8f8fa0] hover:text-white"
                            } disabled:cursor-not-allowed disabled:opacity-40`}
                          >
                            MKV
                          </button>
                          <button
                            type="button"
                            disabled={downloading || isAudioOnly}
                            aria-pressed={!isAudioOnly && container === "mp4"}
                            onClick={() => setContainer("mp4")}
                            className={`h-9 flex-1 whitespace-nowrap rounded-[7px] px-4 font-mono text-xs font-medium transition-colors sm:flex-none ${
                              !isAudioOnly && container === "mp4"
                                ? "bg-[#22222c] text-white shadow-[inset_0_0_0_1px_#3a3a4a]"
                                : "text-[#8f8fa0] hover:text-white"
                            } disabled:cursor-not-allowed disabled:opacity-40`}
                          >
                            MP4
                          </button>
                        </div>
                        <p className="mt-1.5 text-xs text-[#7c7c8d]">
                          {isAudioOnly
                            ? "Locked to MP3 audio"
                            : container === "mkv"
                              ? "Default · lossless mux"
                              : "Optional · wide playback"}
                        </p>
                      </div>
                    </div>

                    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-xs text-[#8f8fa0]">{containerSummaryText}</span>
                      <button
                        type="button"
                        disabled={downloading}
                        onClick={handleStartDownload}
                        className="inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-[#e51d2e] px-6 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#f22e3f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e51d2e] focus-visible:ring-offset-2 focus-visible:ring-offset-[#121216] disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        {downloading ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Processing…</span>
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4" />
                            <span>Start Download</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Live Background Progress Bar (polls /api/status/<id>) */}
                  {jobStatus && (
                    <div className="mt-6 border-t border-[#22222b] pt-6" aria-live="polite">
                      <div className="mb-2.5 flex items-baseline justify-between gap-4">
                        <span className="text-sm font-semibold text-[#f4f4f6]">
                          {jobStatus.phase}
                        </span>
                        <span className="tabular-nums font-mono text-sm font-medium text-[#f4f4f6]">
                          {jobStatus.percent.toFixed(1)}%
                        </span>
                      </div>

                      <div
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(jobStatus.percent)}
                        className="h-2 w-full overflow-hidden rounded-full border border-[#24242e] bg-[#0a0a0c]"
                      >
                        <div
                          className={`h-full w-full origin-left transition-transform duration-200 ease-out ${
                            jobStatus.status === "finished" ? "bg-[#22c55e]" : "bg-[#e51d2e]"
                          }`}
                          style={{ transform: `scaleX(${Math.max(0, Math.min(1, jobStatus.percent / 100))})` }}
                        />
                      </div>

                      {(jobStatus.speed || (jobStatus.eta && jobStatus.status === "downloading")) && (
                        <div className="tabular-nums mt-2.5 flex flex-wrap items-center gap-2 font-mono text-xs text-[#9a9aa8]">
                          {jobStatus.speed && <span>Speed {jobStatus.speed}</span>}
                          {jobStatus.speed && jobStatus.eta && jobStatus.status === "downloading" && (
                            <span aria-hidden="true" className="text-[#4a4a58]">
                              ·
                            </span>
                          )}
                          {jobStatus.eta && jobStatus.status === "downloading" && (
                            <span>ETA {jobStatus.eta}</span>
                          )}
                        </div>
                      )}

                      {/* Completed File Save Row */}
                      {jobStatus.status === "finished" && activeJobId && (
                        <div className="mt-5 flex flex-col gap-4 border-t border-[#22222b] pt-5 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="break-words text-sm font-semibold text-[#f4f4f6]">
                              {jobStatus.filename}
                            </p>
                            <p className="tabular-nums mt-1 font-mono text-xs text-[#9a9aa8]">
                              {jobStatus.filesize_formatted} · Served with video title as filename
                            </p>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
                            <a
                              href={`/api/file/${encodeURIComponent(activeJobId)}`}
                              download={jobStatus.filename}
                              className="inline-flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-[#22c55e] px-5 text-sm font-bold text-[#052e16] transition-colors hover:bg-[#34d36c] sm:flex-none"
                            >
                              <Download className="h-4 w-4" strokeWidth={2.4} />
                              <span>Save file</span>
                            </a>
                            <button
                              type="button"
                              onClick={handleReset}
                              className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-[#2f2f3b] bg-[#18181f] px-4 text-sm font-medium text-[#e4e4eb] transition-colors hover:bg-[#22222c] sm:flex-none"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              <span>New</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>

        {/* Right Companion Rail (4 cols) — Local Package & Quick Start */}
        <aside className="rounded-2xl border border-[#24242d] bg-[#121216] p-5 sm:p-6 lg:col-span-4">
          <h2 className="font-display text-base font-semibold text-[#f4f4f6]">
            Local Package Files
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-[#8f8fa0]">
            Ready-to-run Python Flask codebase bound exclusively to{" "}
            <code className="font-mono text-[#d4d4dc]">127.0.0.1</code>.
          </p>

          <ul className="mt-4 divide-y divide-[#202028] border-y border-[#202028]">
            {sourceFiles.map((file) => (
              <li key={file.id}>
                <button
                  type="button"
                  onClick={() => onInspectFile(file.id)}
                  className="group flex w-full items-center justify-between gap-3 py-3 text-left transition-colors hover:text-white"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <FileCode2 className="h-4 w-4 shrink-0 text-[#7d7d8f] group-hover:text-[#e51d2e]" />
                    <span className="truncate font-mono text-xs font-medium text-[#d8d8e2] group-hover:text-white">
                      {file.path}
                    </span>
                  </div>
                  <span className="tabular-nums shrink-0 font-mono text-[11px] text-[#757586]">
                    {file.lines} lines
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-sm font-semibold text-[#f4f4f6]">
                3-Step Local Run
              </h3>
              <button
                type="button"
                onClick={() => onNavigate("setup")}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-[#e51d2e] hover:text-[#ff4655] whitespace-nowrap"
              >
                <span>All OS steps</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-3 space-y-2.5">
              {QUICK_COMMANDS.map((item) => {
                const isCopied = copiedCmd === item.cmd;
                return (
                  <div key={item.cmd}>
                    <span className="mb-1 block text-[11px] font-medium text-[#8a8a9b]">
                      {item.label}
                    </span>
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-[#24242d] bg-[#0a0a0c] px-3 py-2">
                      <code className="truncate font-mono text-xs text-[#e4e4ec]">{item.cmd}</code>
                      <button
                        type="button"
                        onClick={() => handleCopyCommand(item.cmd)}
                        aria-label={`Copy command: ${item.cmd}`}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#8e8e9e] transition-colors hover:bg-[#191921] hover:text-white"
                      >
                        {isCopied ? (
                          <Check className="h-3.5 w-3.5 text-[#22c55e]" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6 border-t border-[#202028] pt-5">
            <div className="flex items-start gap-2.5 text-xs leading-relaxed text-[#8f8fa0]">
              <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-[#9a9aa8]" />
              <span>
                Open <code className="font-mono text-[#e4e4ec]">http://127.0.0.1:5000</code> in your
                browser after starting <code className="font-mono text-[#e4e4ec]">app.py</code>.
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
