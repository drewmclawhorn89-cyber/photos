export interface R2Status {
  configured: boolean;
  missing: string[];
}

/**
 * Asks the server whether Cloudflare R2 is configured.
 *
 * All signing happens server-side in server.ts. The browser never sees the
 * R2 access key or secret, so no credential is ever inlined into the bundle.
 */
export async function fetchR2Status(): Promise<R2Status> {
  try {
    const res = await fetch('/api/r2/status');
    if (res.ok) {
      return (await res.json()) as R2Status;
    }
  } catch {
    // Server unreachable; report as unconfigured rather than throwing.
  }
  return { configured: false, missing: ['Server unreachable'] };
}

function parseErrorBody(text: string, fallback: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Uploads a file through the server proxy, which signs and forwards the PUT
 * to Cloudflare R2. Uses XHR so upload progress can be reported.
 */
export async function uploadToR2(
  file: File,
  userId: string,
  idToken: string,
  onProgress: (percent: number) => void,
  resolvedMimeType?: string
): Promise<{ publicUrl: string; objectKey: string }> {
  const mimeType = resolvedMimeType || file.type || 'application/octet-stream';

  return new Promise<{ publicUrl: string; objectKey: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `/api/r2/upload?fileName=${encodeURIComponent(file.name)}&fileType=${encodeURIComponent(mimeType)}`;
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);
    xhr.setRequestHeader('Content-Type', mimeType);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        // Hold at 99 until the server confirms the object was written.
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as {
            publicUrl: string;
            objectKey: string;
          };
          onProgress(100);
          resolve(data);
        } catch {
          reject(new Error('Invalid upload response from server'));
        }
        return;
      }
      reject(new Error(parseErrorBody(xhr.responseText, `Upload failed with HTTP ${xhr.status}`)));
    };

    xhr.onerror = () => reject(new Error('Network error while uploading file'));
    xhr.onabort = () => reject(new Error('Upload canceled'));
    xhr.send(file);
  });
}

/**
 * Deletes an object from R2 through the server proxy. The server verifies that
 * the object key belongs to the calling user before deleting.
 */
export async function deleteFromR2(fileUrl: string, idToken: string): Promise<void> {
  const res = await fetch('/api/r2/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ fileUrl }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(parseErrorBody(text, `R2 delete failed (${res.status})`));
  }
}
