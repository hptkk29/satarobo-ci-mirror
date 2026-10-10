// app/(admin)/admin/lop-trial/_lib/phieu-danh-gia.ts — 27/08/2026.
//
// Nút lấy phiếu đánh giá trên DÒNG ĐIỂM DANH, thay cho khối "Phiếu đánh giá buổi học"
// (hệ SESSION_EVAL) đã gỡ khỏi màn này.
//
// VÌ SAO GỠ KHỐI KIA: nó là CỬA THỨ HAI cho cùng một việc. Giáo viên thật sự chấm bằng
// phiếu rubric ở site giáo viên, lưu vào `TrialRubricEval` — và chính phiếu đó mới là
// thứ Sale in đưa phụ huynh (route PDF site Sale đã dùng nó từ Đợt C). Khối SESSION_EVAL
// đọc một kho KHÁC, nên Sale mở ra luôn thấy trống dù giáo viên đã chấm xong. Bỏ bớt
// một hệ đúng hơn là vá cho hai hệ cùng sống.
//
// File THUẦN, không import Prisma/auth: client component kéo theo được.

/** Câu báo DUY NHẤT khi chưa có phiếu — nút bấm và route PDF dùng chung. */
export const LOI_CHUA_DANH_GIA = "Học viên chưa được giáo viên đánh giá ở buổi này";

/** Nhãn nút theo trạng thái phiếu của (ca × buổi). */
export function nhanNutPhieu(daDanhGia: boolean): string {
  return daDanhGia ? "Xuất PDF" : "Nhận phiếu đánh giá";
}

/**
 * Đường dẫn xuất phiếu PDF của MỘT ca ở MỘT buổi.
 *
 * ⚠️ Bắt buộc mang `sessionId`: GĐ4 khoá phiếu theo cặp (ca, buổi) nên một ca có nhiều
 * phiếu. Thiếu tham số này thì dòng buổi 1 in ra phiếu buổi 2 — sai phiếu mà trông vẫn
 * bình thường, không ai phát hiện.
 *
 * Viết `/lop-trial/...` (không kèm `/admin`) cho khớp mọi liên kết khác của màn: host
 * admin bỏ tiền tố, còn localhost thì proxy thêm vào.
 */
export function duongDanPdfPhieu(enrollmentId: string, sessionId: string): string {
  return `/lop-trial/pdf/${encodeURIComponent(enrollmentId)}?sessionId=${encodeURIComponent(sessionId)}`;
}
