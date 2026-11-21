import React, { useMemo, useState } from 'react';
import { CheckSquare, FolderPlus, Search, Trash2, Upload, X } from 'lucide-react';
import type { PhotoItem } from '../types/photo';
import { formatBytes } from '../lib/mediaCompression';
import { MediaTile } from './MediaTile';

interface PhotoGridProps {
  photos: PhotoItem[];
  loading: boolean;
  title?: string;
  emptyTitle: string;
  emptySubtitle: string;
  showSearch?: boolean;
  showUploadCta?: boolean;
  onTriggerUpload?: () => void;
  onOpenFullscreen: (photo: PhotoItem, orderedList: PhotoItem[]) => void;
  onBatchAddToAlbum: (ids: string[]) => void;
  onBatchMoveToTrash: (photos: PhotoItem[]) => void;
}

function formatDateHeading(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'Unknown date';

  const now = new Date();
  const todayKey = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === todayKey) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: sameYear ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

function getDateGroupKey(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

export const PhotoGrid: React.FC<PhotoGridProps> = ({
  photos,
  loading,
  title,
  emptyTitle,
  emptySubtitle,
  showSearch = true,
  showUploadCta = true,
  onTriggerUpload,
  onOpenFullscreen,
  onBatchAddToAlbum,
  onBatchMoveToTrash,
}) => {
  const [query, setQuery] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const filteredPhotos = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return photos;
    return photos.filter((item) => {
      const matchName = item.file_name.toLowerCase().includes(q);
      const matchAlbum = (item.album ?? '').toLowerCase().includes(q);
      const isVid = item.file_type.startsWith('video/');
      const matchType =
        (q === 'video' || q === 'videos') ? isVid : (q === 'photo' || q === 'photos') ? !isVid : false;
      return matchName || matchAlbum || matchType;
    });
  }, [photos, query]);

  const grouped = useMemo(() => {
    const groups: { key: string; label: string; items: PhotoItem[]; totalSize: number }[] = [];
    const map = new Map<string, number>();

    for (const item of filteredPhotos) {
      const key = getDateGroupKey(item.created_at);
      let idx = map.get(key);
      if (idx === undefined) {
        idx = groups.length;
        map.set(key, idx);
        groups.push({
          key,
          label: formatDateHeading(item.created_at),
          items: [],
          totalSize: 0,
        });
      }
      groups[idx].items.push(item);
      groups[idx].totalSize += item.file_size || 0;
    }

    return groups;
  }, [filteredPhotos]);

  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds([]);
  };

  const selectedPhotos = useMemo(
    () => photos.filter((p) => selectedIds.includes(p.id)),
    [photos, selectedIds]
  );

  return (
    <div className="max-w-7xl mx-auto px-0 md:px-6 pt-3 pb-24 md:pb-12 space-y-4">
      {/* Toolbar: Search & Select */}
      {(showSearch || photos.length > 0) && (
        <div className="px-3 md:px-0 flex items-center gap-2.5">
          {title && !showSearch && (
            <h1 className="text-xl font-bold tracking-tight text-white flex-1">{title}</h1>
          )}

          {showSearch && (
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search photos, videos, or albums..."
                aria-label="Search media"
                className="w-full h-11 pl-10 pr-9 rounded-xl bg-zinc-900/90 border border-white/10 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/30 transition-colors"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {photos.length > 0 && (
            <button
              type="button"
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              className={`h-11 px-3.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                selectMode
                  ? 'bg-white text-black border-white'
                  : 'bg-zinc-900 border-white/10 text-zinc-200 hover:border-white/30'
              }`}
            >
              <CheckSquare className="w-4 h-4" />
              <span>{selectMode ? 'Cancel' : 'Select'}</span>
            </button>
          )}
        </div>
      )}

      {/* Batch selection bar */}
      {selectMode && (
        <div className="mx-3 md:mx-0 rounded-xl bg-zinc-900 border border-white/15 px-3.5 py-2.5 flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-white tabular-nums">
            {selectedIds.length} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={() => {
                onBatchAddToAlbum(selectedIds);
                exitSelectMode();
              }}
              className="h-9 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-white disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Album</span>
            </button>
            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={() => {
                onBatchMoveToTrash(selectedPhotos);
                exitSelectMode();
              }}
              className="h-9 px-3 rounded-lg bg-[#FE2C55] hover:bg-[#e0244a] text-xs font-semibold text-white disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Trash</span>
            </button>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-0.5 md:gap-1.5">
          {Array.from({ length: 12 }).map((_, idx) => (
            <div key={idx} className="aspect-square bg-zinc-900 animate-pulse md:rounded-md" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <div className="px-6 py-20 text-center max-w-md mx-auto space-y-4">
          <p className="text-lg font-semibold text-white">
            {query ? 'No matching items' : emptyTitle}
          </p>
          <p className="text-sm text-zinc-400">
            {query ? `Nothing matched "${query}".` : emptySubtitle}
          </p>
          {showUploadCta && !query && onTriggerUpload && (
            <button
              type="button"
              onClick={onTriggerUpload}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-white text-black text-sm font-semibold hover:bg-zinc-200 transition-colors"
            >
              <Upload className="w-4 h-4" />
              <span>Upload photos &amp; videos</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.key} className="space-y-2">
              <div className="px-3 md:px-0 flex items-baseline justify-between gap-4">
                <h2 className="text-sm md:text-base font-semibold text-white tracking-tight">
                  {group.label}
                </h2>
                <span className="text-xs text-zinc-500 tabular-nums">
                  {group.items.length} {group.items.length === 1 ? 'item' : 'items'} · {formatBytes(group.totalSize)}
                </span>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-0.5 md:gap-1.5">
                {group.items.map((photo) => (
                  <MediaTile
                    key={photo.id}
                    photo={photo}
                    selectable={selectMode}
                    selected={selectedIds.includes(photo.id)}
                    onTap={(item) => onOpenFullscreen(item, filteredPhotos)}
                    onToggleSelect={toggleSelectId}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
