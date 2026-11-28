/**
 * OD-16 — góp ý từ app dùng thang 0–10 (`ParentFeedback.npsScore`). Cột `rating` cũ (NOT NULL, 1–5) vẫn được màn admin đọc nên máy chủ ghi kèm mức QUY ĐỔI:
 * ceil(điểm/2) kẹp 1–5 ⇒ 0–2→1 · 3–4→2 · 5–6→3 · 7–8→4 · 9–10→5. Một hàm duy nhất — app KHÔNG tự quy đổi (không có hai thang không giải thích).
 */
export const DIEM_GOP_Y_MIN = 0;
export const DIEM_GOP_Y_MAX = 10;

export function quyDoiSaoTuDiem(diem: number): number {
  if (!Number.isInteger(diem) || diem < DIEM_GOP_Y_MIN || diem > DIEM_GOP_Y_MAX) throw new RangeError("Điểm góp ý phải là số nguyên 0–10");
  return Math.min(5, Math.max(1, Math.ceil(diem / 2)));
}
