import type { DieuKien, ThamSoHanhDong } from "@/lib/elearning/automation";

/**
 * P7 — CÂU MÔ TẢ "Khi …" / "Thì …" của một luật cho bảng Tự động hoá (thiết kế `QtTuDong`). THUẦN.
 * Chỉ diễn đạt lại dữ liệu CÓ THẬT của luật (kích hoạt, điều kiện, hành động, hạn) — không suy diễn thêm.
 */
export const NHAN_KICH_HOAT: Readonly<Record<string, string>> = {
  NHAN_SU_MOI: "Nhân sự mới vào làm",
  KHOA_HOAN_THANH: "Hoàn thành một khoá",
  CHUNG_NHAN_HET_HAN: "Chứng nhận hết hiệu lực",
  YEU_CAU_MOI_AP_DUNG: "Yêu cầu đào tạo mới áp dụng",
};

type Ten = ReadonlyMap<string, string>;

export function moTaKhi(trigger: string, dk: DieuKien, ten: { phongBan: Ten; khoa: Ten }): string {
  const goc = NHAN_KICH_HOAT[trigger] ?? trigger;
  const phan: string[] = [goc];
  if (trigger === "NHAN_SU_MOI") {
    if (dk.trongVongNgay != null) phan.push(`trong ${dk.trongVongNgay} ngày đầu`);
    if (dk.departmentId) phan.push(ten.phongBan.get(dk.departmentId) ?? "một phòng ban");
  }
  if ((trigger === "KHOA_HOAN_THANH" || trigger === "CHUNG_NHAN_HET_HAN") && dk.courseId) {
    phan.push(`khoá ${ten.khoa.get(dk.courseId) ?? "đã chọn"}`);
  }
  return phan.join(" · ");
}

export function moTaThi(action: string, aj: ThamSoHanhDong, dueDays: number, ten: { khoa: Ten; loTrinh: Ten }): string {
  if (action === "GIAO_KHOA") return `Giao khoá ${aj.courseId ? (ten.khoa.get(aj.courseId) ?? "đã chọn") : "(chưa chọn)"}${dueDays > 0 ? ` · hạn ${dueDays} ngày` : ""}`;
  if (action === "GIAO_LO_TRINH") return `Giao trọn lộ trình ${aj.pathId ? (ten.loTrinh.get(aj.pathId) ?? "đã chọn") : "(chưa chọn)"}${dueDays > 0 ? ` · hạn ${dueDays} ngày` : ""}`;
  if (action === "GUI_NHAC") return `Gửi nhắc: ${aj.tieuDe ?? "(chưa có tiêu đề)"}`;
  return action;
}
