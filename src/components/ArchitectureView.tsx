import { Lock, Layers, Server } from "lucide-react";

const ENDPOINTS = [
  {
    method: "GET",
    path: "/",
    purpose: "Renders templates/index.html — single-page zero-framework HTML/CSS/JS frontend.",
    behavior: "Synchronous",
  },
  {
    method: "POST",
    path: "/api/info",
    purpose:
      "Validates YouTube URL, extracts thumbnail, title, channel, duration, and every available video resolution via yt-dlp without downloading.",
    behavior: "JSON metadata",
  },
  {
    method: "POST",
    path: "/api/download",
    purpose:
      "Verifies FFmpeg on PATH, allocates a UUID job ID, and launches a daemon threading.Thread running yt-dlp + FFmpeg.",
    behavior: "202 Accepted",
  },
  {
    method: "GET",
    path: "/api/status/<job_id>",
    purpose:
      "Returns thread-safe job state (queued, downloading, merging, finished, error), percent, speed, ETA, and final filename.",
    behavior: "Polled every 600ms",
  },
  {
    method: "GET",
    path: "/api/file/<job_id>",
    purpose:
      "Streams the completed merged file with Flask send_file(..., as_attachment=True, download_name=<Video Title>.<ext>).",
    behavior: "Binary stream",
  },
];

const FORMAT_MATRIX = [
  {
    selection: "Best Quality (Original) · MKV",
    formatExpr: "bestvideo+bestaudio/best",
    postprocessing: "merge_output_format = mkv",
    result: "Highest available VP9 / AV1 / H.264 + Opus merged losslessly into .mkv",
  },
  {
    selection: "Best Quality (Original) · MP4",
    formatExpr: "bestvideo+bestaudio/best",
    postprocessing: "merge_output_format = mp4",
    result: "Highest available streams muxed into .mp4 via FFmpeg",
  },
  {
    selection: "Specific Resolution (e.g. 1080p) · MKV",
    formatExpr: "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
    postprocessing: "merge_output_format = mkv",
    result: "Exact resolution cap + best audio stream merged into .mkv",
  },
  {
    selection: "Specific Resolution (e.g. 1080p) · MP4",
    formatExpr: "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio",
    postprocessing: "merge_output_format = mp4",
    result: "Prefers native MP4/M4A codecs for maximum compatibility across players",
  },
  {
    selection: "Audio only (MP3, best quality)",
    formatExpr: "bestaudio/best",
    postprocessing: "FFmpegExtractAudio (mp3, quality 0 / V0)",
    result: "Highest-bitrate variable V0 / 320 kbps equivalent .mp3 file",
  },
];

export function ArchitectureView() {
  return (
    <div className="mx-auto max-w-[1160px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold tracking-tight text-[#f4f4f6]">
          Backend Architecture &amp; API Contract
        </h1>
        <p className="mt-1.5 max-w-[66ch] text-sm leading-relaxed text-[#a1a1b0]">
          How <code className="font-mono text-[#e4e4ec]">app.py</code> handles format inspection,
          background threading, FFmpeg container muxing, and localhost-only security.
        </p>
      </div>

      {/* Key Architectural Guarantees */}
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-[#24242d] bg-[#121216] p-5">
          <Lock className="h-4 w-4 text-[#e51d2e]" />
          <h2 className="mt-3 font-display text-sm font-semibold text-[#f4f4f6]">
            Loopback Binding Only
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-[#9a9aa8]">
            Flask explicitly binds to <code className="font-mono text-[#d8d8e2]">127.0.0.1</code>{" "}
            with <code className="font-mono text-[#d8d8e2]">debug=False</code>, preventing LAN
            exposure and werkzeug debugger risks.
          </p>
        </div>

        <div className="rounded-xl border border-[#24242d] bg-[#121216] p-5">
          <Server className="h-4 w-4 text-[#e51d2e]" />
          <h2 className="mt-3 font-display text-sm font-semibold text-[#f4f4f6]">
            Threaded Progress Hooks
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-[#9a9aa8]">
            Each download executes in a daemon thread protected by{" "}
            <code className="font-mono text-[#d8d8e2]">threading.Lock</code>, streaming progress
            and FFmpeg post-processing transitions to{" "}
            <code className="font-mono text-[#d8d8e2]">/api/status/&lt;id&gt;</code>.
          </p>
        </div>

        <div className="rounded-xl border border-[#24242d] bg-[#121216] p-5">
          <Layers className="h-4 w-4 text-[#e51d2e]" />
          <h2 className="mt-3 font-display text-sm font-semibold text-[#f4f4f6]">
            Clean Error &amp; File Hygiene
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-[#9a9aa8]">
            Raw yt-dlp tracebacks are mapped to plain error messages for private, geo-blocked,
            age-restricted, or deleted links. Temp job folders auto-expire after 2 hours.
          </p>
        </div>
      </div>

      {/* Flask HTTP Routes Table */}
      <section className="mb-8 overflow-hidden rounded-2xl border border-[#24242d] bg-[#121216]">
        <div className="border-b border-[#22222b] px-5 py-4">
          <h2 className="font-display text-base font-semibold text-[#f4f4f6]">
            Flask HTTP Endpoints
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#22222b] bg-[#0e0e12] text-xs font-semibold text-[#8f8fa0]">
                <th className="px-5 py-3">Method</th>
                <th className="px-5 py-3">Route</th>
                <th className="px-5 py-3">Responsibility</th>
                <th className="px-5 py-3 text-right">Mode</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1f1f27]">
              {ENDPOINTS.map((ep) => (
                <tr key={ep.path} className="hover:bg-[#17171d]">
                  <td className="px-5 py-3.5 font-mono text-xs font-semibold text-[#e51d2e]">
                    {ep.method}
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs text-[#f4f4f6]">{ep.path}</td>
                  <td className="px-5 py-3.5 text-xs leading-relaxed text-[#b2b2c0]">
                    {ep.purpose}
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono text-xs text-[#8f8fa0] whitespace-nowrap">
                    {ep.behavior}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Format & FFmpeg Merge Matrix */}
      <section className="overflow-hidden rounded-2xl border border-[#24242d] bg-[#121216]">
        <div className="border-b border-[#22222b] px-5 py-4">
          <h2 className="font-display text-base font-semibold text-[#f4f4f6]">
            yt-dlp Format Selection &amp; FFmpeg Container Rules
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#22222b] bg-[#0e0e12] text-xs font-semibold text-[#8f8fa0]">
                <th className="px-5 py-3">User Selection</th>
                <th className="px-5 py-3">yt-dlp Format Selector</th>
                <th className="px-5 py-3">FFmpeg Step</th>
                <th className="px-5 py-3">Output Behavior</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1f1f27]">
              {FORMAT_MATRIX.map((row) => (
                <tr key={row.selection} className="hover:bg-[#17171d]">
                  <td className="px-5 py-3.5 text-xs font-semibold text-[#f4f4f6] whitespace-nowrap">
                    {row.selection}
                  </td>
                  <td className="px-5 py-3.5 font-mono text-[11.5px] text-[#d4d4e0]">
                    {row.formatExpr}
                  </td>
                  <td className="px-5 py-3.5 font-mono text-[11.5px] text-[#9a9aa8]">
                    {row.postprocessing}
                  </td>
                  <td className="px-5 py-3.5 text-xs leading-relaxed text-[#b2b2c0]">
                    {row.result}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
