'use client';

/**
 * Small client helper for the admin "upload from device" flow.
 *
 * The file is posted to /api/admin/upload (same-origin, admin-authenticated).
 * That route holds the ImgBB secret server-side, so the API key never reaches
 * the browser. It returns the ImgBB URL plus detected dimensions.
 */

export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
export const UPLOAD_MAX_BYTES = 12 * 1024 * 1024;

export interface UploadResult {
  url: string;
  width: number | null;
  height: number | null;
}

export function validateLocalFile(file: File): string | null {
  if (!UPLOAD_TYPES.includes(file.type)) return 'Unsupported file type — use JPG, PNG, WebP, GIF or AVIF.';
  if (file.size > UPLOAD_MAX_BYTES) return 'File is larger than 12 MB.';
  if (file.size <= 0) return 'File appears to be empty.';
  return null;
}

export async function uploadFileToWallora(file: File, api: (url: string) => string): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(api('/api/admin/upload'), { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok || !data?.url) throw new Error(data?.error || 'Upload failed.');
  return { url: String(data.url), width: data.width ?? null, height: data.height ?? null };
}
