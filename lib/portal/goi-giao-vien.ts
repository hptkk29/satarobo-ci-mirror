// lib/portal/goi-giao-vien.ts — Cổng phụ huynh gọi giáo viên bằng «thầy/cô + TÊN» (13/11/2026). THUẦN.
//
// Chủ dự án: «nhắn Hoàng Phan Tuấn Kiệt thì sửa thành nhắn tin cho thầy Kiệt … để tên là thầy Kiệt thôi chứ không để cả họ và tên».
// Người Việt gọi thầy cô bằng TÊN (tiếng cuối), không bằng cả họ tên.
//
// Danh xưng theo `Employee.gender` (đo prod 13/11: 10/10 giáo viên đang có lớp đã khai — 5 nam, 5 nữ).
// Chưa khai thì đoán theo tên đệm chắc chắn nhất của tiếng Việt («Thị» ⇒ cô, «Văn» ⇒ thầy); không đoán được ⇒ «thầy/cô» (không bịa giới tính).
export type GioiTinhGv = "MALE" | "FEMALE" | "OTHER" | null | undefined;

const tach = (ten: string | null | undefined): string[] => (ten ?? "").trim().split(/\s+/).filter(Boolean);

export function danhXungGv(ten: string | null | undefined, gioiTinh: GioiTinhGv): "thầy" | "cô" | "thầy/cô" {
  if (gioiTinh === "MALE") return "thầy";
  if (gioiTinh === "FEMALE") return "cô";
  const dem = tach(ten).slice(0, -1).map((t) => t.toLocaleLowerCase("vi"));
  if (dem.includes("thị")) return "cô";
  if (dem.includes("văn")) return "thầy";
  return "thầy/cô";
}

/** `thầy Kiệt` (chữ thường đầu câu — ghép vào giữa câu: «Nhắn tin cho thầy Kiệt»). Tên rỗng ⇒ `null`. */
export function goiGiaoVien(ten: string | null | undefined, gioiTinh: GioiTinhGv): string | null {
  const t = tach(ten);
  if (t.length === 0) return null;
  return `${danhXungGv(ten, gioiTinh)} ${t[t.length - 1]}`;
}

/** Viết hoa chữ đầu — khi cụm đứng đầu câu/nhãn: «Thầy Kiệt». */
export const vietHoaDau = (s: string): string => (s ? s.charAt(0).toLocaleUpperCase("vi") + s.slice(1) : s);
