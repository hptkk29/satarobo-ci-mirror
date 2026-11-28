/**
 * E-LEARNING ONLINE — kho tài sản chứng nhận (phôi). Giao diện nhỏ để test được không cần R2.
 * Cài đặt thật dùng CHÍNH bucket R2 hiện có (Q4: KHÔNG tạo bucket mới) với tiền tố `online/cn/<khoá>/<sha256>.<ext>`.
 * Khoá mang mã băm nội dung ⇒ ghi MỘT LẦN, không bao giờ đè: nội dung của một khoá không đổi theo thời gian.
 */
export type KhoTaiSan = {
  doc(key: string): Promise<Uint8Array | null>;
  /** Ghi nếu CHƯA có; trả `true` nếu vừa ghi, `false` nếu đã có sẵn (không đè). */
  ghiMotLan(key: string, bytes: Uint8Array, mime: string): Promise<boolean>;
};

export function khoBoNho(): KhoTaiSan & { map: Map<string, Uint8Array> } {
  const map = new Map<string, Uint8Array>();
  return {
    map,
    async doc(key) {
      return map.get(key) ?? null;
    },
    async ghiMotLan(key, bytes) {
      if (map.has(key)) return false;
      map.set(key, new Uint8Array(bytes));
      return true;
    },
  };
}

/** R2 hiện có. Nạp động để bộ test thuần/CI không cần SDK hay biến môi trường R2. */
export async function khoR2(): Promise<KhoTaiSan> {
  const { GetObjectCommand, HeadObjectCommand, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const { getR2Bucket, getR2Client } = await import("@/lib/storage/r2-client");
  const cli = getR2Client();
  const Bucket = getR2Bucket();
  return {
    async doc(key) {
      try {
        const r = await cli.send(new GetObjectCommand({ Bucket, Key: key }));
        const b = await r.Body?.transformToByteArray();
        return b ?? null;
      } catch (e) {
        if ((e as { name?: string }).name === "NoSuchKey" || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
        throw e;
      }
    },
    async ghiMotLan(key, bytes, mime) {
      try {
        await cli.send(new HeadObjectCommand({ Bucket, Key: key }));
        return false;
      } catch (e) {
        if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw e;
      }
      // Riêng tư: không ACL công khai; đọc qua máy chủ (đã kiểm quyền) khi dựng PDF.
      await cli.send(new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentType: mime, CacheControl: "private, max-age=31536000, immutable" }));
      return true;
    },
  };
}
