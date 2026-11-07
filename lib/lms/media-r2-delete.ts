// lib/lms/media-r2-delete.ts — F-03 / L-F4: từ chối hoặc gỡ ảnh lớp thì TỆP phải mất.
//
// Vì sao tệp này tồn tại: `ClassSessionMedia.fileUrl` trỏ vào bucket R2 **công khai**
// (`R2_PUBLIC_URL` = CDN mở, `lib/storage/r2-client.ts`), và cờ ký link
// `MEDIA_SIGNED_URL` mặc định TẮT (`lib/flags.ts:80-82`). Nên đổi trạng thái hay xoá
// dòng DB **không** làm ảnh biến mất: ai còn giữ link cũ vẫn tải được ảnh học viên,
// vô danh, vĩnh viễn. Muốn ảnh bị từ chối thật sự mất thì phải xoá object trên kho.
//
// HAI BẤT BIẾN, cả hai đều đắt nếu bỏ:
//
// (1) THỨ TỰ: kho R2 trước, DB sau. Kho lỗi ⇒ dừng, KHÔNG đụng DB. Hai chiều hỏng
//     không đối xứng: "tệp mất, dòng còn" là rác lành — dòng trỏ vào key chết, xem là
//     ảnh vỡ, dọn lại được. "Dòng mất, tệp còn" là ảnh học viên nằm trên CDN công khai
//     mà không còn bản ghi nào cho biết nó của lớp nào, em nào — không ai lần ra để dọn.
//
// (2) KHÔNG xoá tệp mà bản ghi khác còn trỏ tới. `fileUrl` là dữ liệu người gửi truyền
//     lên; đường ghi chỉ chặn ở tiền tố kho hệ thống (`isOwnStorageUrl`), không buộc
//     mỗi dòng một key riêng. Thiếu rào này thì "xoá ảnh nháp của lớp mình" phá được
//     ảnh ĐÃ DUYỆT của lớp khác chỉ bằng cách chép lại URL vào một dòng nháp.
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getR2Client, getR2Bucket } from "@/lib/storage/r2-client";
import { keyFromPublicUrl } from "@/lib/storage/signed-url";
import { db } from "@/lib/db";

/** Trần số key một lệnh DeleteObjects của S3/R2 nhận được. */
export const R2_DELETE_CHUNK = 1000;

/**
 * Kho R2 từ chối lệnh xoá ⇒ phần ghi DB bị bỏ. Có kiểu riêng để caller phân biệt
 * "chưa làm gì cả, mời thử lại" với lỗi DB (nghĩa hoàn toàn khác) và không nuốt nhầm.
 */
export class MediaFilePurgeError extends Error {
  constructor(cause: unknown) {
    super("Không xoá được tệp trên kho lưu trữ");
    this.name = "MediaFilePurgeError";
    this.cause = cause;
  }
}

export type MediaFileRow = { id: string; fileUrl: string | null };

/**
 * THUẦN — trong các dòng sắp bị xoá/từ chối, tệp nào an toàn để xoá khỏi kho:
 * bỏ dòng không có tệp, bỏ trùng, và bỏ mọi tệp mà một bản ghi KHÁC còn trỏ tới.
 */
export function urlsSafeToDelete(
  rows: MediaFileRow[],
  stillReferencedUrls: string[],
): string[] {
  const kept = new Set(stillReferencedUrls);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const url = r.fileUrl?.trim();
    if (!url) continue;
    if (kept.has(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * Xoá object trên R2 theo danh sách URL công khai. Trả số key đã gửi lệnh xoá.
 * URL không tách được key (không thuộc kho hệ thống) bị bỏ qua — lệnh xoá nhắm vào
 * key rác còn tệ hơn, và đường ghi đã chặn URL ngoài từ đầu.
 *
 * ⚠️ Lỗi kho được NÉM RA NGOÀI, cố ý. Nuốt lỗi ở đây là quay về đúng lỗ cũ: người
 * bấm từ chối thấy báo thành công trong khi ảnh vẫn tải được.
 */
export async function deleteMediaObjectsByUrl(urls: string[]): Promise<number> {
  if (urls.length === 0) return 0;
  const keys = urls
    .map((u) => keyFromPublicUrl(u))
    .filter((k): k is string => Boolean(k));
  if (keys.length === 0) return 0;

  const client = getR2Client();
  const bucket = getR2Bucket();
  for (let i = 0; i < keys.length; i += R2_DELETE_CHUNK) {
    const chunk = keys.slice(i, i + R2_DELETE_CHUNK).map((Key) => ({ Key }));
    await client.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk, Quiet: true } }),
    );
  }
  return keys.length;
}

/**
 * Xoá tệp trên kho R2 TRƯỚC, rồi mới chạy `writeDb`. Kho lỗi ⇒ ném lỗi và `writeDb`
 * KHÔNG chạy (bất biến 1). Tệp còn bản ghi khác trỏ tới thì giữ lại nhưng `writeDb`
 * vẫn chạy (bất biến 2) — dòng của lớp này vẫn phải được xử lý.
 *
 * Truy vấn "còn ai trỏ tới" đi bằng `db` TRẦN, không qua `scopedDb`: đây là rào an
 * toàn cho việc XOÁ, phải nhìn toàn hệ thống. Lọc theo phạm vi ở đây sẽ ẩn mất bản ghi
 * của cơ sở khác ⇒ tưởng không ai dùng ⇒ xoá mất tệp của họ.
 */
export async function purgeMediaFilesThen<T>(
  rows: MediaFileRow[],
  writeDb: () => Promise<T>,
): Promise<T> {
  const candidates = urlsSafeToDelete(rows, []);
  if (candidates.length === 0) return writeDb();

  try {
    const others = await db.classSessionMedia.findMany({
      where: { fileUrl: { in: candidates }, id: { notIn: rows.map((r) => r.id) } },
      select: { fileUrl: true },
    });
    const urls = urlsSafeToDelete(
      rows,
      others.map((o) => o.fileUrl).filter((u): u is string => Boolean(u)),
    );
    await deleteMediaObjectsByUrl(urls);
  } catch (err) {
    throw new MediaFilePurgeError(err);
  }
  return writeDb();
}
