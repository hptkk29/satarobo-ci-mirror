// lib/hoc-bu/cap-them-luot.ts — QLCS ĐIỀU CHỈNH LƯỢT HỌC BÙ của một học viên (cấp thêm HOẶC giảm): luật THUẦN (kiểm đầu vào + khoá chống lặp), dùng chung cho server action và màn hình.
//
// Chủ dự án chốt 22/10/2026 thay cho chức năng "học vượt" riêng: không dựng luồng học vượt thứ hai (học vượt = học đuổi các buổi lớp đã dạy đã có
// đường riêng — `HOC_VUOT` miễn phí và "Bù theo yêu cầu"); chỉ cho Quản lý cơ sở THÊM hạn mức học bù, CỘNG DỒN từng lần cấp. Cùng ngày chủ dự án bổ sung:
// "cấp được thì xoá lại được" — QLCS giảm được lượt đã cấp mà không phải nhờ sửa code. Hai chiều dùng MỘT đường ghi, phân biệt bằng DẤU của `delta`.
//
// Là một bút toán `ADJUSTMENT` trong SỔ LƯỢT (`so-luot.ts`) — cùng sổ, cùng bất biến với mọi lượt khác. Chiều GIẢM chỉ rút được phần lượt còn TRỐNG
// (`gioiHanDieuChinhGiam`): lượt đang giữ chỗ trong case hoặc đã tiêu là sự thật đã xảy ra, không rút lại được. Lượt cấp thêm CHỈ có tác dụng với dòng cần bù do
// VẮNG THƯỜNG: dòng `HOC_VUOT` / `VAO_TRE` / `PHUC_HOC` / miễn phí ngoại lệ vốn không dùng lượt, dòng "bù theo yêu cầu — tính phí" luôn đòi phí (`batBuocPhi`).
import { LY_DO_TOI_THIEU } from "@/lib/hoc-bu/huy";

/** Số lượt tối đa trong MỘT lần cấp / giảm — chặn gõ nhầm cả khoá. Cần nhiều hơn thì làm thêm lần nữa (cộng dồn). */
export const TOI_DA_LUOT_MOI_LAN = 12;

/** Mã chống bấm đúp, do hộp thoại sinh MỖI LẦN MỞ. Chỉ chữ-số-gạch để ghép vào khoá bút toán mà không lẫn dấu phân cách. */
const MA_LAN_CAP = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Câu từ chối đầu vào, hoặc `null` nếu hợp lệ. `delta` > 0 = cấp thêm, < 0 = giảm. Lý do BẮT BUỘC cả hai chiều: đây là quyết định về quyền lợi của học viên
 * và phải truy được về sau.
 */
export function kiemCapThemLuot(p: { delta: number; lyDo: string; maLanCap: string }): string | null {
  if (!Number.isInteger(p.delta) || p.delta === 0) return "Số lượt cấp thêm hoặc giảm phải là số nguyên khác 0";
  if (Math.abs(p.delta) > TOI_DA_LUOT_MOI_LAN) return `Mỗi lần cấp hoặc giảm tối đa ${TOI_DA_LUOT_MOI_LAN} lượt — cần nhiều hơn thì làm thêm lần nữa`;
  if (p.lyDo.trim().length < LY_DO_TOI_THIEU) return `Ghi lý do ${p.delta > 0 ? "cấp thêm" : "giảm"} lượt ít nhất ${LY_DO_TOI_THIEU} ký tự`;
  if (!MA_LAN_CAP.test(p.maLanCap)) return "Phiên cấp lượt không hợp lệ — đóng hộp và mở lại";
  return null;
}

/**
 * Phần `nguon` của khoá bút toán (`ADJUSTMENT:<nguon>`). KHÔNG bao giờ bắt đầu bằng `don:` — `don-doi-db.ts` coi `ADJUSTMENT:don:*` là phần lượt THEO
 * ĐƠN KHOÁ HỌC và thu hồi chênh lệch khi đơn bị huỷ/hoàn; lượt QLCS cấp tay là quyền lợi được cho riêng, không đi theo đơn.
 */
export function nguonCapThem(maLanCap: string): string {
  return `qlcs:${maLanCap}`;
}

/** Lý do ghi vào bút toán (hiện ở "Vì sao còn x/y lượt?"). */
export function lyDoCapThem(delta: number, lyDo: string): string {
  return `${delta > 0 ? `QLCS cấp thêm ${delta} lượt` : `QLCS giảm ${-delta} lượt`}: ${lyDo.trim()}`;
}
