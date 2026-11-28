import { laKhoaVideoOnlineHopLe, VUNG_VIDEO_ONLINE } from "./video-khoa";

/**
 * E-LEARNING ONLINE — KHOÁ VIDEO Ở LỚP PHÁT (A, V8.44). Hàm THUẦN, không DB, không R2.
 *
 * ⚠️ KHÔNG còn chính sách khoá riêng của A. Chuẩn DUY NHẤT là hàm của Core E: `laKhoaVideoOnlineHopLe` / `VUNG_VIDEO_ONLINE` (`./video-khoa.ts`,
 * hợp đồng `docs/elearning/E-R2-PRIVATE-VIDEO-CONTRACT.md`): khoá chỉ nằm dưới `online/video/<khoá>/<bài>/<mã>.(mp4|webm|mov)`, bảng ký tự đóng
 * từng đoạn, không `..`, không `%`. File này chỉ BỌC hàm đó để lớp phát có (a) mã lý do cho log/ánh xạ HTTP và (b) `Content-Type` suy từ ĐUÔI
 * (không từ metadata R2: một tệp `.html` đội lốt không bao giờ được phục vụ). Muốn đổi vùng khoá ⇒ đổi MỘT chỗ `VUNG_VIDEO_ONLINE`.
 * Khoá hợp lệ KHÔNG BAO GIỜ ra khỏi máy chủ (không vào vé, không vào JSON).
 */

const CONTENT_TYPE: Readonly<Record<string, string>> = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };

export type KetQuaKhoaVideo = { ok: true; khoa: string; contentType: string } | { ok: false; lyDo: "RONG" | "QUA_DAI" | "NGOAI_VUNG" | "KHOA_KHONG_HOP_LE" };

export function kiemKhoaVideo(mediaRef: unknown): KetQuaKhoaVideo {
  if (typeof mediaRef !== "string" || mediaRef.length === 0) return { ok: false, lyDo: "RONG" };
  if (mediaRef.length > 300) return { ok: false, lyDo: "QUA_DAI" };
  if (!mediaRef.startsWith(VUNG_VIDEO_ONLINE)) return { ok: false, lyDo: "NGOAI_VUNG" };
  if (!laKhoaVideoOnlineHopLe(mediaRef)) return { ok: false, lyDo: "KHOA_KHONG_HOP_LE" };
  const duoi = mediaRef.slice(mediaRef.lastIndexOf(".") + 1);
  // `laKhoaVideoOnlineHopLe` đã khoá đuôi ∈ {mp4,webm,mov}; tra bằng `hasOwn` để không bao giờ trúng nguyên mẫu đối tượng.
  if (!Object.prototype.hasOwnProperty.call(CONTENT_TYPE, duoi)) return { ok: false, lyDo: "KHOA_KHONG_HOP_LE" };
  return { ok: true, khoa: mediaRef, contentType: CONTENT_TYPE[duoi]! };
}
