import type { PrismaClient } from "@prisma/client";

import { tinhKhaDung, tongDangGiu } from "@/lib/inventory/giu-kho";

import { soLuongToiDaCuaSanPham, tonKhoHienThi, type TonKhoDto } from "./danh-muc-hoc-cu";

/**
 * V8.42 — DÒNG HỌC CỤ (PHYSICAL_GOOD) TRONG GIỎ HÀNG ĐÃ LƯU (Commerce v2 · P0-A). Giỏ KHÔNG hết hạn; giữ kho chỉ xảy ra ở bước đặt hàng.
 *   · giá = `Product.salePrice` do MÁY CHỦ; `CartItem.donGiaLucThem` chỉ để báo «giá đã đổi»; client không gửi giá;
 *   · số lượng hiệu lực = min(số lượng đã chọn, trần của sản phẩm, tồn khả dụng) — bị kẹp ⇒ `DA_GIAM_SO_LUONG` (vẫn là dòng HỢP LỆ); hết hàng ⇒ `HET_HANG` (cần xử lý);
 *   · sản phẩm không còn bán Online ⇒ `KHONG_BAN_ONLINE` (cần xử lý); bị NGỪNG KINH DOANH/không còn tồn tại ⇒ ứng viên bị GỠ khỏi giỏ kèm thông báo (xem `gio-hang-luu`).
 * Thuần: `xetSoLuong`, `laDongHopLe`. Đọc DB: `xetDongHocCu`. Ghi: `themDongHocCu` (qua `gio-hang-luu` để dùng chung khoá/revision).
 */
type Db = PrismaClient;

export type TrangThaiHocCu = "SAN_SANG" | "DA_GIAM_SO_LUONG" | "HET_HANG" | "KHONG_BAN_ONLINE";
export type LyDoHocCu = "HET_HANG" | "SAN_PHAM_NGUNG_BAN" | null;

export type DongHocCuDto = {
  itemId: string;
  loai: "HOC_CU";
  productId: string;
  sku: string | null;
  ten: string | null;
  anh: string | null;
  nhomBienThe: string | null;
  donGia: number;
  soLuong: number;
  soLuongToiDa: number;
  thanhTien: number;
  /** giá lúc thêm ≠ giá hiện tại — CHỈ để cảnh báo; dòng vẫn hợp lệ */
  giaDaDoi: boolean;
  donGiaLucThem: number | null;
  tonKho: TonKhoDto;
  daDangKyBaoCoHang: boolean;
  trangThai: TrangThaiHocCu;
  lyDo: LyDoHocCu;
};

/** THUẦN. Dòng được tính vào tạm tính/tổng/đặt hàng. */
export const laDongHopLe = (t: string): boolean => t === "SAN_SANG" || t === "DA_GIAM_SO_LUONG";

/** THUẦN. Số lượng hiệu lực + trạng thái từ số lượng đã chọn, trần sản phẩm và tồn khả dụng. */
export function xetSoLuong(input: { soLuongLuu: number; khaDung: number; toiDa: number }): { soLuong: number; trangThai: "SAN_SANG" | "DA_GIAM_SO_LUONG" | "HET_HANG" } {
  if (input.khaDung <= 0) return { soLuong: input.soLuongLuu, trangThai: "HET_HANG" };
  const hieuLuc = Math.min(input.soLuongLuu, input.toiDa, input.khaDung);
  return { soLuong: hieuLuc, trangThai: hieuLuc < input.soLuongLuu ? "DA_GIAM_SO_LUONG" : "SAN_SANG" };
}

export type DongHocCuDb = { id: string; productId: string | null; quantity: number; donGiaLucThem: number | null };

/**
 * Xét các dòng học cụ của một giỏ bằng trạng thái SỐNG của kho. KẸP THEO KHO LÀ PHÉP TÍNH KHÔNG LƯU: số lượng đã chọn được GIỮ NGUYÊN trong DB; mỗi lần xem tính lại
 * số lượng hiệu lực (kho hồi thì số lượng quay về ý định ban đầu) và `DA_GIAM_SO_LUONG` tồn tại chừng nào còn bị kẹp. Trả thêm `canGo` (dòng phải GỠ khỏi giỏ:
 * sản phẩm không còn tồn tại / đã ngừng kinh doanh) — người gọi quyết định có ghi hay không.
 */
export async function xetDongHocCu(db: Db, input: { rows: readonly DongHocCuDb[]; parentUserId: string; now: Date }): Promise<{ dong: DongHocCuDto[]; canGo: Array<{ itemId: string; ten: string; lyDo: "SAN_PHAM_NGUNG_BAN" }> }> {
  const ids = [...new Set(input.rows.map((r) => r.productId).filter((x): x is string => !!x))];
  const [sp, giu, dk] = await Promise.all([
    ids.length ? db.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, name: true, status: true, sellOnline: true, salePrice: true, stockOnHand: true, imageUrls: true, onlineVariantLabel: true, onlineMaxQty: true } }) : [],
    tongDangGiu(db, ids, input.now),
    ids.length ? db.productRestockSubscription.findMany({ where: { parentUserId: input.parentUserId, productId: { in: ids } }, select: { productId: true } }) : [],
  ]);
  const theoId = new Map(sp.map((p) => [p.id, p]));
  const dangKy = new Set(dk.map((x) => x.productId));
  const dong: DongHocCuDto[] = [];
  const canGo: Array<{ itemId: string; ten: string; lyDo: "SAN_PHAM_NGUNG_BAN" }> = [];
  for (const r of input.rows) {
    const p = r.productId ? theoId.get(r.productId) : undefined;
    if (!p || p.status === "DISCONTINUED") {
      canGo.push({ itemId: r.id, ten: p?.name ?? "Sản phẩm đã ngừng bán", lyDo: "SAN_PHAM_NGUNG_BAN" });
      continue;
    }
    const khaDung = tinhKhaDung(p.stockOnHand, giu.get(p.id) ?? 0);
    const toiDa = soLuongToiDaCuaSanPham(p.onlineMaxQty);
    const base = { itemId: r.id, loai: "HOC_CU" as const, productId: p.id, sku: p.sku, ten: p.name, anh: p.imageUrls[0] ?? null, nhomBienThe: p.onlineVariantLabel, donGia: p.salePrice, soLuongToiDa: toiDa, giaDaDoi: r.donGiaLucThem !== null && r.donGiaLucThem !== p.salePrice, donGiaLucThem: r.donGiaLucThem, tonKho: tonKhoHienThi(khaDung), daDangKyBaoCoHang: dangKy.has(p.id) };
    if (!p.sellOnline || p.status !== "ACTIVE") {
      dong.push({ ...base, soLuong: r.quantity, thanhTien: 0, trangThai: "KHONG_BAN_ONLINE", lyDo: "SAN_PHAM_NGUNG_BAN" });
      continue;
    }
    const x = xetSoLuong({ soLuongLuu: r.quantity, khaDung, toiDa });
    dong.push({ ...base, soLuong: x.soLuong, thanhTien: x.trangThai === "HET_HANG" ? 0 : p.salePrice * x.soLuong, trangThai: x.trangThai, lyDo: x.trangThai === "HET_HANG" ? "HET_HANG" : null });
  }
  return { dong, canGo };
}
