export interface PhotoItem {
  id: string;
  user_id: string;
  file_name: string;
  file_type: string;
  file_url: string;
  file_size: number;
  created_at: string;
  is_favorite: boolean;
  album: string | null;
}

export type AppTab = 'home' | 'albums' | 'favorites' | 'trash';

export type UploadStage = 'queued' | 'compressing' | 'uploading' | 'saving' | 'done' | 'error';

export interface UploadTask {
  id: string;
  fileName: string;
  fileType: string;
  originalSize: number;
  finalSize: number;
  stage: UploadStage;
  progress: number;
  errorMessage?: string;
}

export const FREE_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
