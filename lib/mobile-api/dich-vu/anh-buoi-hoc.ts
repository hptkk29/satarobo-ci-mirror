import { z } from "zod";

import { isMediaSignedUrlEnabled } from "@/lib/flags";
import { getStudentPhotos } from "@/lib/portal/photos";
import { keyFromPublicUrl, signedMediaUrl } from "@/lib/storage/signed-url";

import type { MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile } from "../xac-thuc/dich-vu";

/**
 * `GET /students/:id/photos` — ẢNH BUỔI HỌC của MỘT con (BR-PHOTO-01 / P-San-pham, H-San-pham). CHỈ ĐỌC.
 *
 * NGUỒN = đúng truy vấn của web (`getStudentPhotos`): con có đồng ý ảnh lớp (`StudentConsent CLASS_MEDIA` đang GRANTED) · ảnh `APPROVED` (DRAFT/PENDING/REJECTED không lộ) ·
 * gắn thẻ con HOẶC «ảnh chung cả lớp» · lớp con có ghi danh (kể cả đã nghỉ/hoàn thành — màn lịch sử). Thu hồi đồng ý ⇒ ảnh biến mất ở lượt tải kế tiếp.
 *
 * ⛔ URL: CHỈ URL KÝ NGẮN HẠN (≤ 15 phút) của kho riêng. Không bao giờ trả URL công khai:
 *   · cờ `MEDIA_SIGNED_URL` TẮT hoặc kho ký không khả dụng ⇒ 503 `MEDIA_CHUA_SAN_SANG` (fail-closed) — app hiện «chưa sẵn sàng», không hiện ảnh;
 *   · một ảnh không ký được (URL ngoài kho của app / ký lỗi) ⇒ ẢNH ĐÓ BỊ BỎ (không thay bằng URL gốc); mọi ảnh lỗi ký ⇒ 503.
 * Không trả `fileUrl` gốc, tên tệp, người tải lên/người duyệt, id lớp.
 */
export const locAnhSchema = z.object({ soLuong: z.coerce.number().int().min(1).max(100).default(60), trang: z.coerce.number().int().min(1).max(50).default(1) }).strict();
export type LocAnh = z.infer<typeof locAnhSchema>;
export const TTL_URL_ANH_GIAY = 900;
/** Trần số ảnh được ký mỗi lượt đọc (ký là phép tính cục bộ; trần chống lượt đọc vô hạn). */
const TRAN_ANH_KY = 500;

export type KyAnh = (fileUrl: string) => Promise<string | null>;
/** Bộ ký mặc định: chỉ khi cờ BẬT, URL thuộc kho của app, và ký thành công; mọi trường hợp khác ⇒ null (không URL công khai). */
/** Ảnh nằm trong KHO RIÊNG của app (R2 riêng tư khi có, kho cục bộ ở UAT): tham chiếu `private:class-media/<tên>` — chỉ ký qua kho riêng, TTL ≤ 15 phút, khoá phải đúng khuôn (chống `..`/đường dẫn lạ). */
export const TIEN_TO_ANH_BUOI_RIENG = "private:class-media/";
export function khoaAnhBuoiRieng(fileUrl: string): string | null {
  if (!fileUrl.startsWith(TIEN_TO_ANH_BUOI_RIENG)) return null;
  const key = fileUrl.slice("private:".length);
  return /^class-media\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(key) && !key.includes("..") ? key : null;
}
export const kyAnhMacDinh: KyAnh = async (fileUrl) => {
  if (fileUrl.startsWith("private:")) {
    const key = khoaAnhBuoiRieng(fileUrl);
    if (!key) return null;
    try {
      const { layKhoTepRieng } = await import("../kho-tep-rieng");
      const kho = layKhoTepRieng();
      return kho ? await kho.kyGet(key, TTL_URL_ANH_GIAY) : null; // không có kho ⇒ null (fail-closed)
    } catch {
      return null;
    }
  }
  if (!isMediaSignedUrlEnabled()) return null;
  const key = keyFromPublicUrl(fileUrl);
  if (!key) return null;
  try {
    return await signedMediaUrl(key, TTL_URL_ANH_GIAY);
  } catch {
    return null;
  }
};

export type AnhDto = { id: string; tieuDe: string | null; url: string };
export type NhomAnhDto = { buoiId: string | null; soBuoi: number | null; tieuDe: string; ngay: string; nhanNgay: string; anh: AnhDto[] };
export type AnhBuoiHocDto = { dongYHinhAnh: boolean; tongSo: number; hetHanSauGiay: number; nhom: NhomAnhDto[]; trang: number; coTrangSau: boolean };

export async function layAnhBuoiHoc(hs: MaHocVienDaKiem, loc: LocAnh, ky: KyAnh = kyAnhMacDinh): Promise<AnhBuoiHocDto> {
  const nguon = await getStudentPhotos(hs, { urlTho: true });
  if (!nguon.consentGranted) return { dongYHinhAnh: false, tongSo: 0, hetHanSauGiay: TTL_URL_ANH_GIAY, nhom: [], trang: loc.trang, coTrangSau: false };
  // Phẳng hoá theo thứ tự nhóm (mới nhất trước), KÝ TRƯỚC (tối đa TRAN_ANH_KY ảnh) rồi mới cắt trang trên các ảnh KÝ ĐƯỢC: ảnh không ký được (URL cũ ngoài kho của app) bị bỏ khỏi cả đếm lẫn trang,
  // nên một trang không bị «trống» chỉ vì đầu danh sách toàn ảnh cũ; ký là phép tính cục bộ (không gọi mạng).
  const phang = nguon.groups.flatMap((g) => g.photos.map((p) => ({ g, p }))).slice(0, TRAN_ANH_KY);
  const daKyHet = (await Promise.all(phang.map(async (x) => ({ x, url: await ky(x.p.url) })))).filter((d): d is { x: (typeof phang)[number]; url: string } => d.url !== null);
  if (phang.length > 0 && daKyHet.length === 0) throw new LoiApiMobile("MEDIA_CHUA_SAN_SANG", 503, "Kho ảnh chưa sẵn sàng. Vui lòng thử lại sau.");
  const tu = (loc.trang - 1) * loc.soLuong;
  const daKy = daKyHet.slice(tu, tu + loc.soLuong);
  const nhom = new Map<string, NhomAnhDto>();
  for (const { x, url } of daKy) {
    const k = x.g.sessionId;
    if (!nhom.has(k)) nhom.set(k, { buoiId: k === "khac" ? null : k, soBuoi: x.g.order, tieuDe: x.g.title, ngay: x.g.dateISO, nhanNgay: x.g.nhanNgay, anh: [] });
    nhom.get(k)!.anh.push({ id: x.p.id, tieuDe: x.p.caption, url });
  }
  return { dongYHinhAnh: true, tongSo: daKyHet.length, hetHanSauGiay: TTL_URL_ANH_GIAY, nhom: [...nhom.values()], trang: loc.trang, coTrangSau: tu + loc.soLuong < daKyHet.length };
}
