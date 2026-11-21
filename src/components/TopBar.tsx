import React, { useState } from 'react';
import { LogOut, Plus } from 'lucide-react';
import { AppTab, FREE_STORAGE_LIMIT_BYTES } from '../types/photo';
import { formatStorageGb } from '../lib/mediaCompression';

interface TopBarProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  totalUsedBytes: number;
  userEmail: string;
  onTriggerUpload: () => void;
  onSignOut: () => void;
}

const NAV_ITEMS: { id: AppTab; label: string }[] = [
  { id: 'home', label: 'Photos' },
  { id: 'albums', label: 'Albums' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'trash', label: 'Trash' },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  totalUsedBytes,
  userEmail,
  onTriggerUpload,
  onSignOut,
}) => {
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  const usedPct = Math.min(100, (totalUsedBytes / FREE_STORAGE_LIMIT_BYTES) * 100);
  const usedGbText = formatStorageGb(totalUsedBytes);
  const barColor =
    usedPct >= 90 ? 'bg-[#FE2C55]' : usedPct >= 75 ? 'bg-amber-400' : 'bg-white';

  const initials = (userEmail?.[0] || 'U').toUpperCase();

  return (
    <header className="sticky top-0 z-30 bg-black/90 backdrop-blur-md border-b border-white/10 pt-safe">
      <div className="max-w-7xl mx-auto px-4 md:px-6 h-12 md:h-14 flex items-center justify-between gap-4 md:gap-8">
        {/* Zone 1: Brand wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('home')}
          className="text-base md:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
        >
          My Photos
        </button>

        {/* Zone 2: Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-6" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative py-1.5 text-sm font-medium whitespace-nowrap shrink-0 transition-colors ${
                  isActive ? 'text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {item.label}
                {isActive && (
                  <span className="absolute left-0 right-0 -bottom-0.5 h-0.5 bg-[#FE2C55] rounded-full" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Storage meter + Primary Upload CTA + Account */}
        <div className="flex items-center gap-3 shrink-0">
          <div
            className="text-right leading-tight"
            title={`${usedGbText} GB used out of 10 GB free`}
          >
            <span className="text-[11px] md:text-xs font-mono tabular-nums text-zinc-300 whitespace-nowrap">
              {usedGbText} / 10 GB
            </span>
          </div>

          <button
            type="button"
            onClick={onTriggerUpload}
            className="hidden md:inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-white text-black text-xs font-semibold hover:bg-zinc-200 active:scale-[0.98] transition-all whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Upload</span>
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowAccountMenu((prev) => !prev)}
              aria-label="Account menu"
              className="w-9 h-9 md:w-9 md:h-9 rounded-full bg-zinc-900 border border-white/15 text-xs font-semibold text-white flex items-center justify-center hover:border-white/40 transition-colors"
            >
              {initials}
            </button>

            {showAccountMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowAccountMenu(false)}
                />
                <div className="absolute right-0 mt-2 w-60 rounded-2xl bg-zinc-950 border border-white/15 shadow-2xl p-3 z-50 space-y-3">
                  <div className="px-1">
                    <p className="text-[11px] text-zinc-500">Signed in as</p>
                    <p className="text-xs font-medium text-white truncate">{userEmail}</p>
                  </div>
                  <div className="border-t border-white/10 pt-2">
                    <p className="text-[11px] text-zinc-400 px-1 mb-1.5 font-mono tabular-nums">
                      Cloud storage: {usedGbText} GB / 10 GB free
                    </p>
                    <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden mx-1">
                      <div
                        className={`h-full transition-all duration-300 ${barColor}`}
                        style={{ width: `${Math.max(usedPct > 0 ? 2 : 0, usedPct)}%` }}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAccountMenu(false);
                      onSignOut();
                    }}
                    className="w-full h-10 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-xs font-medium text-white flex items-center gap-2 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Sign out</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Slim full-width 2px storage capacity bar */}
      <div className="h-[2px] w-full bg-zinc-900">
        <div
          className={`h-full transition-all duration-500 ${barColor}`}
          style={{ width: `${Math.max(usedPct > 0 ? 1 : 0, usedPct)}%` }}
        />
      </div>
    </header>
  );
};
