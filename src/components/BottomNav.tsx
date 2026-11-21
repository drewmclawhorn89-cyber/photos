import React from 'react';
import { FolderHeart, Heart, Images, Plus, Trash2 } from 'lucide-react';
import { AppTab } from '../types/photo';

interface BottomNavProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  onTriggerUpload: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
  onTriggerUpload,
}) => {
  return (
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-black/95 backdrop-blur-md border-t border-white/10 pb-safe"
    >
      <div className="grid grid-cols-5 items-center h-14 px-1">
        <button
          type="button"
          onClick={() => onSelectTab('home')}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
            activeTab === 'home' ? 'text-white' : 'text-zinc-500'
          }`}
        >
          <Images className="w-5 h-5" strokeWidth={activeTab === 'home' ? 2.4 : 1.8} />
          <span className="text-[10px] font-medium tracking-tight">Photos</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('albums')}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
            activeTab === 'albums' ? 'text-white' : 'text-zinc-500'
          }`}
        >
          <FolderHeart className="w-5 h-5" strokeWidth={activeTab === 'albums' ? 2.4 : 1.8} />
          <span className="text-[10px] font-medium tracking-tight">Albums</span>
        </button>

        {/* TikTok-style center upload action button */}
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={onTriggerUpload}
            aria-label="Upload photos and videos"
            className="relative w-12 h-9 rounded-xl bg-white text-black flex items-center justify-center active:scale-95 transition-transform shadow-[2px_0_0_#FE2C55,-2px_0_0_#25F4EE]"
          >
            <Plus className="w-5 h-5 stroke-[2.6]" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => onSelectTab('favorites')}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
            activeTab === 'favorites' ? 'text-[#FE2C55]' : 'text-zinc-500'
          }`}
        >
          <Heart
            className="w-5 h-5"
            strokeWidth={activeTab === 'favorites' ? 2.4 : 1.8}
            fill={activeTab === 'favorites' ? '#FE2C55' : 'none'}
          />
          <span className="text-[10px] font-medium tracking-tight">Favorites</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('trash')}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
            activeTab === 'trash' ? 'text-white' : 'text-zinc-500'
          }`}
        >
          <Trash2 className="w-5 h-5" strokeWidth={activeTab === 'trash' ? 2.4 : 1.8} />
          <span className="text-[10px] font-medium tracking-tight">Trash</span>
        </button>
      </div>
    </nav>
  );
};
