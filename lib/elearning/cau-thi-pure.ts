// Hiển thị câu thi — phần THUẦN. Không import React/DB.

/** Câu Đúng/Sai hiển thị bằng hai nút LỚN cạnh nhau (hợp lớp 1–3): đúng loại `TRUE_FALSE` VÀ đúng 2 lựa chọn (hỏng dữ liệu ⇒ về danh sách thường). */
export function laDungSai(type: string, soLuaChon: number): boolean {
  return type === "TRUE_FALSE" && soLuaChon === 2;
}

/**
 * Dấu ✓/✕ theo NHÃN, không theo vị trí: lựa chọn được TRỘN TẤT ĐỊNH theo lượt thi nên "nút bên trái" có thể là "Sai". Nhãn lạ ⇒ không dấu
 * (không đoán).
 */
export function dauDungSai(nhan: string): "✓" | "✕" | "" {
  if (/^\s*đúng/i.test(nhan)) return "✓";
  if (/^\s*sai/i.test(nhan)) return "✕";
  return "";
}
