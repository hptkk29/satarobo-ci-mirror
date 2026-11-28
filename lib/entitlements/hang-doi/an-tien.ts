// lib/entitlements/hang-doi/an-tien.ts — CHE SỐ TIỀN TRONG CÂU CHỮ. THUẦN.
//
// `entitlements:view-money` quyết định có thấy số tiền không. Số tiền không chỉ nằm ở cột `netAmount`: các câu `lyDo` do máy sinh
// ("... còn thiếu 5000000đ") cũng mang số. Che cột mà quên câu chữ là rò rỉ — nên MỌI chuỗi hiển thị cho vai thiếu quyền đều đi qua đây.
// Số tiền trong mọi câu chữ của hàng đợi LUÔN kết thúc bằng "đ" (lưới `[HD-AT-*]` ghim hình dạng đó cho các câu do máy sinh).

const SO_TIEN = /\d[\d.,]*\s?đ/g;

export const CHE_SO_TIEN = "▒▒đ";

export function anSoTienTrongChu(s: string): string {
  return s.replace(SO_TIEN, CHE_SO_TIEN);
}

export function anSoTienNeuThieuQuyen<T extends string | null | undefined>(s: T, coXemTien: boolean): T {
  if (coXemTien || typeof s !== "string") return s;
  return anSoTienTrongChu(s) as T;
}
