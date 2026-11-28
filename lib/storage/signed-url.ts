import "server-only";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client, getR2Bucket, getR2PublicUrl } from "@/lib/storage/r2-client";
import { isMediaSignedUrlEnabled } from "@/lib/flags";

// =============================================================================
// R7-09 — Signed URL cho media R2 (presigned GET, TTL ngắn).
// Ảnh lưu fileUrl = public URL (`${R2_PUBLIC_URL}/${key}`). Khi bật flag
// MEDIA_SIGNED_URL, portal + admin render qua URL đã ký hết hạn nhanh →
// link bị share/đổi id/hết hạn sẽ bị R2 trả 403 (AC5).
// =============================================================================

/** Tách object key từ public URL (strip prefix R2_PUBLIC_URL). null nếu không khớp. */
export function keyFromPublicUrl(fileUrl: string): string | null {
  if (!fileUrl) return null;
  let base: string;
  try {
    base = getR2PublicUrl(); // throw nếu env thiếu → caller bắt
  } catch {
    return null;
  }
  if (fileUrl.startsWith(base + "/")) {
    return fileUrl.slice(base.length + 1);
  }
  // fileUrl có thể đã là key trần (không bắt đầu bằng http) → coi như key.
  if (!/^https?:\/\//i.test(fileUrl)) {
    return fileUrl.replace(/^\//, "");
  }
  return null;
}

/**
 * Ký URL GET cho 1 object key, mặc định hết hạn 600s (10 phút). Hết hạn / sai
 * chữ ký (đổi id) → R2 trả 403.
 */
export async function signedMediaUrl(key: string, ttlSeconds = 600): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getR2Bucket(), Key: key });
  return getSignedUrl(getR2Client(), command, { expiresIn: ttlSeconds });
}

/**
 * Quy đổi fileUrl để hiển thị: flag ON → presigned GET; OFF → fileUrl trần.
 * Fail-safe: lỗi ký / không tách được key → trả fileUrl gốc (không vỡ trang).
 */
export async function resolveMediaUrl(fileUrl: string, ttlSeconds = 600): Promise<string> {
  if (!isMediaSignedUrlEnabled()) return fileUrl;
  const key = keyFromPublicUrl(fileUrl);
  if (!key) return fileUrl;
  try {
    return await signedMediaUrl(key, ttlSeconds);
  } catch {
    return fileUrl;
  }
}

/** Quy đổi 1 mảng fileUrl (giữ thứ tự). */
export async function resolveMediaUrls(
  fileUrls: string[],
  ttlSeconds = 600,
): Promise<string[]> {
  if (!isMediaSignedUrlEnabled()) return fileUrls;
  return Promise.all(fileUrls.map((u) => resolveMediaUrl(u, ttlSeconds)));
}
