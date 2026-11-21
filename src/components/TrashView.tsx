import React, { useState } from 'react';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import type { PhotoItem } from '../types/photo';
import { formatBytes } from '../lib/mediaCompression';
import { MediaTile } from './MediaTile';

interface TrashViewProps {
  trashPhotos: PhotoItem[];
  onOpenFullscreen: (photo: PhotoItem, orderedList: PhotoItem[]) => void;
  onRestore: (photo: PhotoItem) => Promise<void>;
  onPermanentDelete: (photo: PhotoItem) => Promise<void>;
  onEmptyTrash: () => Promise<void>;
}

export const TrashView: React.FC<TrashViewProps> = ({
  trashPhotos,
  onOpenFullscreen,
  onRestore,
  onPermanentDelete,
  onEmptyTrash,
}) => {
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);

  const totalTrashSize = trashPhotos.reduce((acc, p) => acc + (p.file_size || 0), 0);

  const handleRestore = async (photo: PhotoItem) => {
    setBusyId(photo.id);
    try {
      await onRestore(photo);
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteForever = async (photo: PhotoItem) => {
    setBusyId(photo.id);
    try {
      await onPermanentDelete(photo);
    } finally {
      setBusyId(null);
    }
  };

  const handleEmptyConfirm = async () => {
    setEmptying(true);
    try {
      await onEmptyTrash();
      setConfirmEmpty(false);
    } finally {
      setEmptying(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-3 md:px-6 pt-4 pb-24 md:pb-12 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Trash</h1>
          <p className="text-xs text-zinc-400 tabular-nums">
            {trashPhotos.length} {trashPhotos.length === 1 ? 'item' : 'items'} · {formatBytes(totalTrashSize)}
          </p>
        </div>

        {trashPhotos.length > 0 && !confirmEmpty && (
          <button
            type="button"
            onClick={() => setConfirmEmpty(true)}
            className="h-10 px-4 rounded-xl bg-zinc-900 border border-white/15 hover:border-[#FE2C55]/50 text-xs font-semibold text-[#FF6B86] whitespace-nowrap"
          >
            Empty trash
          </button>
        )}
      </div>

      {confirmEmpty && (
        <div className="rounded-2xl bg-zinc-950 border border-[#FE2C55]/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-xs text-zinc-200">
            Permanently delete all {trashPhotos.length} items from Cloudflare R2 and your cloud database? This cannot be undone.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={emptying}
              onClick={() => setConfirmEmpty(false)}
              className="h-10 px-4 rounded-xl bg-zinc-800 text-xs font-medium text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={emptying}
              onClick={handleEmptyConfirm}
              className="h-10 px-4 rounded-xl bg-[#FE2C55] text-xs font-semibold text-white flex items-center gap-1.5"
            >
              {emptying && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Delete all forever</span>
            </button>
          </div>
        </div>
      )}

      {trashPhotos.length === 0 ? (
        <div className="py-20 text-center max-w-sm mx-auto space-y-2">
          <Trash2 className="w-10 h-10 text-zinc-600 mx-auto" />
          <p className="text-base font-semibold text-white">Trash is empty</p>
          <p className="text-sm text-zinc-400">
            Deleted photos and videos land here first so you can restore them or permanently free up R2 storage.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {trashPhotos.map((photo) => {
            const isBusy = busyId === photo.id;
            return (
              <div
                key={photo.id}
                className="rounded-xl bg-zinc-950 border border-white/10 overflow-hidden flex flex-col"
              >
                <MediaTile
                  photo={photo}
                  onTap={(item) => onOpenFullscreen(item, trashPhotos)}
                />

                <div className="p-2 flex items-center justify-between gap-1.5 bg-zinc-950">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleRestore(photo)}
                    className="flex-1 h-9 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-[11px] font-medium text-white flex items-center justify-center gap-1 disabled:opacity-40"
                  >
                    {isBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                    <span>Restore</span>
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleDeleteForever(photo)}
                    aria-label="Delete permanently"
                    className="h-9 px-2.5 rounded-lg bg-[#FE2C55]/15 hover:bg-[#FE2C55]/25 text-[11px] font-semibold text-[#FF6B86] flex items-center justify-center disabled:opacity-40"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
