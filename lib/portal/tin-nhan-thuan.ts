// Cổng phụ huynh — phần THUẦN của danh sách "Nhắn cô thầy" (artifact Tin-nhan.dc.html).

export const NHAN_LOAI_HOI_THOAI: Record<string, string> = {
  CLASS_GROUP: "Nhóm lớp",
  DM_TEACHER_PARENT: "Giáo viên",
  DM_SALE_PARENT: "Tư vấn viên",
  DM_STAFF: "Nhân viên trung tâm",
};

export const vaiTroHoiThoai = (type: string): string => NHAN_LOAI_HOI_THOAI[type] ?? "Hội thoại";

/** Chữ trong ô tròn: nhóm lớp lấy số cuối của tên (`CS1.SATA3.01` → `01`), nhắn riêng lấy chữ cái đầu của tối đa 2 từ cuối. */
export function chuVietTat(type: string, ten: string): string {
  if (type === "CLASS_GROUP") return (/(\d{1,3})\D*$/.exec(ten)?.[1] ?? "L").slice(-3);
  const tu = ten.trim().split(/\s+/).filter(Boolean);
  const dau = tu.slice(-2).map((t) => t[0] ?? "").join("");
  return (dau || "?").toUpperCase();
}
