import React, { useState } from 'react';
import { FolderPlus, X } from 'lucide-react';

interface AlbumPickerSheetProps {
  open: boolean;
  targetCount: number;
  currentAlbum?: string | null;
  existingAlbums: string[];
  onClose: () => void;
  onSelectAlbum: (albumName: string | null) => Promise<void>;
}

export const AlbumPickerSheet: React.FC<AlbumPickerSheetProps> = ({
  open,
  targetCount,
  currentAlbum,
  existingAlbums,
  onClose,
  onSelectAlbum,
}) => {
  const [newAlbumName, setNewAlbumName] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const handleChoose = async (name: string | null) => {
    setSaving(true);
    try {
      await onSelectAlbum(name);
      setNewAlbumName('');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAndAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newAlbumName.trim();
    if (!trimmed) return;
    await handleChoose(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 backdrop-blur-xs">
      <div className="fixed inset-0" onClick={onClose} />
      <div className="relative z-10 w-full md:max-w-md rounded-t-3xl md:rounded-2xl bg-zinc-950 border-t md:border border-white/15 p-5 pb-safe space-y-5 max-h-[85dvh] flex flex-col">
        <div className="w-10 h-1 rounded-full bg-zinc-700 mx-auto md:hidden" />

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Add to album</h2>
            <p className="text-xs text-zinc-400">
              {targetCount} {targetCount === 1 ? 'item' : 'items'} selected
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-10 h-10 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCreateAndAssign} className="flex items-center gap-2">
          <input
            type="text"
            value={newAlbumName}
            onChange={(e) => setNewAlbumName(e.target.value)}
            placeholder="New album name..."
            className="flex-1 h-11 px-3.5 rounded-xl bg-zinc-900 border border-white/10 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/30"
          />
          <button
            type="submit"
            disabled={saving || !newAlbumName.trim()}
            className="h-11 px-4 rounded-xl bg-white text-black text-xs font-semibold disabled:opacity-40 whitespace-nowrap"
          >
            Create
          </button>
        </form>

        <div className="overflow-y-auto space-y-1.5 pr-1">
          {currentAlbum && (
            <button
              type="button"
              disabled={saving}
              onClick={() => handleChoose(null)}
              className="w-full h-12 px-3.5 rounded-xl bg-zinc-900/70 hover:bg-zinc-900 border border-white/5 text-left text-xs font-medium text-zinc-300 flex items-center justify-between"
            >
              <span>Remove from &ldquo;{currentAlbum}&rdquo;</span>
            </button>
          )}

          {existingAlbums.length === 0 ? (
            <p className="text-xs text-zinc-500 py-4 text-center">
              No albums yet. Create your first album above.
            </p>
          ) : (
            existingAlbums.map((album) => {
              const isCurrent = currentAlbum === album;
              return (
                <button
                  key={album}
                  type="button"
                  disabled={saving}
                  onClick={() => handleChoose(album)}
                  className={`w-full h-12 px-3.5 rounded-xl border text-left text-sm font-medium flex items-center justify-between transition-colors ${
                    isCurrent
                      ? 'bg-[#FE2C55]/15 border-[#FE2C55]/40 text-white'
                      : 'bg-zinc-900 hover:bg-zinc-800 border-white/5 text-white'
                  }`}
                >
                  <span className="truncate flex items-center gap-2.5">
                    <FolderPlus className="w-4 h-4 text-zinc-400 shrink-0" />
                    <span className="truncate">{album}</span>
                  </span>
                  {isCurrent && <span className="text-xs text-[#FE2C55]">Current</span>}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
