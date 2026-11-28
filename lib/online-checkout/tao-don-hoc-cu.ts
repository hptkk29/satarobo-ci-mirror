import type { Prisma, PrismaClient } from "@prisma/client";

import { giuKho, type ThieuHang } from "@/lib/inventory/giu-kho";

import { soLuongToiDaCuaSanPham } from "./danh-muc-hoc-cu";
import { diaChiMotDong, tinhPhiGiao, type DiaChiGiaoHang } from "./giao-hang";

/**
 * V8.43 — PHẦN HỌC CỤ của ĐẶT HÀNG HỖN HỢP (Commerce v2 · P0). Tách khỏi `tao-don.ts` để lõi đặt hàng khoá Online chỉ nhận thêm HAI lời gọi:
 *   · `chotHocCu` (BƯỚC ĐỌC, không ghi): sản phẩm bán Online ∧ đang bán, số lượng ≤ trần, GIÁ do MÁY CHỦ đọc, phí giao + địa chỉ do cấu hình + địa chỉ phụ huynh;
 *   · `ghiHocCu` (TRONG giao dịch tạo đơn): dòng đơn + fulfillment `AWAITING_PAYMENT` + GIỮ KHO cả đơn — thiếu hàng ⇒ ném `LoiHetHang` ⇒ cả đơn rollback (không đơn nửa vời, không giữ kho dở).
 * Client không gửi giá/phí; giá đọc lại trong giao dịch và lệch ⇒ `LoiGiaDoi` (đơn không tạo). Offline không có đường vào: chỉ `Product` bán Online mới qua được.
 */
type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export type HocCuDat = { cartItemId: string; productId: string; soLuong: number };
export type DongHocCuChot = { cartItemId: string; productId: string; sku: string; ten: string; soLuong: number; donGia: number };
export type DongHocCuDon = { orderItemId: string; productId: string; sku: string; ten: string; soLuong: number; donGia: number; thanhTien: number };
export type MaLoiHocCu = "SAN_PHAM_KHONG_TON_TAI" | "KHONG_BAN_ONLINE" | "SO_LUONG_VUOT_TOI_DA" | "HET_HANG" | "GIA_DA_DOI" | "THIEU_DIA_CHI" | "CHUA_CHON_PHUONG_THUC_GIAO" | "PHUONG_THUC_GIAO_KHONG_HOP_LE";
export type LoiHocCu = { ok: false; ma: MaLoiHocCu; thongBao: string; thieu?: ThieuHang[]; cartItemIds?: string[] };
export type ChotHocCu = { ok: true; dong: DongHocCuChot[]; tienHang: number; giao: { phuongThuc: string; phi: number; diaChi: DiaChiGiaoHang } } | LoiHocCu;

export class LoiHetHang extends Error {
  constructor(public readonly thieu: ThieuHang[]) {
    super("HET_HANG");
  }
}
export class LoiGiaDoi extends Error {
  constructor(public readonly productIds: string[]) {
    super("GIA_DA_DOI");
  }
}

/** THUẦN. Chữ ký bộ học cụ của một đơn (sắp theo sản phẩm) — dùng so «cùng giỏ» khi bấm đúp/thử lại. */
export const chuKyHocCu = (dong: ReadonlyArray<{ productId: string; soLuong: number }>): string =>
  [...dong].sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0)).map((d) => `${d.productId}:${d.soLuong}`).join(",");

