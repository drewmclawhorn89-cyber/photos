import React, { useMemo, useState } from 'react';
import { ArrowLeft, Check, FolderHeart, ImagePlus, Plus, X } from 'lucide-react';
import type { PhotoItem } from '../types/photo';
import { formatBytes } from '../lib/mediaCompression';
import { PhotoGrid } from './PhotoGrid';

interface AlbumsViewProps {
  photos: PhotoItem[];
  customEmptyAlbums: string[];
  loading: boolean;
  onCreateAlbum: (name: string) => void;
  onAddPhotosToAlbum: (ids: string[], albumName: string) => Promise<void>;
  onOpenFullscreen: (photo: PhotoItem, orderedList: PhotoItem[]) => void;
  onBatchAddToAlbum: (ids: string[]) => void;
  onBatchMoveToTrash: (photos: PhotoItem[]) => void;
}

export const AlbumsView: React.FC<AlbumsViewProps> = ({
  photos,
  customEmptyAlbums,
  loading,
  onCreateAlbum,
  onAddPhotosToAlbum,
  onOpenFullscreen,
  onBatchAddToAlbum,
  onBatchMoveToTrash,
}) => {
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newAlbumInput, setNewAlbumInput] = useState('');
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [savingPicker, setSavingPicker] = useState(false);

  const albumSummaries = useMemo(() => {
    const map = new Map<string, { name: string; items: PhotoItem[]; totalSize: number }>();

    for (const emptyName of customEmptyAlbums) {
      if (!map.has(emptyName)) {
        map.set(emptyName, { name: emptyName, items: [], totalSize: 0 });
      }
    }

    for (const p of photos) {
      if (!p.album) continue;
      let entry = map.get(p.album);
      if (!entry) {
        entry = { name: p.album, items: [], totalSize: 0 };
        map.set(p.album, entry);
      }
      entry.items.push(p);
      entry.totalSize += p.file_size || 0;
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [photos, customEmptyAlbums]);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newAlbumInput.trim();
    if (!trimmed) return;
    onCreateAlbum(trimmed);
    setNewAlbumInput('');
    setShowCreateModal(false);
    setSelectedAlbum(trimmed);
    setShowAddPicker(true);
    setPickedIds([]);
  };

  const togglePickPhoto = (id: string) => {
    setPickedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSavePickedPhotos = async () => {
    if (!selectedAlbum || pickedIds.length === 0) return;
    setSavingPicker(true);
    try {
      await onAddPhotosToAlbum(pickedIds, selectedAlbum);
      setPickedIds([]);
      setShowAddPicker(false);
    } finally {
      setSavingPicker(false);
    }
  };

  // Single Album Detail View
  if (selectedAlbum) {
    const albumPhotos = photos.filter((p) => p.album === selectedAlbum);
    const availableToAdd = photos.filter((p) => p.album !== selectedAlbum);

    return (
      <div className="max-w-7xl mx-auto pb-24 md:pb-12">
        <div className="px-3 md:px-6 pt-4 pb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setSelectedAlbum(null)}
              aria-label="Back to albums"
              className="w-10 h-10 rounded-full flex items-center justify-center text-white hover:bg-white/10 shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-bold text-white truncate">{selectedAlbum}</h1>
              <p className="text-xs text-zinc-400 tabular-nums">
                {albumPhotos.length} {albumPhotos.length === 1 ? 'item' : 'items'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setPickedIds([]);
              setShowAddPicker(true);
            }}
            className="h-10 px-3.5 rounded-xl bg-white text-black text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 hover:bg-zinc-200"
          >
            <ImagePlus className="w-4 h-4" />
            <span>Add photos</span>
          </button>
        </div>

        <PhotoGrid
          photos={albumPhotos}
          loading={loading}
          showSearch={false}
          showUploadCta={false}
          emptyTitle="This album is empty"
          emptySubtitle="Tap Add photos to organize items from your library into this album."
          onOpenFullscreen={onOpenFullscreen}
          onBatchAddToAlbum={onBatchAddToAlbum}
          onBatchMoveToTrash={onBatchMoveToTrash}
        />

        {/* Add photos from library modal */}
        {showAddPicker && (
          <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
            <div className="h-14 px-4 border-b border-white/10 flex items-center justify-between gap-3 pt-safe">
              <button
                type="button"
                onClick={() => setShowAddPicker(false)}
                className="w-10 h-10 flex items-center justify-center text-zinc-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
              <span className="text-sm font-semibold text-white truncate">
                Add to {selectedAlbum}
              </span>
              <button
                type="button"
                disabled={pickedIds.length === 0 || savingPicker}
                onClick={handleSavePickedPhotos}
                className="h-9 px-4 rounded-xl bg-[#FE2C55] text-white text-xs font-semibold disabled:opacity-40"
              >
                {savingPicker ? 'Saving...' : `Add (${pickedIds.length})`}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-1 md:p-4">
              {availableToAdd.length === 0 ? (
                <div className="py-20 text-center text-sm text-zinc-400">
                  All of your library photos are already in this album (or upload photos first).
                </div>
              ) : (
                <div className="max-w-6xl mx-auto grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1">
                  {availableToAdd.map((item) => {
                    const isPicked = pickedIds.includes(item.id);
                    const isVideo = item.file_type.startsWith('video/');
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => togglePickPhoto(item.id)}
                        className={`relative aspect-square overflow-hidden bg-zinc-900 ${
                          isPicked ? 'ring-2 ring-[#FE2C55]' : ''
                        }`}
                      >
                        {isVideo ? (
                          <video
                            src={`${item.file_url}#t=0.1`}
                            preload="metadata"
                            muted
                            playsInline
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <img
                            src={item.file_url}
                            alt={item.file_name}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        )}
                        <span
                          className={`absolute top-2 left-2 w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                            isPicked
                              ? 'bg-[#FE2C55] border-[#FE2C55] text-white'
                              : 'bg-black/40 border-white/80 text-transparent'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 pt-4 pb-24 md:pb-12 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Albums</h1>
          <p className="text-xs text-zinc-400 tabular-nums">
            {albumSummaries.length} {albumSummaries.length === 1 ? 'album' : 'albums'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="h-10 px-4 rounded-xl bg-white text-black text-xs font-semibold flex items-center gap-1.5 hover:bg-zinc-200 transition-colors whitespace-nowrap"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>New album</span>
        </button>
      </div>

      {albumSummaries.length === 0 ? (
        <div className="py-20 text-center max-w-sm mx-auto space-y-4">
          <FolderHeart className="w-10 h-10 text-zinc-600 mx-auto" />
          <div className="space-y-1">
            <p className="text-base font-semibold text-white">No albums yet</p>
            <p className="text-sm text-zinc-400">
              Group trips, events, or favorite clips into albums synced across all your devices.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="h-11 px-5 rounded-xl bg-white text-black text-sm font-semibold hover:bg-zinc-200 transition-colors"
          >
            Create first album
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
          {albumSummaries.map((album) => {
            const cover = album.items[0];
            const isVideoCover = cover?.file_type.startsWith('video/');
            return (
              <button
                key={album.name}
                type="button"
                onClick={() => setSelectedAlbum(album.name)}
                className="group text-left space-y-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-2xl"
              >
                <div className="aspect-square w-full rounded-2xl overflow-hidden bg-zinc-900 border border-white/10">
                  {cover ? (
                    isVideoCover ? (
                      <video
                        src={`${cover.file_url}#t=0.1`}
                        preload="metadata"
                        muted
                        playsInline
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                      />
                    ) : (
                      <img
                        src={cover.file_url}
                        alt={album.name}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                      />
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-600">
                      <FolderHeart className="w-8 h-8" />
                    </div>
                  )}
                </div>

                <div className="px-0.5">
                  <p className="text-sm font-semibold text-white truncate">{album.name}</p>
                  <p className="text-xs text-zinc-400 tabular-nums">
                    {album.items.length} {album.items.length === 1 ? 'item' : 'items'} · {formatBytes(album.totalSize)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Create Album Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/75 backdrop-blur-xs">
          <div className="fixed inset-0" onClick={() => setShowCreateModal(false)} />
          <form
            onSubmit={handleCreateSubmit}
            className="relative z-10 w-full md:max-w-sm rounded-t-3xl md:rounded-2xl bg-zinc-950 border-t md:border border-white/15 p-5 pb-safe space-y-4"
          >
            <div className="w-10 h-1 rounded-full bg-zinc-700 mx-auto md:hidden" />
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Create album</h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              autoFocus
              required
              value={newAlbumInput}
              onChange={(e) => setNewAlbumInput(e.target.value)}
              placeholder="e.g. Summer Trip, Family, Gym"
              className="w-full h-12 px-4 rounded-xl bg-zinc-900 border border-white/10 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/30"
            />
            <button
              type="submit"
              disabled={!newAlbumInput.trim()}
              className="w-full h-12 rounded-xl bg-white text-black text-sm font-semibold disabled:opacity-40"
            >
              Create &amp; add photos
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
