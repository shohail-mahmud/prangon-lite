/**
 * Prangon Lite — media limits.
 *
 * IMPORTANT: the checks here are a UX affordance, NOT the security boundary.
 * The real enforcement lives server-side:
 *   * 20 MiB video ceiling -> `post-videos` bucket `file_size_limit`
 *     (migration 20261021000001), enforced by the Storage API regardless of
 *     what this file says.
 *   * image resize / re-encode / metadata strip -> `process-image` edge
 *     function, which runs with the service role.
 *
 * We duplicate the numbers here purely so the user is told the limit BEFORE
 * they pick a file instead of after a failed upload.
 */

/** 20 MiB = 20 × 1024 × 1024. Binary, not decimal — see migration notes. */
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

/** Ceiling for images handed to the processing pipeline. */
export const MAX_IMAGE_INPUT_BYTES = 30 * 1024 * 1024;

/** Longest edge the processor stores, in pixels. */
export const MAX_IMAGE_DIMENSION = 2048;

export const ACCEPTED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "video/3gpp",
];

export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** "20 MB" for display next to the picker. */
export const MAX_VIDEO_LABEL = formatBytes(MAX_VIDEO_BYTES);
export const MAX_IMAGE_LABEL = formatBytes(MAX_IMAGE_INPUT_BYTES);

export function isVideo(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v|3gp)$/i.test(file.name);
}

export function isImage(file: File): boolean {
  return file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name);
}

export interface ValidationResult {
  ok: boolean;
  message?: string;
}

/**
 * Advisory pre-flight check. Catches the common case early with a clear
 * message; anything that slips past is still stopped by the bucket limit or
 * the edge function.
 */
export function validateMediaFile(file: File): ValidationResult {
  if (isVideo(file)) {
    if (!ACCEPTED_VIDEO_TYPES.includes(file.type) && !/\.(mp4|mov|webm|m4v|3gp)$/i.test(file.name)) {
      return { ok: false, message: `Unsupported video format. Use MP4, MOV or WebM.` };
    }
    if (file.size > MAX_VIDEO_BYTES) {
      return {
        ok: false,
        message: `Video is ${formatBytes(file.size)}. The maximum is ${MAX_VIDEO_LABEL}.`,
      };
    }
    return { ok: true };
  }

  if (isImage(file)) {
    if (file.size > MAX_IMAGE_INPUT_BYTES) {
      return {
        ok: false,
        message: `Image is ${formatBytes(file.size)}. The maximum is ${MAX_IMAGE_LABEL}.`,
      };
    }
    return { ok: true };
  }

  return { ok: false, message: "Only images and videos can be uploaded." };
}

/**
 * Supabase Storage serves image transformations off the same public URL.
 * Feeds and lists should ask for a width appropriate to the layout instead of
 * pulling the full-size original for every card.
 */
export function sizedImageUrl(
  url: string | null | undefined,
  width: number,
  quality = 75,
): string | null {
  if (!url) return null;
  if (!/\/storage\/v1\/object\/public\//.test(url)) return url;
  if (!/\.(jpe?g|png|webp|avif)$/i.test(url)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}width=${width}&quality=${quality}&resize=cover`;
}