/** BƯỚC ĐỌC. Không ghi gì. `tamTinhKhoa` = tạm tính các dòng khoá (trước giảm) để ngưỡng miễn phí giao hàng tính trên TỔNG hàng như ở giỏ. */
export async function chotHocCu(db: Db, input: { parentUserId: string; dong: readonly HocCuDat[]; phuongThuc: string | null; tamTinhKhoa: number }): Promise<ChotHocCu> {
  const ids = [...new Set(input.dong.map((d) => d.productId))];
  const sp = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, name: true, status: true, sellOnline: true, salePrice: true, onlineMaxQty: true } });
  const theoId = new Map(sp.map((p) => [p.id, p]));
  const dong: DongHocCuChot[] = [];
  for (const d of input.dong) {
    const p = theoId.get(d.productId);
    if (!p) return { ok: false, ma: "SAN_PHAM_KHONG_TON_TAI", thongBao: "Sản phẩm không tồn tại", cartItemIds: [d.cartItemId] };
    if (!p.sellOnline || p.status !== "ACTIVE") return { ok: false, ma: "KHONG_BAN_ONLINE", thongBao: `Sản phẩm "${p.name}" hiện không bán Online`, cartItemIds: [d.cartItemId] };
    const toiDa = soLuongToiDaCuaSanPham(p.onlineMaxQty);
    if (!Number.isInteger(d.soLuong) || d.soLuong < 1 || d.soLuong > toiDa) return { ok: false, ma: "SO_LUONG_VUOT_TOI_DA", thongBao: `Sản phẩm "${p.name}": tối đa ${toiDa} cho mỗi dòng`, cartItemIds: [d.cartItemId] };
    if (!Number.isInteger(p.salePrice) || p.salePrice <= 0) return { ok: false, ma: "KHONG_BAN_ONLINE", thongBao: `Sản phẩm "${p.name}" chưa có giá bán hợp lệ`, cartItemIds: [d.cartItemId] };
    dong.push({ cartItemId: d.cartItemId, productId: p.id, sku: p.sku, ten: p.name, soLuong: d.soLuong, donGia: p.salePrice });
  }
  const tienHang = dong.reduce((s, d) => s + d.donGia * d.soLuong, 0);
  const phi = await tinhPhiGiao(db, { parentUserId: input.parentUserId, phuongThuc: input.phuongThuc, tamTinhHang: input.tamTinhKhoa + tienHang });
  if (!phi.ok) return { ok: false, ma: phi.ma, thongBao: phi.thongBao };
  const a = await db.parentShippingAddress.findUniqueOrThrow({ where: { parentUserId: input.parentUserId }, select: { hoTen: true, soDienThoai: true, tinhThanh: true, phuongXa: true, soNhaDuong: true } });
  return { ok: true, dong, tienHang, giao: { phuongThuc: phi.phuongThuc, phi: phi.phi, diaChi: a } };
}

/** Ảnh chụp giao hàng ghi vào `Order.shippingAddress` (bất biến — đổi địa chỉ/cấu hình về sau không đổi đơn cũ). */
export const chupGiaoHang = (g: { phuongThuc: string; phi: number; diaChi: DiaChiGiaoHang }): Prisma.InputJsonValue => ({ phuongThuc: g.phuongThuc, phi: g.phi, ...g.diaChi, diaChiMotDong: diaChiMotDong(g.diaChi) });

/**
 * TRONG giao dịch tạo đơn (đơn đã có `orderId`). Tạo dòng PRODUCT + fulfillment AWAITING_PAYMENT, rồi GIỮ KHO cả đơn.
 * Từ chối SAU khi đã ghi ⇒ `throw` (rollback — luật `return` không rollback): `LoiGiaDoi` (giá lệch giữa lúc chốt và lúc ghi), `LoiHetHang` (thiếu tồn).
 */
export async function ghiHocCu(tx: Tx, input: { orderId: string; dong: readonly DongHocCuChot[]; now: Date; ttlPhut: number }): Promise<{ dong: DongHocCuDon[]; hanGiuLuc: Date }> {
  const gia = await tx.product.findMany({ where: { id: { in: [...new Set(input.dong.map((d) => d.productId))] } }, select: { id: true, salePrice: true } });
  const giaHienTai = new Map(gia.map((g) => [g.id, g.salePrice]));
  const lech = input.dong.filter((d) => giaHienTai.get(d.productId) !== d.donGia).map((d) => d.productId);
  if (lech.length > 0) throw new LoiGiaDoi(lech);

  const ketQua: DongHocCuDon[] = [];
  for (const d of input.dong) {
    const it = await tx.orderItem.create({
      data: {
        orderId: input.orderId,
        type: "PRODUCT",
        productId: d.productId,
        itemName: d.ten,
        itemDescription: `SKU: ${d.sku}`,
        quantity: d.soLuong,
        unitPrice: d.donGia,
        totalPrice: d.donGia * d.soLuong,
        discountAmount: 0,
        metadata: { kenh: "ONLINE", loai: "HOC_CU", sku: d.sku } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await tx.orderItemFulfillment.create({ data: { orderItemId: it.id, status: "AWAITING_PAYMENT" } });
    ketQua.push({ orderItemId: it.id, productId: d.productId, sku: d.sku, ten: d.ten, soLuong: d.soLuong, donGia: d.donGia, thanhTien: d.donGia * d.soLuong });
  }
  const g = await giuKho(tx, { dong: ketQua.map((k) => ({ orderItemId: k.orderItemId, productId: k.productId, soLuong: k.soLuong })), now: input.now, ttlPhut: input.ttlPhut });
  if (!g.ok) {
    if (g.ma === "HET_HANG") throw new LoiHetHang(g.thieu ?? []);
    throw new Error(`GIU_KHO_${g.ma}`); // KHONG_BAN_ONLINE/KHONG_TIM_THAY… không thể xảy ra sau `chotHocCu`; nếu có ⇒ rollback
  }
  return { dong: ketQua, hanGiuLuc: g.hanGiuLuc };
}
