// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/report/chon-ban.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * CHỌN BẢN ĐỂ PHÂN TÍCH (28.3) — hàm thuần.
 *
 * 🔴 SỬA MỘT LỖ HỔNG. Bản cũ lấy `bai[0]` (mới nhất) rồi nếu bản đó KHÔNG hợp lệ thì coi như
 * người ấy chưa có hồ sơ — dù ngay bên dưới còn một bản hợp lệ cũ hơn dùng được. Một lần bấm
 * bừa gần đây xoá người đó khỏi cả bản phân tích. Nay: bản HỢP LỆ mới nhất.
 *
 * 🔴 MẶC ĐỊNH LÀ BẢN MỚI NHẤT, BẤT KỂ LOẠI — đúng lời chủ dự án ("ưu tiên lấy bản mới hơn để
 * phân tích"). Một bé từ lớp 3 có bản bé tự làm và bản bố mẹ làm cho bé; phân tích cả nhà cần
 * MỘT bộ điểm cho mỗi người và lấy bản nào hợp lệ mới nhất. Muốn dùng bản khác thì đổi ở ô chọn
 * bản. (Từng có một phiên bản ưu tiên góc nhìn tự làm — bị gỡ vì nó đổi hành vi NGOÀI kế hoạch;
 * nếu muốn quay lại thì phải được chủ dự án duyệt riêng.) Hai góc nhìn được so ở màn đối chiếu.
 */

import type { MaBoDe } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";
import { loaiCuaBoDe } from "@/lib/disc/engine-goc/modules/core/gia-dinh/han-muc";

type BaiChon = {
  readonly id: string;
  readonly boDe: MaBoDe;
  readonly ketThuc: string;
  readonly ketQua: { readonly hopLe: boolean };
};

const moiTruoc = <T extends BaiChon>(ds: readonly T[]): T[] =>
  [...ds].sort((a, b) => b.ketThuc.localeCompare(a.ketThuc) || a.id.localeCompare(b.id));

/** Bản mặc định để phân tích: HỢP LỆ MỚI NHẤT, bất kể loại. `null` nếu không có bản hợp lệ. */
export function banUuTien<T extends BaiChon>(ds: readonly T[]): T | null {
  return moiTruoc(ds).find((b) => b.ketQua.hopLe) ?? null;
}

export type NhanBan = "moi-nhat" | "ban-cu" | "khong-dung-duoc";

/** Nhãn cho từng bản trong ô chọn: mới nhất CỦA LOẠI ĐÓ, bản cũ, hay không dùng được. */
export function nhanCuaBan<T extends BaiChon>(ds: readonly T[], b: T): NhanBan {
  if (!b.ketQua.hopLe) return "khong-dung-duoc";
  const cungLoai = moiTruoc(ds).filter(
    (x) => x.ketQua.hopLe && loaiCuaBoDe(x.boDe) === loaiCuaBoDe(b.boDe),
  );
  return cungLoai[0]?.id === b.id ? "moi-nhat" : "ban-cu";
}
