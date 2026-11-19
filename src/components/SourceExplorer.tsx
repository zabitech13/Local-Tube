import { useMemo, useState } from "react";
import { Check, Copy, Download, FileCode2, Search } from "lucide-react";
import type { SourceFileRecord } from "../types";

interface SourceExplorerProps {
  files: SourceFileRecord[];
  selectedFileId: string;
  onSelectFile: (fileId: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function getDownloadSlug(fileId: string): string {
  if (fileId === "templates/index.html") return "index.html";
  return fileId;
}

export function SourceExplorer({ files, selectedFileId, onSelectFile }: SourceExplorerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeFile = files.find((f) => f.id === selectedFileId) || files[0] || null;

  const lines = useMemo(() => {
    if (!activeFile) return [];
    return activeFile.content.split("\n");
  }, [activeFile]);

  const matchingLineNumbers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return new Set<number>();
    const matches = new Set<number>();
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(q)) {
        matches.add(index + 1);
      }
    });
    return matches;
  }, [lines, searchQuery]);

  const handleCopyFile = async () => {
    if (!activeFile) return;
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopiedId(activeFile.id);
      window.setTimeout(() => setCopiedId((prev) => (prev === activeFile.id ? null : prev)), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

  if (!activeFile) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6 lg:px-8">
        <p className="text-sm text-[#9a9aa8]">Loading source files…</p>
      </div>
    );
  }

  const isCopied = copiedId === activeFile.id;
  const queryActive = searchQuery.trim().length > 0;

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-[#f4f4f6]">
            Complete Source Files
          </h1>
          <p className="mt-1.5 text-sm text-[#a1a1b0]">
            Every file is served directly from disk and matches the downloadable local archive byte
            for byte.
          </p>
        </div>

        <a
          href="/api/bundle.zip"
          download="localtube-downloader.zip"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#2f2f3b] bg-[#16161c] px-4 text-xs font-semibold text-[#f4f4f6] transition-colors hover:border-[#424252] hover:bg-[#1e1e26]"
        >
          <Download className="h-3.5 w-3.5" />
          <span>Download all as .zip</span>
        </a>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr] lg:items-start">
        {/* File List Sidebar */}
        <aside className="rounded-xl border border-[#24242d] bg-[#121216] p-3">
          <div className="mb-2 px-2.5 pt-1 text-xs font-semibold text-[#8a8a9b]">
            Project Directory
          </div>
          <ul className="space-y-1">
            {files.map((file) => {
              const selected = file.id === activeFile.id;
              return (
                <li key={file.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectFile(file.id);
                      setSearchQuery("");
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2.5 text-left transition-colors ${
                      selected
                        ? "bg-[#1d1d25] text-white"
                        : "text-[#a1a1b0] hover:bg-[#17171d] hover:text-white"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FileCode2
                        className={`h-4 w-4 shrink-0 ${
                          selected ? "text-[#e51d2e]" : "text-[#6f6f80]"
                        }`}
                      />
                      <span className="truncate font-mono text-xs font-medium">{file.path}</span>
                    </span>
                    <span className="tabular-nums shrink-0 font-mono text-[11px] text-[#757586]">
                      {formatFileSize(file.bytes)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Code Viewer */}
        <section className="min-w-0 overflow-hidden rounded-xl border border-[#24242d] bg-[#121216]">
          {/* Viewer Toolbar */}
          <div className="flex flex-col gap-3 border-b border-[#22222b] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-mono text-sm font-semibold text-[#f4f4f6]">
                  {activeFile.path}
                </h2>
                <span aria-hidden="true" className="text-[#4a4a58]">
                  ·
                </span>
                <span className="tabular-nums font-mono text-xs text-[#8f8fa0]">
                  {activeFile.lines} lines
                </span>
                <span aria-hidden="true" className="text-[#4a4a58]">
                  ·
                </span>
                <span className="tabular-nums font-mono text-xs text-[#8f8fa0]">
                  {formatFileSize(activeFile.bytes)}
                </span>
              </div>
              <p className="mt-1 text-xs text-[#8f8fa0]">{activeFile.description}</p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6e6e80]" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Find in file…"
                  aria-label={`Search inside ${activeFile.path}`}
                  className="h-9 w-40 rounded-lg border border-[#2a2a35] bg-[#0a0a0c] pl-8 pr-3 text-xs text-[#f4f4f6] placeholder:text-[#666676] focus:border-[#e51d2e] focus:outline-none sm:w-44"
                />
              </div>

              <button
                type="button"
                onClick={handleCopyFile}
                className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#2f2f3b] bg-[#191921] px-3 text-xs font-medium text-[#f4f4f6] transition-colors hover:bg-[#23232e]"
              >
                {isCopied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#22c55e]" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy file</span>
                  </>
                )}
              </button>

              <a
                href={`/api/source/${encodeURIComponent(getDownloadSlug(activeFile.id))}`}
                download={getDownloadSlug(activeFile.id)}
                className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#e51d2e] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#f22e3f]"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download</span>
              </a>
            </div>
          </div>

          {queryActive && (
            <div className="border-b border-[#22222b] bg-[#16161d] px-5 py-2 font-mono text-xs text-[#a1a1b0] tabular-nums">
              {matchingLineNumbers.size === 0
                ? `No matches for "${searchQuery.trim()}"`
                : `${matchingLineNumbers.size} matching ${
                    matchingLineNumbers.size === 1 ? "line" : "lines"
                  } highlighted below`}
            </div>
          )}

          {/* Code Display */}
          <div className="max-h-[680px] overflow-auto bg-[#0b0b0e] p-4 font-mono text-[12.5px] leading-[1.65]">
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((line, index) => {
                  const lineNo = index + 1;
                  const isMatch = matchingLineNumbers.has(lineNo);
                  const trimmed = line.trimStart();
                  const isComment =
                    trimmed.startsWith("#") ||
                    trimmed.startsWith("//") ||
                    trimmed.startsWith("<!--") ||
                    trimmed.startsWith("/*");

                  return (
                    <tr
                      key={lineNo}
                      className={isMatch ? "bg-[#e51d2e]/15" : "hover:bg-[#14141a]"}
                    >
                      <td className="tabular-nums w-12 select-none pr-4 text-right align-top text-[#555566]">
                        {lineNo}
                      </td>
                      <td
                        className={`whitespace-pre pr-4 align-top ${
                          isComment ? "text-[#7a7a8e]" : "text-[#e4e4ee]"
                        }`}
                      >
                        {line || " "}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
