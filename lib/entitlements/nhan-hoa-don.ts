// lib/entitlements/nhan-hoa-don.ts — NHÃN PHẠM VI cho hoá đơn và cổng phụ huynh (QĐ-52, QĐ-54). THUẦN.
//
// Hoá đơn có phạm vi: "Học phí Sata4 – 24 buổi (bài 13–36)". Phạm vi chỉ có SAU khi xếp lớp (lớp chọn
// SAU khi tiền về), nên chưa chốt phạm vi thì nhãn KHÔNG ghi bài — ghi bài đoán là in một con số có thể sai
// ra giấy tờ. Chưa nối vào hoá đơn nào: cờ `invoiceScopeLabelEnabled` (nếu có) thuộc đợt nối.

export interface DauVaoNhanHoaDon {
  /** Tên khoá, ví dụ "Sata4". Rỗng/khoảng trắng ⇒ không dựng được nhãn. */
  readonly tenKhoa: string;
  readonly soBuoi: number;
  readonly start?: number | null;
  readonly end?: number | null;
}

const nguyenDuong = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 1;

/** `null` khi đầu vào không đủ để dựng một nhãn đúng. */
export function nhanHoaDon(vao: DauVaoNhanHoaDon): string | null {
  const ten = vao.tenKhoa.trim();
  if (!ten || !nguyenDuong(vao.soBuoi)) return null;
  const co = nguyenDuong(vao.start) && nguyenDuong(vao.end);
  if (co && vao.end! - vao.start! + 1 !== vao.soBuoi) return null; // phạm vi không khớp số buổi: đừng in
  const goc = `Học phí ${ten} – ${vao.soBuoi} buổi`;
  return co ? `${goc} (bài ${vao.start}–${vao.end})` : goc;
}

/** "Bài 13–36" cho cổng phụ huynh. */
export function nhanPhamVi(start: number, end: number): string {
  return start === end ? `Bài ${start}` : `Bài ${start}–${end}`;
}

/** Dòng tóm tắt tiến độ trong quyền học: "9/24 buổi (bài 13–36)". */
export function nhanTienDo(daHoc: number, soMua: number, start?: number | null, end?: number | null): string {
  const co = nguyenDuong(start) && nguyenDuong(end);
  return `${daHoc}/${soMua} buổi${co ? ` (${nhanPhamVi(start, end).toLowerCase()})` : ""}`;
}
