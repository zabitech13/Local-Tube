import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";

type TargetOs = "windows" | "macos" | "linux";

interface SetupStep {
  index: string;
  title: string;
  summary: string;
  command: string;
  note?: string;
}

const STEPS_BY_OS: Record<TargetOs, SetupStep[]> = {
  windows: [
    {
      index: "01",
      title: "Install Python 3.10+ and FFmpeg",
      summary:
        "Install Python from python.org (check 'Add python.exe to PATH') and install FFmpeg via winget so yt-dlp can merge high-resolution video and audio.",
      command: "winget install Gyan.FFmpeg\nffmpeg -version",
      note: "Close and reopen PowerShell after installing FFmpeg so Windows picks up the updated PATH.",
    },
    {
      index: "02",
      title: "Extract the LocalTube folder",
      summary:
        "Click Download .zip in the top bar, unzip localtube-downloader.zip, and open PowerShell inside the extracted localtube folder.",
      command: "cd path\\to\\localtube\ndir",
      note: "Verify app.py, requirements.txt, and templates\\index.html are present.",
    },
    {
      index: "03",
      title: "Create a virtual environment & install dependencies",
      summary: "Isolate Flask and yt-dlp inside a project-local Python virtual environment.",
      command:
        "python -m venv .venv\n.\\.venv\\Scripts\\Activate.ps1\npip install -r requirements.txt",
      note: "If PowerShell blocks script activation, run: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned",
    },
    {
      index: "04",
      title: "Launch LocalTube on 127.0.0.1:5000",
      summary:
        "Start the Flask server. It binds strictly to 127.0.0.1 so no other device on your Wi-Fi or LAN can reach it.",
      command: "python app.py",
      note: "Open http://127.0.0.1:5000 in your browser. Press Ctrl+C in PowerShell to stop.",
    },
    {
      index: "05",
      title: "Update yt-dlp whenever YouTube changes player signatures",
      summary:
        "YouTube updates its extraction rules frequently. Running this single command keeps downloads reliable.",
      command: "pip install -U yt-dlp",
    },
  ],
  macos: [
    {
      index: "01",
      title: "Install Python 3 and FFmpeg via Homebrew",
      summary:
        "FFmpeg handles lossless MKV/MP4 stream merging (bestvideo+bestaudio) and best-quality MP3 audio extraction.",
      command: "brew install python ffmpeg\nffmpeg -version",
    },
    {
      index: "02",
      title: "Unzip the LocalTube project",
      summary:
        "Download the archive from the top bar, extract it, and open Terminal in the localtube directory.",
      command: "unzip localtube-downloader.zip\ncd localtube",
    },
    {
      index: "03",
      title: "Create a virtual environment & install packages",
      summary: "Install Flask and yt-dlp cleanly without modifying system Python packages.",
      command:
        "python3 -m venv .venv\nsource .venv/bin/activate\npip install -r requirements.txt",
    },
    {
      index: "04",
      title: "Start the local server",
      summary:
        "Run app.py. macOS AirPlay Receiver occasionally occupies port 5000 — you can override the port via LOCALTUBE_PORT if needed.",
      command: "python3 app.py\n# Or if port 5000 is taken by AirPlay Receiver:\nLOCALTUBE_PORT=5050 python3 app.py",
      note: "Then visit http://127.0.0.1:5000 (or http://127.0.0.1:5050) in Safari, Chrome, or Firefox.",
    },
    {
      index: "05",
      title: "Keep yt-dlp current",
      summary: "Update yt-dlp inside your virtual environment whenever a video fails to extract.",
      command: "pip install -U yt-dlp",
    },
  ],
  linux: [
    {
      index: "01",
      title: "Install Python 3 venv and FFmpeg",
      summary: "Install FFmpeg and Python virtual environment tooling from your package manager.",
      command: "sudo apt update && sudo apt install -y python3 python3-venv ffmpeg\nffmpeg -version",
      note: "On Fedora/RHEL use: sudo dnf install python3 ffmpeg. On Arch: sudo pacman -S python ffmpeg.",
    },
    {
      index: "02",
      title: "Extract the LocalTube bundle",
      summary: "Unzip localtube-downloader.zip and move into the project directory.",
      command: "unzip localtube-downloader.zip\ncd localtube",
    },
    {
      index: "03",
      title: "Create a virtual environment & install dependencies",
      summary: "Install Flask and the latest yt-dlp release into .venv.",
      command:
        "python3 -m venv .venv\nsource .venv/bin/activate\npip install -r requirements.txt",
    },
    {
      index: "04",
      title: "Run LocalTube locally (127.0.0.1 only)",
      summary: "Start the threaded Flask app bound strictly to the loopback interface.",
      command: "python3 app.py",
      note: "Navigate to http://127.0.0.1:5000 in your browser.",
    },
    {
      index: "05",
      title: "Keep yt-dlp up to date",
      summary: "Refresh yt-dlp periodically to stay ahead of YouTube extraction updates.",
      command: "pip install -U yt-dlp",
    },
  ],
};

