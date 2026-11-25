// lib/scorm/cache-asset.ts — chính sách Cache-Control của route asset SCORM/PDF. THUẦN, một chỗ duy nhất.
//
// Danh tính cache của một asset con = URL, và URL kiểu mới mang MÃ GÓI (`/api/scorm/asset/<packageId>/…`); đổi/thay gói ⇒ mã gói
// mới (publishAndSwapLessonMaterial xoá bản cũ, gói mới có id mới) ⇒ không có bản cache cũ nào còn khớp URL. Vì thế `max-age`
// an toàn CHỈ khi URL có mã gói. URL kiểu cũ (không mã gói) dùng chung giữa các gói ⇒ KHÔNG được cache.
//
// Vì sao KHÔNG `Vary: Cookie` (chủ ý, đừng thêm "cho chắc"):
//  · Cookie vé đổi giá trị mỗi lần gia hạn (≈ 4–5 phút/lần) ⇒ `Vary: Cookie` làm mọi bản cache hết khớp ngay sau lần gia hạn đầu,
//    tức tắt cache hoàn toàn — đúng thứ chính sách này sinh ra để giữ (gói thật 400–570 tệp, mạng yếu).
//  · Cái cần chặn là CACHE DÙNG CHUNG (proxy/CDN) phát bản của người này cho người khác: `private` đã cấm điều đó. Bản cache còn lại
//    nằm trong hồ sơ trình duyệt của CHÍNH người đã tải, nên không có "người khác" nào được phát nhầm.
//  · Quyền không nằm ở cache mà ở HAI chỗ: trang mở bài (kiểm quyền rồi mới ký vé) và route asset (vé + phiên + mã gói) cho mỗi lượt
//    KHÔNG trúng cache. Tệp đã được trình duyệt giữ thì trình duyệt tự phát, không hỏi máy chủ.
//
// ⚠️ RỦI RO CÒN LẠI, biết mà chấp nhận: máy DÙNG CHUNG ở cơ sở (GV A đăng xuất, GV B đăng nhập cùng trình duyệt/hồ sơ). Trong tối đa
// 1 giờ, B gõ thẳng URL asset của gói A đã mở (cần biết mã gói cuid + đường dẫn tệp) sẽ nhận bản cache mà không qua kiểm quyền.
// Chấp nhận vì: (1) chỉ là học liệu nội bộ, không phải dữ liệu cá nhân; (2) chặn trên bằng `max-age` (1 giờ) — KHÔNG kéo dài thêm;
// (3) tên host admin/giaovien là hai nguồn gốc nên hai kho cache tách nhau; (4) hai bản HTML dẫn vào (hop đầu mang vé) là `no-store`.
export type DauVaoCache = {
  /** Hop đầu mang vé trên URL (`?t=`): đừng để trình duyệt/proxy giữ bản có vé. */
  coQueryToken: boolean;
  /** URL kiểu cũ — không có mã gói, trùng nhau giữa các gói. */
  urlKieuCu: boolean;
};

export const CACHE_ASSET_CON = "private, max-age=3600";
export const CACHE_KHONG_LUU = "private, no-store";

/**
 * Cache-Control cho MỌI phản hồi LỖI của route asset (403/404/416/5xx…). Không đặt gì thì 404 có thể bị trình duyệt/proxy lưu theo
 * heuristic — một lần 404 do gói đang tải lên dở hay đệm đĩa trượt sẽ "dính" cả giờ dù tệp đã có; 403 do vé hết hạn dính sau khi
 * đã gia hạn xong. Lỗi luôn đi `no-store`.
 */
export const CACHE_LOI = CACHE_KHONG_LUU;

export function chinhSachCache(d: DauVaoCache): { cacheControl: string; vary: string | null } {
  if (d.coQueryToken || d.urlKieuCu) return { cacheControl: CACHE_KHONG_LUU, vary: null };
  return { cacheControl: CACHE_ASSET_CON, vary: null };
}
