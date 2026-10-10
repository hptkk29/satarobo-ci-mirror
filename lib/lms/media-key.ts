// lib/lms/media-key.ts — R3-06: object key R2 + TTL signed URL (privacy-first, C6.5).
// Object key KHÔNG chứa tên/định danh học sinh; signed URL hết hạn 15'.

/** TTL cho signed URL media (C6.5 — 15 phút). */
export const MEDIA_SIGNED_URL_TTL_SECONDS = 15 * 60;

/** Dựng object key R2 cho 1 media buổi học. KHÔNG nhúng tên học sinh (C6.5). THUẦN. */
export function buildMediaObjectKey(input: {
  classSessionId: string;
  mediaId: string;
  ext: string;
}): string {
  const ext = input.ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `class-media/${input.classSessionId}/${input.mediaId}.${ext}`;
}

/** Kiểm tra key không lộ tên học sinh (defensive cho test/lint). THUẦN. */
export function keyContainsName(key: string, studentName: string): boolean {
  if (!studentName.trim()) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  return norm(key).includes(norm(studentName));
}