const TROUBLESHOOTING = [
  {
    q: "Why does Best Quality default to MKV instead of MP4?",
    a: "YouTube serves 4K and 1440p streams in VP9 or AV1 paired with Opus audio. Matroska (MKV) remuxes those original streams losslessly via FFmpeg in seconds without re-encoding or dropping quality. Toggle MP4 whenever you need playback on older hardware or iOS QuickTime.",
  },
  {
    q: "Where are downloaded files stored on my PC?",
    a: "During downloading and FFmpeg merging, temporary files live under your OS temp folder (localtube_downloads). Once you click Save file, your browser saves the finished video to your regular Downloads folder using the video's title, and temp jobs older than 2 hours are cleaned up automatically.",
  },
  {
    q: "What if FFmpeg says not found after installing?",
    a: "Terminal windows cache your PATH at startup. Close every open terminal window, launch a fresh terminal, and verify `ffmpeg -version` prints a version banner before starting `python app.py`.",
  },
];

export function SetupGuide() {
  const [os, setOs] = useState<TargetOs>("windows");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const steps = STEPS_BY_OS[os];

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-[#f4f4f6]">
            Install &amp; Run on Your PC
          </h1>
          <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-[#a1a1b0]">
            Complete local setup for Python Flask, yt-dlp, and FFmpeg. Select your operating system
            below for copy-ready commands.
          </p>
        </div>

        {/* OS Segmented Control */}
        <div
          role="group"
          aria-label="Select operating system"
          className="inline-flex shrink-0 rounded-lg border border-[#24242d] bg-[#121216] p-1"
        >
          {(
            [
              { id: "windows", label: "Windows" },
              { id: "macos", label: "macOS" },
              { id: "linux", label: "Linux" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setOs(item.id)}
              className={`h-9 whitespace-nowrap rounded-md px-4 text-xs font-semibold transition-colors ${
                os === item.id ? "bg-[#e51d2e] text-white" : "text-[#a1a1b0] hover:text-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Step List */}
      <div className="divide-y divide-[#22222b] rounded-2xl border border-[#24242d] bg-[#121216]">
        {steps.map((step) => {
          const copyId = `${os}-${step.index}`;
          const isCopied = copiedKey === copyId;

          return (
            <div key={copyId} className="p-5 sm:p-6">
              <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_1.15fr] lg:items-start lg:gap-8">
                <div>
                  <h2 className="font-display text-base font-semibold text-[#f4f4f6]">
                    <span className="tabular-nums mr-2 font-mono text-sm text-[#e51d2e]">
                      {step.index}.
                    </span>
                    {step.title}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-[#a1a1b0]">{step.summary}</p>
                  {step.note && (
                    <p className="mt-2.5 text-xs leading-relaxed text-[#7c7c8e]">{step.note}</p>
                  )}
                </div>

                <div className="overflow-hidden rounded-xl border border-[#24242d] bg-[#0a0a0c]">
                  <div className="flex items-center justify-between border-b border-[#1c1c24] px-3.5 py-2">
                    <span className="font-mono text-[11px] text-[#757586]">
                      {os === "windows" ? "PowerShell" : "Terminal"}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(copyId, step.command)}
                      className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-[#a1a1b0] transition-colors hover:bg-[#17171f] hover:text-white"
                    >
                      {isCopied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-[#22c55e]" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="overflow-x-auto p-3.5 font-mono text-xs leading-relaxed text-[#e8e8f0]">
                    <code>{step.command}</code>
                  </pre>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Troubleshooting & Notes */}
      <section className="mt-10">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <h2 className="font-display text-xl font-bold text-[#f4f4f6]">
            Practical Notes &amp; Troubleshooting
          </h2>
          <a
            href="/api/bundle.zip"
            download="localtube-downloader.zip"
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg bg-[#e51d2e] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#f22e3f]"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download localtube-downloader.zip</span>
          </a>
        </div>

        <div className="divide-y divide-[#22222b] rounded-2xl border border-[#24242d] bg-[#121216]">
          {TROUBLESHOOTING.map((item) => (
            <div key={item.q} className="p-5 sm:p-6">
              <h3 className="text-sm font-semibold text-[#f4f4f6]">{item.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#a1a1b0]">{item.a}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
