import React, { useState } from 'react';
import { Check, Film, Heart, Play } from 'lucide-react';
import type { PhotoItem } from '../types/photo';

interface MediaTileProps {
  photo: PhotoItem;
  selectable?: boolean;
  selected?: boolean;
  onTap: (photo: PhotoItem) => void;
  onToggleSelect?: (id: string) => void;
}

export const MediaTile: React.FC<MediaTileProps> = ({
  photo,
  selectable = false,
  selected = false,
  onTap,
  onToggleSelect,
}) => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const isVideo = photo.file_type.startsWith('video/');

  const handleClick = () => {
    if (selectable && onToggleSelect) {
      onToggleSelect(photo.id);
    } else {
      onTap(photo);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`group relative aspect-square w-full overflow-hidden bg-zinc-900 md:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
        selected ? 'ring-2 ring-[#FE2C55] scale-[0.96]' : ''
      } transition-transform duration-150`}
    >
      {!failed ? (
        isVideo ? (
          <video
            src={`${photo.file_url}#t=0.1`}
            preload="metadata"
            muted
            playsInline
            onLoadedData={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`w-full h-full object-cover transition-opacity duration-200 ${
              loaded ? 'opacity-100' : 'opacity-80'
            }`}
          />
        ) : (
          <img
            src={photo.file_url}
            alt={photo.file_name}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`w-full h-full object-cover transition-all duration-200 group-hover:scale-[1.02] ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center p-2 bg-zinc-900 text-zinc-500 gap-1">
          <Film className="w-5 h-5" />
          <span className="text-[10px] truncate max-w-full">{photo.file_name}</span>
        </div>
      )}

      {/* Subtle gradient for corner icons */}
      {(isVideo || photo.is_favorite) && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-black/50 to-transparent" />
      )}

      {isVideo && (
        <span
          aria-label="Video"
          className="pointer-events-none absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 backdrop-blur-xs flex items-center justify-center text-white"
        >
          <Play className="w-3 h-3 fill-white ml-0.5" />
        </span>
      )}

      {photo.is_favorite && !selectable && (
        <span
          aria-label="Favorite"
          className="pointer-events-none absolute bottom-1.5 left-1.5 text-[#FE2C55] drop-shadow"
        >
          <Heart className="w-3.5 h-3.5 fill-[#FE2C55]" />
        </span>
      )}

      {selectable && (
        <span
          className={`absolute top-2 left-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
            selected
              ? 'bg-[#FE2C55] border-[#FE2C55] text-white'
              : 'bg-black/40 border-white/80 text-transparent'
          }`}
        >
          <Check className="w-3.5 h-3.5 stroke-[3]" />
        </span>
      )}
    </button>
  );
};
