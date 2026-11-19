import { useState } from "react";
import { Download, Menu, X } from "lucide-react";
import type { ActiveTab } from "../types";

interface TopBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
}

const NAV_ITEMS: Array<{ id: ActiveTab; label: string }> = [
  { id: "downloader", label: "Downloader" },
  { id: "source", label: "Source Files" },
  { id: "setup", label: "Setup & Run" },
  { id: "architecture", label: "Architecture" },
];

export function TopBar({ activeTab, onSelectTab }: TopBarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNav = (id: ActiveTab) => {
    onSelectTab(id);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-[#22222b] bg-[#0a0a0c]/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between gap-8 px-4 sm:h-16 sm:px-6 lg:px-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => handleNav("downloader")}
          className="inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap text-left font-display text-lg font-bold tracking-tight text-[#f4f4f6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e51d2e] rounded-md"
        >
          <span
            aria-hidden="true"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-[#e51d2e]"
          >
            <Download className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
          </span>
          <span>LocalTube</span>
        </button>

        {/* Zone 2: 4 Clean Single-Line Navigation Links */}
        <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-7">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={`relative whitespace-nowrap shrink-0 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e51d2e] rounded-sm ${
                  isActive ? "text-[#f4f4f6]" : "text-[#9a9aa8] hover:text-[#f4f4f6]"
                }`}
              >
                {item.label}
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-0 -bottom-[19px] h-[2px] bg-[#e51d2e] transition-opacity duration-150 ${
                    isActive ? "opacity-100" : "opacity-0"
                  }`}
                />
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 Primary Action + Mobile Menu Trigger */}
        <div className="flex shrink-0 items-center gap-2.5">
          <a
            href="/api/bundle.zip"
            download="localtube-downloader.zip"
            className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-[#e51d2e] px-4 text-xs font-semibold text-white transition-colors duration-150 hover:bg-[#f22e3f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e51d2e] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c] sm:h-10 sm:text-sm"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
            <span>Download .zip</span>
          </a>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileMenuOpen}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#262630] bg-[#131317] text-[#d4d4dc] md:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e51d2e]"
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile Nav Drawer (only opens on click — keeps idle mobile sticky chrome <= 56px) */}
      {mobileMenuOpen && (
        <nav
          aria-label="Mobile navigation"
          className="border-t border-[#22222b] bg-[#0f0f13] px-4 py-3 md:hidden"
        >
          <div className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNav(item.id)}
                  className={`flex h-11 items-center justify-between rounded-lg px-3 text-left text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-[#1b1b22] text-white"
                      : "text-[#a1a1b0] hover:bg-[#15151b] hover:text-white"
                  }`}
                >
                  <span>{item.label}</span>
                  {isActive && <span className="text-xs font-mono text-[#e51d2e]">Active</span>}
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </header>
  );
}
