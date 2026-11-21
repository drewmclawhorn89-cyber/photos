import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { Loader2 } from 'lucide-react';
import { auth } from './lib/firebase';
import { compressVideoIfNeeded, inferMediaMimeType } from './lib/mediaCompression';
import {
  bulkSetPhotoAlbum,
  createAlbumRecord,
  insertPhotoRecord,
  isTrashAlbum,
  movePhotoToTrash,
  permanentlyDeletePhoto,
  restorePhotoFromTrash,
  setPhotoAlbum,
  subscribeToUserAlbums,
  subscribeToUserPhotos,
  toggleFavoritePhoto,
  type AlbumRecord,
} from './lib/photosService';
import { fetchR2Status, uploadToR2, type R2Status } from './lib/r2';
import type { AppTab, PhotoItem, UploadTask } from './types/photo';
import { AuthScreen } from './components/AuthScreen';
import { TopBar } from './components/TopBar';
import { BottomNav } from './components/BottomNav';
import { PhotoGrid } from './components/PhotoGrid';
import { AlbumsView } from './components/AlbumsView';
import { TrashView } from './components/TrashView';
import { FullscreenViewer } from './components/FullscreenViewer';
import { UploadQueueDrawer } from './components/UploadQueueDrawer';
import { AlbumPickerSheet } from './components/AlbumPickerSheet';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [cloudAlbums, setCloudAlbums] = useState<AlbumRecord[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);
  const [r2Status, setR2Status] = useState<R2Status | null>(null);

  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [viewerState, setViewerState] = useState<{
    ids: string[];
    initialId: string;
    isTrashMode: boolean;
  } | null>(null);

  const [albumPickerTarget, setAlbumPickerTarget] = useState<{
    ids: string[];
    currentAlbum?: string | null;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Firebase Auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Check Cloudflare R2 backend configuration status
  useEffect(() => {
    fetchR2Status().then(setR2Status).catch(() => {});
  }, []);

  const userId = user?.uid ?? null;
  const userEmail = user?.email ?? '';

  // Real-time Firestore subscriptions for authenticated user's photos & albums
  useEffect(() => {
    if (!authReady || !userId) {
      setPhotos([]);
      setCloudAlbums([]);
      setPhotosLoading(false);
      return;
    }

    setPhotosLoading(true);
    setLoadError(null);

    const unsubPhotos = subscribeToUserPhotos(
      userId,
      (items) => {
        setPhotos(items);
        setPhotosLoading(false);
      },
      (err) => {
        setPhotosLoading(false);
        setLoadError(err.message);
      }
    );

    const unsubAlbums = subscribeToUserAlbums(
      userId,
      (albums) => {
        setCloudAlbums(albums);
      },
      (err) => {
        setLoadError(err.message);
      }
    );

    return () => {
      unsubPhotos();
      unsubAlbums();
    };
  }, [authReady, userId]);

  const activePhotos = useMemo(
    () => photos.filter((p) => !isTrashAlbum(p.album)),
    [photos]
  );

  const favoritePhotos = useMemo(
    () => activePhotos.filter((p) => p.is_favorite),
    [activePhotos]
  );

  const trashPhotos = useMemo(
    () => photos.filter((p) => isTrashAlbum(p.album)),
    [photos]
  );

  const totalUsedBytes = useMemo(
    () => photos.reduce((sum, p) => sum + (p.file_size || 0), 0),
    [photos]
  );

  const existingAlbums = useMemo(() => {
    const set = new Set<string>(cloudAlbums.map((a) => a.name));
    for (const p of activePhotos) {
      if (p.album) set.add(p.album);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [activePhotos, cloudAlbums]);

  const showError = (msg: string) => {
    setToastError(msg);
    window.setTimeout(() => {
      setToastError((curr) => (curr === msg ? null : curr));
    }, 6000);
  };

  // Multi-file upload workflow: Compress videos -> Upload to R2 via /api/r2/upload -> Save metadata to Firestore
  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !user || !userId) return;

    const filesWithMime = Array.from(fileList)
      .map((file) => ({ file, mime: inferMediaMimeType(file) }))
      .filter(({ mime }) => mime.startsWith('image/') || mime.startsWith('video/'));

    if (filesWithMime.length === 0) {
      showError('Please choose photo or video files.');
      return;
    }

    const newTasks: UploadTask[] = filesWithMime.map(({ file, mime }) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fileName: file.name,
      fileType: mime,
      originalSize: file.size,
      finalSize: file.size,
      stage: 'queued',
      progress: 0,
    }));

    setUploadTasks((prev) => [...newTasks, ...prev]);

    const updateTask = (taskId: string, patch: Partial<UploadTask>) => {
      setUploadTasks((prev) =>
        prev.map((task) => (task.id === taskId ? { ...task, ...patch } : task))
      );
    };

    let idToken = '';
    try {
      idToken = await user.getIdToken();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Authentication expired. Please sign in again.';
      for (const task of newTasks) {
        updateTask(task.id, { stage: 'error', errorMessage: msg });
      }
      showError(msg);
      return;
    }

    for (let i = 0; i < filesWithMime.length; i++) {
      const { file, mime } = filesWithMime[i];
      const task = newTasks[i];

      try {
        let readyFile = file;
        let readyMime = mime;
        if (mime.startsWith('video/')) {
          updateTask(task.id, { stage: 'compressing', progress: 0 });
          readyFile = await compressVideoIfNeeded(file, (pct) => {
            updateTask(task.id, { stage: 'compressing', progress: pct });
          });
          readyMime = inferMediaMimeType(readyFile) || mime;
        }

        updateTask(task.id, {
          stage: 'uploading',
          progress: 0,
          finalSize: readyFile.size,
        });

        const { publicUrl } = await uploadToR2(
          readyFile,
          userId,
          idToken,
          (pct) => {
            updateTask(task.id, { stage: 'uploading', progress: pct });
          },
          readyMime
        );

        updateTask(task.id, { stage: 'saving', progress: 100 });

        await insertPhotoRecord({
          userId,
          fileName: file.name,
          fileType: readyMime,
          fileUrl: publicUrl,
          fileSize: readyFile.size,
        });

        updateTask(task.id, { stage: 'done', progress: 100, finalSize: readyFile.size });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        updateTask(task.id, {
          stage: 'error',
          errorMessage: msg,
        });
        showError(msg);
      }
    }
  };

  const triggerUploadPicker = () => {
    fileInputRef.current?.click();
  };

  // Actions
  const handleToggleFavorite = async (photo: PhotoItem) => {
    if (!userId) return;
    const nextFav = !photo.is_favorite;
    setPhotos((prev) =>
      prev.map((p) => (p.id === photo.id ? { ...p, is_favorite: nextFav } : p))
    );
    try {
      await toggleFavoritePhoto(photo.id, userId, nextFav);
    } catch (err) {
      setPhotos((prev) =>
        prev.map((p) => (p.id === photo.id ? { ...p, is_favorite: !nextFav } : p))
      );
      showError(err instanceof Error ? err.message : 'Could not update favorite.');
    }
  };

  const handleAssignAlbum = async (ids: string[], albumName: string | null) => {
    if (!userId || ids.length === 0) return;
    try {
      if (albumName && !existingAlbums.includes(albumName)) {
        await createAlbumRecord(userId, albumName);
      }
      if (ids.length === 1) {
        await setPhotoAlbum(ids[0], userId, albumName);
      } else {
        await bulkSetPhotoAlbum(ids, userId, albumName);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not update album.');
    }
  };

  const handleMoveToTrash = async (photo: PhotoItem) => {
    if (!userId) return;
    try {
      await movePhotoToTrash(photo, userId);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not move item to Trash.');
    }
  };

  const handleBatchMoveToTrash = async (targets: PhotoItem[]) => {
    if (!userId || targets.length === 0) return;
    try {
      await Promise.all(targets.map((item) => movePhotoToTrash(item, userId)));
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not move selected items to Trash.');
    }
  };

  const handleRestoreFromTrash = async (photo: PhotoItem) => {
    if (!userId) return;
    try {
      await restorePhotoFromTrash(photo, userId);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not restore item.');
    }
  };

  const handlePermanentDelete = async (photo: PhotoItem) => {
    if (!user || !userId) return;
    try {
      const idToken = await user.getIdToken();
      await permanentlyDeletePhoto(photo, userId, idToken);
    } catch (err) {
      showError(
        err instanceof Error ? err.message : 'Failed to permanently delete from Cloudflare R2.'
      );
    }
  };

  const handleEmptyTrash = async () => {
    if (!user || !userId || trashPhotos.length === 0) return;
    const idToken = await user.getIdToken();
    for (const item of trashPhotos) {
      try {
        await permanentlyDeletePhoto(item, userId, idToken);
      } catch (err) {
        showError(
          err instanceof Error ? err.message : `Failed deleting ${item.file_name} from R2.`
        );
        break;
      }
    }
  };

  const handleCreateAlbum = (name: string) => {
    if (!userId) return;
    const trimmed = name.trim();
    if (!trimmed || existingAlbums.includes(trimmed)) return;
    createAlbumRecord(userId, trimmed).catch((err) => {
      showError(err instanceof Error ? err.message : 'Could not create album.');
    });
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setPhotos([]);
    setCloudAlbums([]);
    setViewerState(null);
    setActiveTab('home');
  };

  const openFullscreen = (photo: PhotoItem, orderedList: PhotoItem[], isTrashMode = false) => {
    setViewerState({
      ids: orderedList.map((i) => i.id),
      initialId: photo.id,
      isTrashMode,
    });
  };

  const viewerItems = useMemo(() => {
    if (!viewerState) return [];
    const byId = new Map(photos.map((p) => [p.id, p]));
    return viewerState.ids
      .map((id) => byId.get(id))
      .filter((item): item is PhotoItem => {
        if (!item) return false;
        return viewerState.isTrashMode ? isTrashAlbum(item.album) : !isTrashAlbum(item.album);
      });
  }, [viewerState, photos]);

  if (!authReady) {
    return (
      <div className="min-h-dvh bg-black text-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <div className="min-h-dvh bg-black text-white flex flex-col">
      {/* Hidden multi-file picker for photos and videos */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFilesSelected(e.target.files);
          e.target.value = '';
        }}
      />

      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        totalUsedBytes={totalUsedBytes}
        userEmail={userEmail}
        onTriggerUpload={triggerUploadPicker}
        onSignOut={handleSignOut}
      />

      {r2Status && !r2Status.configured && (
        <div className="max-w-7xl mx-auto w-full px-3 md:px-6 pt-3">
          <div className="rounded-2xl bg-zinc-950 border border-amber-500/30 p-3.5 space-y-1">
            <p className="text-xs font-semibold text-amber-400">
              Cloudflare R2 storage not configured yet
            </p>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Add{' '}
              <span className="font-mono text-white">
                {r2Status.missing.join(', ')}
              </span>{' '}
              to your AI Studio Secrets or <code className="font-mono text-white">.env</code> file to enable uploads.
            </p>
          </div>
        </div>
      )}

      {loadError && (
        <div className="max-w-7xl mx-auto w-full px-4 pt-4">
          <div className="rounded-2xl bg-[#FE2C55]/10 border border-[#FE2C55]/30 p-4">
            <p className="text-xs text-[#FF6B86] break-words">
              Could not sync cloud library. Please refresh or sign in again.
            </p>
          </div>
        </div>
      )}

      {toastError && (
        <div className="fixed top-16 inset-x-4 md:left-auto md:right-6 md:w-96 z-50 rounded-xl bg-zinc-950 border border-[#FE2C55]/40 px-4 py-3 text-xs text-[#FF6B86] shadow-2xl">
          {toastError}
        </div>
      )}

      <main className="flex-1">
        {activeTab === 'home' && (
          <PhotoGrid
            photos={activePhotos}
            loading={photosLoading}
            emptyTitle="Your library is empty"
            emptySubtitle="Upload photos and videos directly to your Cloudflare R2 bucket. Everything stays synced across all your devices."
            onTriggerUpload={triggerUploadPicker}
            onOpenFullscreen={(photo, list) => openFullscreen(photo, list, false)}
            onBatchAddToAlbum={(ids) => setAlbumPickerTarget({ ids })}
            onBatchMoveToTrash={handleBatchMoveToTrash}
          />
        )}

        {activeTab === 'albums' && (
          <AlbumsView
            photos={activePhotos}
            customEmptyAlbums={existingAlbums}
            loading={photosLoading}
            onCreateAlbum={handleCreateAlbum}
            onAddPhotosToAlbum={async (ids, albumName) => {
              await handleAssignAlbum(ids, albumName);
            }}
            onOpenFullscreen={(photo, list) => openFullscreen(photo, list, false)}
            onBatchAddToAlbum={(ids) => setAlbumPickerTarget({ ids })}
            onBatchMoveToTrash={handleBatchMoveToTrash}
          />
        )}

        {activeTab === 'favorites' && (
          <PhotoGrid
            photos={favoritePhotos}
            loading={photosLoading}
            title="Favorites"
            showSearch={false}
            showUploadCta={false}
            emptyTitle="No favorites yet"
            emptySubtitle="Tap the heart icon on any photo or video to keep your best memories here."
            onOpenFullscreen={(photo, list) => openFullscreen(photo, list, false)}
            onBatchAddToAlbum={(ids) => setAlbumPickerTarget({ ids })}
            onBatchMoveToTrash={handleBatchMoveToTrash}
          />
        )}

        {activeTab === 'trash' && (
          <TrashView
            trashPhotos={trashPhotos}
            onOpenFullscreen={(photo, list) => openFullscreen(photo, list, true)}
            onRestore={handleRestoreFromTrash}
            onPermanentDelete={handlePermanentDelete}
            onEmptyTrash={handleEmptyTrash}
          />
        )}
      </main>

      <BottomNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onTriggerUpload={triggerUploadPicker}
      />

      <UploadQueueDrawer
        tasks={uploadTasks}
        onDismissCompleted={() =>
          setUploadTasks((prev) =>
            prev.filter((t) => t.stage !== 'done' && t.stage !== 'error')
          )
        }
      />

      {viewerState && viewerItems.length > 0 && (
        <FullscreenViewer
          items={viewerItems}
          initialId={viewerState.initialId}
          isTrashMode={viewerState.isTrashMode}
          onClose={() => setViewerState(null)}
          onToggleFavorite={handleToggleFavorite}
          onOpenAlbumPicker={(photo) =>
            setAlbumPickerTarget({
              ids: [photo.id],
              currentAlbum: photo.album,
            })
          }
          onMoveToTrash={handleMoveToTrash}
          onRestore={handleRestoreFromTrash}
          onPermanentDelete={handlePermanentDelete}
        />
      )}

      <AlbumPickerSheet
        open={Boolean(albumPickerTarget)}
        targetCount={albumPickerTarget?.ids.length ?? 0}
        currentAlbum={albumPickerTarget?.currentAlbum}
        existingAlbums={existingAlbums}
        onClose={() => setAlbumPickerTarget(null)}
        onSelectAlbum={async (albumName) => {
          if (!albumPickerTarget) return;
          await handleAssignAlbum(albumPickerTarget.ids, albumName);
        }}
      />
    </div>
  );
}
