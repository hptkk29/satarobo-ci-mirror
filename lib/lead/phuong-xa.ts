import { getWardsByProvince, provinces } from "vietnam-address-data";

/**
 * Danh mục tỉnh/thành và phường/xã cho màn «Chia theo phường» (và, sau này, biểu mẫu thu địa chỉ). Nguồn DUY NHẤT là gói
 * `vietnam-address-data` (mô hình 2 cấp, hiệu lực 01/07/2025) — xem `lib/address/vn-address.ts`: đừng chép danh mục vào đây.
 *
 * Phiếu lead lưu TÊN (không lưu mã), nên mọi thứ trả ra ở đây là TÊN đúng như gói ghi («Tp Đà Nẵng», «Phường Hải Châu»).
 */

/** Thành phố hiện chọn sẵn (chủ dự án 05/11/2026: «tp thì chọn sẵn tp Đà Nẵng»). */
export const TP_MAC_DINH = "Tp Đà Nẵng";

const sapXep = (a: string, b: string) => a.localeCompare(b, "vi");

export function danhSachTinh(): { id: string; name: string }[] {
  return provinces.map((p) => ({ id: p.id, name: p.name })).sort((a, b) => sapXep(a.name, b.name));
}

/** Tên tỉnh → mã; không thấy ⇒ null. So khớp CHÍNH XÁC tên trong gói (người gọi lấy tên từ chính `danhSachTinh`). */
export function idTinhTheoTen(ten: string): string | null {
  return provinces.find((p) => p.name === ten)?.id ?? null;
}

/** Tên các phường/xã của một tỉnh (theo mã), sắp theo bảng chữ cái tiếng Việt. Mã lạ ⇒ rỗng. */
export function danhSachPhuongCuaTinh(tinhId: string): string[] {
  return getWardsByProvince(tinhId)
    .map((w) => w.name)
    .sort(sapXep);
}
