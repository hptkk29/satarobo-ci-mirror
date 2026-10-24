// Nhãn của màn Phân công buổi — thuần, dùng chung server/client. Thẻ số + bộ lọc nay ở `lib/parttime/control-tower.ts`
// (`THE` — một vị từ cho cả đếm lẫn lọc).
import type { TrangThaiNhanLuc } from "@/lib/parttime/phan-cong";
import type { BuoiTrongTuan } from "@/lib/parttime/bang-phan-cong";

export type Tone = "danger" | "warning" | "success" | "info" | "muted";

export const NHAN_TRANG_THAI: Record<TrangThaiNhanLuc, { nhan: string; tone: Tone }> = {
  STAFFING_DRAFT: { nhan: "Thiếu người", tone: "danger" },
  NEEDS_REASSIGNMENT: { nhan: "Cần phân lại", tone: "danger" },
  STAFFING_REJECTED: { nhan: "Bị từ chối", tone: "danger" },
  // Hai trạng thái dưới chỉ còn gặp ở lời mời CŨ (trước 20/10/2026) — phân công mới là gán thẳng.
  WAITING_ACCEPTANCE: { nhan: "Chờ nhận lớp (lời mời cũ)", tone: "warning" },
  PARTIALLY_ACCEPTED: { nhan: "Nhận một phần (lời mời cũ)", tone: "warning" },
  STAFFING_CONFIRMED: { nhan: "Đủ người", tone: "success" },
};

export const TONE_CLS: Record<Tone, string> = {
  danger: "bg-state-danger-soft text-state-danger-ink",
  warning: "bg-state-warning-soft text-state-warning-ink",
  success: "bg-state-success-soft text-state-success-ink",
  info: "bg-state-info-soft text-state-info-ink",
  muted: "bg-muted text-muted-foreground",
};

/** Quyền của người xem trên khối đang mở: công tắc phân công có hiệu lực · có `hr_attendance:assign`. */
export type Quyen = { bat: boolean; coQuyen: boolean };

/** Lý do KHÔNG thao tác được — null là được. Một chỗ cho mọi nút của bảng thao tác. */
export function lyDoKhoa(b: BuoiTrongTuan, q: Quyen): string | null {
  if (!q.bat) return "Phân công theo buổi chưa bật ở cơ sở này — buổi chỉ để xem, chưa phân / đổi / huỷ được ai. Bước tiếp theo ghi ở khối “chưa bật” đầu trang.";
  if (!q.coQuyen)
    return "Bạn chỉ có quyền xem ở cơ sở này (cần quyền phân ca để phân công).";
  if (b.tinhTrang === "DA_DONG")
    return `${b.lyDoDong ?? "Buổi đã đóng"} — không phân công.`;
  if (b.tinhTrang === "DA_CHOT") return "Buổi đã kết thúc — đội hình đã khoá.";
  if (!b.apDung)
    return "Buổi trước 15/10/2026 thuộc chính sách cũ — không phân công theo SR.QD.238.";
  return null;
}

/**
 * Nhãn nút mở bảng của một buổi — suy từ CÙNG `lyDoKhoa` với bảng thao tác, nên nút và bảng không nói khác nhau. Trước 20/10/2026
 * nút luôn ghi "Xử lý" rồi mở ra câu "chưa bật — chỉ để xem": hứa một việc không làm được (luật 12).
 */
/**
 * Lý do khoá của BẢNG THAO TÁC — buổi đã qua (`suaQua`, chủ dự án 20/10/2026) đi luật "Sửa buổi đã qua" (`loiSuaBuoiDaQua`, tính ở
 * server); buổi chưa qua đi `lyDoKhoa`. MỘT hàm cho nhãn nút và cho nội dung bảng — hai chỗ tự suy là hai chỗ để lệch (luật 12).
 */
export function khoaThaoTac(b: BuoiTrongTuan & { suaQua: { loi: string | null } | null }, q: Quyen): string | null {
  if (!b.suaQua) return lyDoKhoa(b, q);
  if (!q.bat || !q.coQuyen) return lyDoKhoa(b, q);
  return b.suaQua.loi;
}

export function nhanNutBuoi(khoa: string | null): "Xử lý" | "Xem chi tiết" {
  return khoa === null ? "Xử lý" : "Xem chi tiết";
}
