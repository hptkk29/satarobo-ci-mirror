// lib/students/anh-dai-dien-tai-len.ts — phần DÙNG CHUNG của hai route tải ảnh đại diện học viên:
//   · admin  `app/api/admin/students/anh-dai-dien/route.ts`  (quyền students:edit|create)
//   · portal `app/api/portal/anh-dai-dien/route.ts`          (phụ huynh tải cho con mình — 12/11/2026)
// Khuôn khoá phải khớp `laUrlAnhHocVien` (lib/students/anh-dai-dien-url.ts) — đổi bên nào thì đổi cả hai.
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuid } from "uuid";
import { getPublicUrl, getR2Bucket, getR2Client } from "@/lib/storage/r2-client";

/** Trần 4MB: nền tảng cắt body request ở ~4,5MB nên hứa nhiều hơn là hứa suông. */
export const TOI_DA_BYTE_ANH_DAI_DIEN = 4 * 1024 * 1024;

export type LoaiAnh = { mime: "image/jpeg" | "image/png" | "image/webp"; duoi: "jpg" | "png" | "webp" };

/** Nhận loại ảnh từ vài byte đầu (KHÔNG tin `file.type` trình duyệt khai). Không khớp ⇒ `null`. */
export function docChuKyAnh(b: Uint8Array): LoaiAnh | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mime: "image/jpeg", duoi: "jpg" };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 8 && png.every((v, i) => b[i] === v)) return { mime: "image/png", duoi: "png" };
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { mime: "image/webp", duoi: "webp" };
  }
  return null;
}

/** Đẩy ảnh lên R2 với khoá `uploads/students/<yyyy-mm>/<uuid>.<đuôi>`; trả URL công khai. Lỗi kho ⇒ ném. */
export async function dayAnhDaiDienLenR2(bytes: Buffer, loai: LoaiAnh): Promise<string> {
  const thang = new Date().toISOString().slice(0, 7); // yyyy-mm
  const key = `uploads/students/${thang}/${uuid()}.${loai.duoi}`;
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: getR2Bucket(),
      Key: key,
      Body: bytes,
      ContentType: loai.mime,
      // Mỗi lần tải là uuid mới ⇒ nội dung dưới một khoá không bao giờ đổi.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return getPublicUrl(key);
}
