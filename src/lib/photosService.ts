import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { PhotoItem } from '../types/photo';
import { db, handleFirestoreError, OperationType } from './firebase';
import { deleteFromR2 } from './r2';

const TRASH_PREFIX = '__trash__';
const TRASH_SEP = '::';

export function isTrashAlbum(album: string | null | undefined): boolean {
  return Boolean(album && (album === TRASH_PREFIX || album.startsWith(TRASH_PREFIX + TRASH_SEP)));
}

export function encodeTrashAlbum(previousAlbum: string | null): string {
  if (!previousAlbum || isTrashAlbum(previousAlbum)) {
    return TRASH_PREFIX;
  }
  return `${TRASH_PREFIX}${TRASH_SEP}${previousAlbum}`.slice(0, 120);
}

export function decodeTrashAlbum(trashAlbum: string | null): string | null {
  if (!trashAlbum || trashAlbum === TRASH_PREFIX) return null;
  if (trashAlbum.startsWith(TRASH_PREFIX + TRASH_SEP)) {
    const original = trashAlbum.slice((TRASH_PREFIX + TRASH_SEP).length);
    return original || null;
  }
  return trashAlbum;
}

function toIsoString(ts: unknown): string {
  if (ts instanceof Timestamp) {
    return ts.toDate().toISOString();
  }
  if (typeof ts === 'string' && ts) {
    return ts;
  }
  return new Date().toISOString();
}

export interface AlbumRecord {
  id: string;
  name: string;
}

export function subscribeToUserPhotos(
  userId: string,
  onData: (photos: PhotoItem[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/photos`;
  const q = query(collection(db, 'users', userId, 'photos'), where('user_id', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: PhotoItem[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          user_id: String(d.user_id ?? userId),
          file_name: String(d.file_name ?? 'Untitled'),
          file_type: String(d.file_type ?? 'application/octet-stream'),
          file_url: String(d.file_url ?? ''),
          file_size: typeof d.file_size === 'number' ? d.file_size : 0,
          created_at: toIsoString(d.createdAt),
          is_favorite: Boolean(d.is_favorite),
          album: typeof d.album === 'string' ? d.album : null,
        };
      });

      // Sort newest first in client so no composite index is required
      items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeToUserAlbums(
  userId: string,
  onData: (albums: AlbumRecord[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const path = `users/${userId}/albums`;
  const q = query(collection(db, 'users', userId, 'albums'), where('user_id', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: AlbumRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          name: String(d.name ?? ''),
        };
      });
      onData(items.filter((a) => Boolean(a.name)));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function insertPhotoRecord(params: {
  userId: string;
  fileName: string;
  fileType: string;
  fileUrl: string;
  fileSize: number;
  album?: string | null;
}): Promise<PhotoItem> {
  const photosCol = collection(db, 'users', params.userId, 'photos');
  const newRef = doc(photosCol);
  const path = `users/${params.userId}/photos/${newRef.id}`;

  const sanitizedName = (params.fileName.trim() || 'media').slice(0, 255);
  const sanitizedType = (params.fileType.trim() || 'application/octet-stream').slice(0, 128);
  const sanitizedUrl = params.fileUrl.trim().slice(0, 2048);
  const sanitizedAlbum = params.album ? params.album.trim().slice(0, 120) : null;
  const safeSize = Math.max(0, Math.min(10737418240, Math.round(params.fileSize)));

  try {
    await setDoc(newRef, {
      user_id: params.userId,
      file_name: sanitizedName,
      file_type: sanitizedType,
      file_url: sanitizedUrl,
      file_size: safeSize,
      is_favorite: false,
      album: sanitizedAlbum,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  return {
    id: newRef.id,
    user_id: params.userId,
    file_name: sanitizedName,
    file_type: sanitizedType,
    file_url: sanitizedUrl,
    file_size: safeSize,
    created_at: new Date().toISOString(),
    is_favorite: false,
    album: sanitizedAlbum,
  };
}

export async function createAlbumRecord(userId: string, name: string): Promise<void> {
  const trimmed = name.trim().slice(0, 100);
  if (!trimmed) return;
  const albumsCol = collection(db, 'users', userId, 'albums');
  const newRef = doc(albumsCol);
  const path = `users/${userId}/albums/${newRef.id}`;

  try {
    await setDoc(newRef, {
      user_id: userId,
      name: trimmed,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function toggleFavoritePhoto(
  id: string,
  userId: string,
  isFavorite: boolean
): Promise<void> {
  const path = `users/${userId}/photos/${id}`;
  try {
    await updateDoc(doc(db, 'users', userId, 'photos', id), {
      is_favorite: Boolean(isFavorite),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function setPhotoAlbum(
  id: string,
  userId: string,
  album: string | null
): Promise<void> {
  const path = `users/${userId}/photos/${id}`;
  const sanitizedAlbum = album ? album.trim().slice(0, 120) : null;
  try {
    await updateDoc(doc(db, 'users', userId, 'photos', id), {
      album: sanitizedAlbum,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function bulkSetPhotoAlbum(
  ids: string[],
  userId: string,
  album: string | null
): Promise<void> {
  if (ids.length === 0) return;
  const sanitizedAlbum = album ? album.trim().slice(0, 120) : null;
  const path = `users/${userId}/photos`;

  try {
    const batch = writeBatch(db);
    for (const id of ids) {
      batch.update(doc(db, 'users', userId, 'photos', id), {
        album: sanitizedAlbum,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function movePhotoToTrash(photo: PhotoItem, userId: string): Promise<string> {
  const nextAlbum = encodeTrashAlbum(photo.album);
  const path = `users/${userId}/photos/${photo.id}`;
  try {
    await updateDoc(doc(db, 'users', userId, 'photos', photo.id), {
      album: nextAlbum,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
  return nextAlbum;
}

export async function restorePhotoFromTrash(
  photo: PhotoItem,
  userId: string
): Promise<string | null> {
  const restoredAlbum = decodeTrashAlbum(photo.album);
  const path = `users/${userId}/photos/${photo.id}`;
  try {
    await updateDoc(doc(db, 'users', userId, 'photos', photo.id), {
      album: restoredAlbum,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
  return restoredAlbum;
}

export async function permanentlyDeletePhoto(
  photo: PhotoItem,
  userId: string,
  idToken: string
): Promise<void> {
  // Delete binary object from Cloudflare R2 first, then delete metadata document from Firestore
  await deleteFromR2(photo.file_url, idToken);

  const path = `users/${userId}/photos/${photo.id}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'photos', photo.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
