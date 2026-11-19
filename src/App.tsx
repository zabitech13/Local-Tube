import { useEffect, useState } from "react";
import { TopBar } from "./components/TopBar";
import { DownloaderWorkspace } from "./components/DownloaderWorkspace";
import { SourceExplorer } from "./components/SourceExplorer";
import { SetupGuide } from "./components/SetupGuide";
import { ArchitectureView } from "./components/ArchitectureView";
import type { ActiveTab, SourceFileRecord } from "./types";

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("downloader");
  const [sourceFiles, setSourceFiles] = useState<SourceFileRecord[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string>("app.py");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sources")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load sources"))))
      .then((data: { files: SourceFileRecord[] }) => {
        if (!cancelled && Array.isArray(data.files)) {
          setSourceFiles(data.files);
        }
      })
      .catch(() => {
        // Handled cleanly in empty state if request fails
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleInspectFile = (fileId: string) => {
    setSelectedFileId(fileId);
    setActiveTab("source");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSelectTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#0a0a0c] text-[#f4f4f6]">
      <TopBar activeTab={activeTab} onSelectTab={handleSelectTab} />

      <main className="flex-1">
        {activeTab === "downloader" && (
          <DownloaderWorkspace
            sourceFiles={sourceFiles}
            onInspectFile={handleInspectFile}
            onNavigate={handleSelectTab}
          />
        )}

        {activeTab === "source" && (
          <SourceExplorer
            files={sourceFiles}
            selectedFileId={selectedFileId}
            onSelectFile={setSelectedFileId}
          />
        )}

        {activeTab === "setup" && <SetupGuide />}

        {activeTab === "architecture" && <ArchitectureView />}
      </main>

      <footer className="mt-12 border-t border-[#1e1e26]">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-4 py-6 text-xs text-[#737384] sm:px-6 lg:px-8">
          <span>LocalTube · Personal-use local YouTube downloader utility</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => handleSelectTab("source")}
              className="transition-colors hover:text-[#d4d4dc]"
            >
              View app.py &amp; index.html
            </button>
            <span aria-hidden="true" className="text-[#343440]">
              ·
            </span>
            <button
              type="button"
              onClick={() => handleSelectTab("setup")}
              className="transition-colors hover:text-[#d4d4dc]"
            >
              Local setup guide
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
