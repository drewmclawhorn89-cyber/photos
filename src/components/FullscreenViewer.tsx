import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FolderPlus,
  Heart,
  Info,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { PhotoItem } from '../types/photo';
import { formatBytes } from '../lib/mediaCompression';

interface FullscreenViewerProps {
  items: PhotoItem[];
  initialId: string;
  isTrashMode?: boolean;
  onClose: () => void;
  onToggleFavorite: (photo: PhotoItem) => void;
  onOpenAlbumPicker: (photo: PhotoItem) => void;
  onMoveToTrash: (photo: PhotoItem) => Promise<void>;
  onRestore?: (photo: PhotoItem) => Promise<void>;
  onPermanentDelete?: (photo: PhotoItem) => Promise<void>;
}

export const FullscreenViewer: React.FC<FullscreenViewerProps> = ({
  items,
  initialId,
  isTrashMode = false,
  onClose,
  onToggleFavorite,
  onOpenAlbumPicker,
  onMoveToTrash,
  onRestore,
  onPermanentDelete,
}) => {
  const [currentIndex, setCurrentIndex] = useState(() => {
    const idx = items.findIndex((i) => i.id === initialId);
    return idx >= 0 ? idx : 0;
  });

  const [isMuted, setIsMuted] = useState(false); // Sound ON by default like TikTok
  const [isPaused, setIsPaused] = useState(false);
  const [showSoundHint, setShowSoundHint] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [confirmPermanent, setConfirmPermanent] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  // Keep index clamped if items shrink after delete/restore
  useEffect(() => {
    if (items.length === 0) {
      onClose();
      return;
    }
    if (currentIndex >= items.length) {
      setCurrentIndex(items.length - 1);
    }
  }, [items, currentIndex, onClose]);

  const photo = items[currentIndex];
  const isVideo = Boolean(photo?.file_type.startsWith('video/'));

  const goPrev = () => {
    if (currentIndex > 0) {
      setConfirmPermanent(false);
      setCurrentIndex((i) => i - 1);
    }
  };

  const goNext = () => {
    if (currentIndex < items.length - 1) {
      setConfirmPermanent(false);
      setCurrentIndex((i) => i + 1);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  // Auto-play videos with sound ON by default whenever slide changes
  useEffect(() => {
    setIsPaused(false);
    setVideoProgress(0);
    setVideoDuration(0);
    setShowSoundHint(false);

    const videoEl = videoRef.current;
    if (!videoEl || !isVideo) return;

    videoEl.muted = isMuted;
    videoEl.currentTime = 0;

    const attemptPlay = async () => {
      try {
        await videoEl.play();
      } catch {
        // Fallback if browser blocks unmuted autoplay on non-gesture navigation
        videoEl.muted = true;
        setIsMuted(true);
        setShowSoundHint(true);
        videoEl.play().catch(() => {
          setIsPaused(true);
        });
      }
    };

    attemptPlay();
  }, [photo?.id, isVideo]);

  if (!photo) return null;

  const togglePlayPause = () => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    if (videoEl.paused) {
      videoEl.play().then(() => setIsPaused(false)).catch(() => {});
    } else {
      videoEl.pause();
      setIsPaused(true);
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    setShowSoundHint(false);
    if (videoRef.current) {
      videoRef.current.muted = nextMuted;
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(e.target.value);
    setVideoProgress(nextTime);
    if (videoRef.current) {
      videoRef.current.currentTime = nextTime;
    }
  };

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(photo.file_url);
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = photo.file_name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      // Fallback direct anchor download if CORS fetch for blob is restricted
      const anchor = document.createElement('a');
      anchor.href = photo.file_url;
      anchor.download = photo.file_name;
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      setDownloading(false);
    }
  };

  const handleTrash = async () => {
    setBusyAction(true);
    try {
      await onMoveToTrash(photo);
    } finally {
      setBusyAction(false);
    }
  };

  const handleRestore = async () => {
    if (!onRestore) return;
    setBusyAction(true);
    try {
      await onRestore(photo);
    } finally {
      setBusyAction(false);
    }
  };

  const handlePermanentDelete = async () => {
    if (!onPermanentDelete) return;
    setBusyAction(true);
    try {
      await onPermanentDelete(photo);
      setConfirmPermanent(false);
    } finally {
      setBusyAction(false);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;

    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      if (dx > 0) goPrev();
      else goNext();
    }
  };

  const formattedDate = new Date(photo.created_at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={photo.file_name}
      className="fixed inset-0 z-50 bg-black text-white flex flex-col select-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Top overlay */}
      <div className="absolute top-0 inset-x-0 z-20 pt-safe bg-gradient-to-b from-black/80 via-black/40 to-transparent">
        <div className="h-14 px-3 md:px-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close viewer"
            className="w-11 h-11 rounded-full flex items-center justify-center text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="min-w-0 flex-1 text-center">
            <p className="text-xs font-medium text-white truncate">{photo.file_name}</p>
            <p className="text-[11px] text-zinc-300 tabular-nums">
              {formattedDate} · {currentIndex + 1} / {items.length}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowInfo((prev) => !prev)}
            aria-label="Media details"
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
              showInfo ? 'bg-white text-black' : 'text-white hover:bg-white/10'
            }`}
          >
            <Info className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Media Stage */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-black">
        {isVideo ? (
          <div
            className="relative w-full h-full flex items-center justify-center cursor-pointer"
            onClick={togglePlayPause}
          >
            <video
              key={photo.id}
              ref={videoRef}
              src={photo.file_url}
              playsInline
              autoPlay
              loop
              muted={isMuted}
              onTimeUpdate={() => {
                if (videoRef.current) setVideoProgress(videoRef.current.currentTime);
              }}
              onLoadedMetadata={() => {
                if (videoRef.current) setVideoDuration(videoRef.current.duration || 0);
              }}
              className="max-w-full max-h-full w-full h-full object-contain"
            />

            {isPaused && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
                <div className="w-16 h-16 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
                  <Play className="w-8 h-8 fill-white text-white ml-1" />
                </div>
              </div>
            )}

            {/* Sound toggle & unmute hint */}
            <div className="absolute right-4 bottom-28 md:bottom-24 z-20 flex items-center gap-2">
              {showSoundHint && isMuted && (
                <button
                  type="button"
                  onClick={toggleMute}
                  className="h-9 px-3 rounded-full bg-black/75 border border-white/20 text-xs font-medium text-white backdrop-blur-sm"
                >
                  Tap for sound
                </button>
              )}
              <button
                type="button"
                onClick={toggleMute}
                aria-label={isMuted ? 'Unmute video' : 'Mute video'}
                className="w-11 h-11 rounded-full bg-black/60 border border-white/15 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/80 transition-colors"
              >
                {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
            </div>

            {/* Video scrubber */}
            {videoDuration > 0 && (
              <div
                className="absolute bottom-20 md:bottom-18 inset-x-4 md:inset-x-12 z-20 flex items-center gap-3"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={togglePlayPause}
                  aria-label={isPaused ? 'Play' : 'Pause'}
                  className="w-8 h-8 flex items-center justify-center text-white"
                >
                  {isPaused ? <Play className="w-4 h-4 fill-white" /> : <Pause className="w-4 h-4 fill-white" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={videoDuration}
                  step={0.1}
                  value={videoProgress}
                  onChange={handleSeek}
                  aria-label="Seek video"
                  className="flex-1 h-1 accent-[#FE2C55] cursor-pointer"
                />
              </div>
            )}
          </div>
        ) : (
          <img
            key={photo.id}
            src={photo.file_url}
            alt={photo.file_name}
            referrerPolicy="no-referrer"
            className="max-w-full max-h-full object-contain"
          />
        )}

        {/* Desktop prev/next buttons */}
        {currentIndex > 0 && (
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous item"
            className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/60 border border-white/15 items-center justify-center text-white hover:bg-white/20 transition-colors"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        {currentIndex < items.length - 1 && (
          <button
            type="button"
            onClick={goNext}
            aria-label="Next item"
            className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/60 border border-white/15 items-center justify-center text-white hover:bg-white/20 transition-colors"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}

        {/* File info drawer */}
        {showInfo && (
          <div className="absolute bottom-24 left-4 right-4 md:left-auto md:right-6 md:w-80 rounded-2xl bg-zinc-950/95 border border-white/15 backdrop-blur-md p-4 z-30 space-y-2 text-xs">
            <p className="font-semibold text-white truncate">{photo.file_name}</p>
            <div className="grid grid-cols-2 gap-y-1.5 text-zinc-400">
              <span>Type</span>
              <span className="text-zinc-200 text-right truncate">{photo.file_type}</span>
              <span>Size</span>
              <span className="text-zinc-200 text-right tabular-nums">{formatBytes(photo.file_size)}</span>
              <span>Uploaded</span>
              <span className="text-zinc-200 text-right">{formattedDate}</span>
              <span>Album</span>
              <span className="text-zinc-200 text-right truncate">
                {photo.album && !photo.album.startsWith('__trash__') ? photo.album : 'None'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Action Bar */}
      <div className="relative z-20 pb-safe bg-gradient-to-t from-black/95 via-black/75 to-transparent">
        {confirmPermanent ? (
          <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-300">Permanently delete from R2 &amp; cloud?</p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={busyAction}
                onClick={() => setConfirmPermanent(false)}
                className="h-10 px-3.5 rounded-xl bg-zinc-800 text-xs font-medium text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={handlePermanentDelete}
                className="h-10 px-3.5 rounded-xl bg-[#FE2C55] text-xs font-semibold text-white flex items-center gap-1.5"
              >
                {busyAction && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Delete</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="max-w-lg mx-auto px-4 py-2.5 flex items-center justify-around">
            {!isTrashMode ? (
              <>
                <button
                  type="button"
                  onClick={() => onToggleFavorite(photo)}
                  className="min-w-[56px] min-h-[48px] flex flex-col items-center justify-center gap-1 text-white hover:opacity-80 transition-opacity"
                >
                  <Heart
                    className={`w-5 h-5 ${photo.is_favorite ? 'text-[#FE2C55] fill-[#FE2C55]' : 'text-white'}`}
                  />
                  <span className="text-[11px] text-zinc-300">
                    {photo.is_favorite ? 'Favorited' : 'Favorite'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenAlbumPicker(photo)}
                  className="min-w-[56px] min-h-[48px] flex flex-col items-center justify-center gap-1 text-white hover:opacity-80 transition-opacity"
                >
                  <FolderPlus className="w-5 h-5" />
                  <span className="text-[11px] text-zinc-300">Album</span>
                </button>

                <button
                  type="button"
                  disabled={downloading}
                  onClick={handleDownload}
                  className="min-w-[56px] min-h-[48px] flex flex-col items-center justify-center gap-1 text-white hover:opacity-80 transition-opacity disabled:opacity-50"
                >
                  {downloading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Download className="w-5 h-5" />
                  )}
                  <span className="text-[11px] text-zinc-300">Download</span>
                </button>

                <button
                  type="button"
                  disabled={busyAction}
                  onClick={handleTrash}
                  className="min-w-[56px] min-h-[48px] flex flex-col items-center justify-center gap-1 text-white hover:text-[#FE2C55] transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-5 h-5" />
                  <span className="text-[11px] text-zinc-300">Delete</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={handleRestore}
                  className="min-w-[64px] min-h-[48px] flex flex-col items-center justify-center gap-1 text-white hover:opacity-80"
                >
                  <RotateCcw className="w-5 h-5" />
                  <span className="text-[11px] text-zinc-300">Restore</span>
                </button>

                <button
                  type="button"
                  disabled={downloading}
                  onClick={handleDownload}
                  className="min-w-[64px] min-h-[48px] flex flex-col items-center justify-center gap-1 text-white hover:opacity-80"
                >
                  <Download className="w-5 h-5" />
                  <span className="text-[11px] text-zinc-300">Download</span>
                </button>

                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => setConfirmPermanent(true)}
                  className="min-w-[64px] min-h-[48px] flex flex-col items-center justify-center gap-1 text-[#FE2C55] hover:opacity-80"
                >
                  <Trash2 className="w-5 h-5" />
                  <span className="text-[11px] text-[#FF6B86]">Delete forever</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
