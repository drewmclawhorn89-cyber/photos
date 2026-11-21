export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  const decimals = i >= 3 ? 2 : i >= 1 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[i]}`;
}

export function formatStorageGb(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return gb < 0.01 && bytes > 0 ? '<0.01' : gb.toFixed(2);
}

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  '3gp': 'video/3gpp',
  avi: 'video/x-msvideo',
};

export function inferMediaMimeType(file: File): string {
  if (file.type && (file.type.startsWith('image/') || file.type.startsWith('video/'))) {
    return file.type;
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_MIME[ext] ?? file.type ?? '';
}

function pickSupportedVideoMimeType(): { mimeType: string; ext: string } | null {
  if (typeof MediaRecorder === 'undefined') return null;

  const candidates = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
    { mimeType: 'video/mp4', ext: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mimeType: 'video/webm', ext: 'webm' },
  ];

  for (const item of candidates) {
    if (MediaRecorder.isTypeSupported(item.mimeType)) {
      return item;
    }
  }
  return null;
}

/**
 * Compresses large video files in-browser via canvas + MediaRecorder while preserving audio.
 * Safely falls back to the original file if compression isn't supported, times out, or wouldn't save space.
 */
export async function compressVideoIfNeeded(
  file: File,
  onProgress: (percent: number) => void
): Promise<File> {
  const mime = inferMediaMimeType(file);
  if (!mime.startsWith('video/')) {
    onProgress(100);
    return file;
  }

  // Skip compression for already small clips (< 4 MB)
  if (file.size < 4 * 1024 * 1024) {
    onProgress(100);
    return file;
  }

  const supported = pickSupportedVideoMimeType();
  if (!supported) {
    onProgress(100);
    return file;
  }

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = objectUrl;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';

  let audioCtx: AudioContext | null = null;
  let animId = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Video metadata timeout')), 8000);
      video.onloadedmetadata = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Could not decode video'));
      };
    });

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 180) {
      onProgress(100);
      return file;
    }

    const srcWidth = video.videoWidth || 1280;
    const srcHeight = video.videoHeight || 720;
    const maxDim = 960;
    const scale = Math.min(1, maxDim / Math.max(srcWidth, srcHeight));

    const targetWidth = Math.max(2, Math.floor((srcWidth * scale) / 2) * 2);
    const targetHeight = Math.max(2, Math.floor((srcHeight * scale) / 2) * 2);

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.captureStream !== 'function') {
      onProgress(100);
      return file;
    }

    const canvasStream = canvas.captureStream(30);
    const combinedStream = new MediaStream();
    canvasStream.getVideoTracks().forEach((track) => combinedStream.addTrack(track));

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        audioCtx = new AudioCtx();
        const source = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        dest.stream.getAudioTracks().forEach((track) => combinedStream.addTrack(track));
      }
    } catch {
      // Continue video-only if audio graph fails
    }

    const targetVideoBitrate = Math.min(
      2_200_000,
      Math.max(850_000, Math.round((file.size * 8 * 0.55) / duration))
    );
    const recorder = new MediaRecorder(combinedStream, {
      mimeType: supported.mimeType,
      videoBitsPerSecond: targetVideoBitrate,
      audioBitsPerSecond: 128_000,
    });

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };

    const stoppedPromise = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        resolve(new Blob(chunks, { type: supported.mimeType.split(';')[0] }));
      };
      recorder.onerror = () => reject(new Error('MediaRecorder failed'));
    });

    recorder.start(250);
    video.currentTime = 0;

    const drawFrame = () => {
      if (!video.paused && !video.ended) {
        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
        if (duration > 0) {
          onProgress(Math.min(99, Math.round((video.currentTime / duration) * 100)));
        }
        animId = requestAnimationFrame(drawFrame);
      }
    };

    await video.play();
    drawFrame();

    await new Promise<void>((resolve, reject) => {
      const safetyMs = Math.min(90000, Math.max(15000, duration * 1600));
      const timer = window.setTimeout(() => reject(new Error('Compression timeout')), safetyMs);
      video.onended = () => {
        window.clearTimeout(timer);
        resolve();
      };
    });

    cancelAnimationFrame(animId);
    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
    recorder.stop();

    const compressedBlob = await stoppedPromise;
    onProgress(100);

    if (compressedBlob.size > 0 && compressedBlob.size < file.size * 0.92) {
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const cleanMime = supported.mimeType.split(';')[0];
      return new File([compressedBlob], `${baseName}.${supported.ext}`, {
        type: cleanMime,
        lastModified: Date.now(),
      });
    }

    return file;
  } catch {
    onProgress(100);
    return file;
  } finally {
    cancelAnimationFrame(animId);
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
    if (audioCtx) {
      audioCtx.close().catch(() => {});
    }
  }
}
