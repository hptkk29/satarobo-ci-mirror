import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * V8.42 — GIỮ KHO HÀNG ONLINE (Commerce v2 · P0-B). Phân biệt rõ:
 *   · GIỎ HÀNG không hết hạn (Owner chốt) — module này KHÔNG đụng giỏ;
 *   · GIỮ KHO của một ĐƠN đang chờ thanh toán thì CÓ HẠN (mặc định đề xuất 15 phút, cấu hình `inventory.onlineReservationMinutes`).
 *
 * Mô hình: `Product.stockOnHand` (thực tế trong kho, chỉ đổi khi BÁN/TRẢ/ĐIỀU CHỈNH) và `ProductReservation` (phần đang giữ).
 *     khaDung = stockOnHand − Σ quantity(status = ACTIVE ∧ expiresAt > now)
 * Hết hạn là MỘT VỊ TỪ (`expiresAt > now`), không phải việc của worker ⇒ worker `quetHetHan` chỉ dọn trạng thái, chạy trùng vô hại.
 *
 * AN TOÀN ĐUA (không oversell): mọi thay đổi đi qua `SELECT … FOR UPDATE` trên hàng `Product`, KHOÁ THEO THỨ TỰ id TĂNG DẦN
 * (đơn nhiều sản phẩm × nhiều giao dịch đồng thời mà khoá lộn thứ tự là deadlock). Hàm nhận `tx` của NGƯỜI GỌI — người gọi quyết định giao dịch.
 * `now` BẮT BUỘC (luật 19 — không đọc đồng hồ thật). Từ chối = TRẢ `{ ok:false }` TRƯỚC phép ghi đầu tiên; buộc bỏ sau khi đã ghi thì `throw` (luật 7).
 *
 * KHÔNG ghi `ProductMovement` khi chỉ giữ/nhả (đó là sổ ĐẶT CHỖ — chính bảng `ProductReservation` là sổ); `ProductMovement` chỉ ghi khi tồn thực đổi:
 * SALE (khi tiêu thụ giữ kho, tức thanh toán đã xác nhận) và RETURN (khi nhận hàng trả).
 */
type Tx = Prisma.TransactionClient;
type Db = PrismaClient;

export const SO_LUONG_TOI_DA_MOT_DONG = 1000;
export const PHUT_GIU_TOI_THIEU = 1;
export const PHUT_GIU_TOI_DA = 1440;

/** THUẦN. Còn khả dụng = tồn thực − đang giữ, không bao giờ âm. */
export function tinhKhaDung(tonThuc: number, dangGiu: number): number {
  return Math.max(0, tonThuc - dangGiu);
}

export type MaLoiKho = "VALIDATION" | "KHONG_TIM_THAY" | "KHONG_BAN_ONLINE" | "HET_HANG" | "DA_XU_LY" | "KHONG_CO_GIU_KHO";
export type DongGiuKho = { orderItemId: string; productId: string; soLuong: number };
export type ThieuHang = { productId: string; yeuCau: number; conLai: number };
export type KetQuaGiu = { ok: true; hanGiuLuc: Date } | { ok: false; ma: MaLoiKho; thongBao: string; thieu?: ThieuHang[] };

const loi = (ma: MaLoiKho, thongBao: string, thieu?: ThieuHang[]): { ok: false; ma: MaLoiKho; thongBao: string; thieu?: ThieuHang[] } => ({ ok: false, ma, thongBao, ...(thieu ? { thieu } : {}) });

/** Khoá hàng Product theo thứ tự id tăng dần; trả tồn thực + cờ bán Online. Id không có ⇒ không nằm trong kết quả. */
async function khoaSanPham(tx: Tx, ids: readonly string[]): Promise<Map<string, { stockOnHand: number; sellOnline: boolean; status: string }>> {
  const sap = [...new Set(ids)].sort();
  if (sap.length === 0) return new Map();
  const rows = await tx.$queryRaw<Array<{ id: string; stockOnHand: number; sellOnline: boolean; status: string }>>(
    Prisma.sql`SELECT "id", "stockOnHand", "sellOnline", "status"::text AS "status" FROM "Product" WHERE "id" IN (${Prisma.join(sap)}) ORDER BY "id" FOR UPDATE`,
  );
  return new Map(rows.map((r) => [r.id, { stockOnHand: Number(r.stockOnHand), sellOnline: r.sellOnline, status: r.status }]));
}

/** Σ số lượng đang giữ HIỆU LỰC theo sản phẩm (ACTIVE ∧ chưa hết hạn), loại trừ các dòng đơn cho trước (để giữ lại cùng dòng không bị tính hai lần). */
export async function tongDangGiu(tx: Tx, productIds: readonly string[], now: Date, boQuaOrderItemIds: readonly string[] = []): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const g = await tx.productReservation.groupBy({
    by: ["productId"],
    where: { productId: { in: [...new Set(productIds)] }, status: "ACTIVE", expiresAt: { gt: now }, ...(boQuaOrderItemIds.length ? { orderItemId: { notIn: [...boQuaOrderItemIds] } } : {}) },
    _sum: { quantity: true },
  });
  return new Map(g.map((x) => [x.productId, x._sum.quantity ?? 0]));
}

/**
 * GIỮ KHO cho các dòng của MỘT đơn (gọi TRONG giao dịch tạo đơn, TRƯỚC khi ghi gì khác nếu muốn từ chối sạch).
 * Idempotent theo `orderItemId`: gọi lại cho dòng đang giữ còn hạn ⇒ trả đúng hạn cũ, không giữ thêm.
 * Cả đơn hoặc không gì cả: thiếu một sản phẩm ⇒ `HET_HANG` kèm danh sách, KHÔNG ghi gì.
 */
export async function giuKho(tx: Tx, input: { dong: readonly DongGiuKho[]; now: Date; ttlPhut: number }): Promise<KetQuaGiu> {
  const { dong, now, ttlPhut } = input;
  if (!Number.isInteger(ttlPhut) || ttlPhut < PHUT_GIU_TOI_THIEU || ttlPhut > PHUT_GIU_TOI_DA) return loi("VALIDATION", "Số phút giữ kho không hợp lệ");
  if (dong.length === 0) return loi("VALIDATION", "Không có dòng nào để giữ kho");
  if (new Set(dong.map((d) => d.orderItemId)).size !== dong.length) return loi("VALIDATION", "Trùng dòng đơn");
  for (const d of dong) if (!Number.isInteger(d.soLuong) || d.soLuong < 1 || d.soLuong > SO_LUONG_TOI_DA_MOT_DONG) return loi("VALIDATION", "Số lượng không hợp lệ");

  const sp = await khoaSanPham(tx, dong.map((d) => d.productId));
  for (const d of dong) {
    const p = sp.get(d.productId);
    if (!p) return loi("KHONG_TIM_THAY", "Không tìm thấy sản phẩm");
    if (!p.sellOnline || p.status !== "ACTIVE") return loi("KHONG_BAN_ONLINE", "Sản phẩm hiện không bán Online");
  }

  const cu = await tx.productReservation.findMany({ where: { orderItemId: { in: dong.map((d) => d.orderItemId) } }, select: { id: true, orderItemId: true, productId: true, quantity: true, status: true, expiresAt: true } });
  const cuTheoDong = new Map(cu.map((r) => [r.orderItemId, r]));
  for (const d of dong) {
    const r = cuTheoDong.get(d.orderItemId);
    if (r && (r.status === "CONSUMED" || r.status === "RETURNED")) return loi("DA_XU_LY", "Dòng này đã được bán");
    if (r && (r.productId !== d.productId || r.quantity !== d.soLuong) && r.status === "ACTIVE") return loi("VALIDATION", "Dòng đã giữ kho với thông tin khác");
  }
  // Mọi dòng đang giữ còn hạn, đúng sản phẩm/số lượng ⇒ idempotent
  if (dong.every((d) => { const r = cuTheoDong.get(d.orderItemId); return !!r && r.status === "ACTIVE" && r.expiresAt > now; })) {
    return { ok: true, hanGiuLuc: new Date(Math.min(...dong.map((d) => cuTheoDong.get(d.orderItemId)!.expiresAt.getTime()))) };
  }

  const cau = new Map<string, number>();
  for (const d of dong) cau.set(d.productId, (cau.get(d.productId) ?? 0) + d.soLuong);
  const dangGiu = await tongDangGiu(tx, [...cau.keys()], now, dong.map((d) => d.orderItemId));
  const thieu: ThieuHang[] = [];
  for (const [productId, yeuCau] of cau) {
    const conLai = tinhKhaDung(sp.get(productId)!.stockOnHand, dangGiu.get(productId) ?? 0);
    if (yeuCau > conLai) thieu.push({ productId, yeuCau, conLai });
  }
  if (thieu.length > 0) return loi("HET_HANG", "Không đủ hàng để giữ", thieu);

  const han = new Date(now.getTime() + ttlPhut * 60_000);
  for (const d of dong) {
    const r = cuTheoDong.get(d.orderItemId);
    if (r) {
      await tx.productReservation.update({ where: { id: r.id }, data: { productId: d.productId, quantity: d.soLuong, status: "ACTIVE", expiresAt: han, releasedAt: null, reason: null } });
    } else {
      await tx.productReservation.create({ data: { productId: d.productId, orderItemId: d.orderItemId, quantity: d.soLuong, expiresAt: han } });
    }
  }
  return { ok: true, hanGiuLuc: han };
}

/** NHẢ giữ kho (huỷ đơn / gỡ dòng). Chỉ chuyển ACTIVE → RELEASED; idempotent; không bao giờ chạm dòng đã bán. Trả số dòng thật sự được nhả. */
export async function nhaGiuKho(tx: Tx, input: { orderItemIds: readonly string[]; lyDo: string; now: Date }): Promise<number> {
  if (input.orderItemIds.length === 0) return 0;
  const r = await tx.productReservation.updateMany({ where: { orderItemId: { in: [...input.orderItemIds] }, status: "ACTIVE" }, data: { status: "RELEASED", releasedAt: input.now, reason: input.lyDo.slice(0, 200) } });
  return r.count;
}

export type KetQuaTieuThu =
  | { ok: true; daXong: boolean; muon: boolean }
  | { ok: false; ma: "KHONG_CO_GIU_KHO" | "HET_HANG"; thongBao: string; canXuLyTay?: boolean };

/**
 * TIÊU THỤ giữ kho = THANH TOÁN ĐÃ XÁC NHẬN ⇒ trừ `stockOnHand` + ghi `ProductMovement` SALE. Idempotent theo `orderItemId` (webhook lặp, retry, worker trùng).
 * Đến MUỘN (giữ kho đã hết hạn / đã nhả): kiểm lại khả năng đáp ứng — còn hàng ⇒ vẫn bán cho khách (`muon: true`); hết hàng ⇒ `HET_HANG` + `canXuLyTay`
 * và KHÔNG ghi gì (người gọi giữ tiền, chuyển nhân viên xử lý — KHÔNG được làm hỏng phép ghi tiền vì lỗi kho).
 */
export async function tieuThuGiuKho(tx: Tx, input: { orderItemId: string; now: Date; nguoi: { id: string | null; ten: string } }): Promise<KetQuaTieuThu> {
  const r0 = await tx.productReservation.findUnique({ where: { orderItemId: input.orderItemId }, select: { productId: true, orderItem: { select: { orderId: true, order: { select: { code: true } } } } } });
  if (!r0) return { ok: false, ma: "KHONG_CO_GIU_KHO", thongBao: "Dòng này không có giữ kho" };
  const sp = await khoaSanPham(tx, [r0.productId]);
  const p = sp.get(r0.productId);
  if (!p) return { ok: false, ma: "HET_HANG", thongBao: "Không tìm thấy sản phẩm", canXuLyTay: true };
  // Đọc LẠI dưới khoá (trạng thái có thể đổi giữa hai lệnh)
  const r = await tx.productReservation.findUniqueOrThrow({ where: { orderItemId: input.orderItemId }, select: { id: true, quantity: true, status: true, expiresAt: true } });
  if (r.status === "CONSUMED" || r.status === "RETURNED") return { ok: true, daXong: true, muon: false };

  const conHieuLuc = r.status === "ACTIVE" && r.expiresAt > input.now;
  if (conHieuLuc) {
    if (p.stockOnHand < r.quantity) return { ok: false, ma: "HET_HANG", thongBao: "Tồn kho thực không đủ (đã bị điều chỉnh sau khi giữ)", canXuLyTay: true };
  } else {
    const dangGiu = (await tongDangGiu(tx, [r0.productId], input.now, [input.orderItemId])).get(r0.productId) ?? 0;
    if (tinhKhaDung(p.stockOnHand, dangGiu) < r.quantity) return { ok: false, ma: "HET_HANG", thongBao: "Đã hết hạn giữ kho và hàng không còn đủ", canXuLyTay: true };
  }

  const chuyen = await tx.productReservation.updateMany({ where: { id: r.id, status: { in: ["ACTIVE", "EXPIRED", "RELEASED"] } }, data: { status: "CONSUMED", consumedAt: input.now, releasedAt: null } });
  if (chuyen.count === 0) return { ok: true, daXong: true, muon: false };
  const cap = await tx.product.update({ where: { id: r0.productId }, data: { stockOnHand: { decrement: r.quantity } }, select: { stockOnHand: true } });
  if (cap.stockOnHand < 0) throw new Error("PRODUCT_STOCK_NEGATIVE_AFTER_CONSUME"); // không thể xảy ra dưới khoá; nếu có ⇒ rollback toàn bộ
  await tx.productMovement.create({
    data: { productId: r0.productId, type: "SALE", quantity: -r.quantity, reason: `Bán Online theo đơn ${r0.orderItem.order.code}`, orderId: r0.orderItem.orderId, stockBeforeMovement: cap.stockOnHand + r.quantity, stockAfterMovement: cap.stockOnHand, createdByUserId: input.nguoi.id, createdByName: input.nguoi.ten },
  });
  return { ok: true, daXong: false, muon: !conHieuLuc };
}

/** NHẬN HÀNG TRẢ: chỉ CONSUMED → RETURNED (một lần), cộng lại `stockOnHand` + `ProductMovement` RETURN. Idempotent. */
export async function traKho(tx: Tx, input: { orderItemId: string; now: Date; nguoi: { id: string | null; ten: string }; lyDo: string }): Promise<{ ok: true; daTra: boolean } | { ok: false; ma: "KHONG_CO_GIU_KHO" | "DA_XU_LY"; thongBao: string }> {
  const r0 = await tx.productReservation.findUnique({ where: { orderItemId: input.orderItemId }, select: { productId: true, orderItem: { select: { orderId: true, order: { select: { code: true } } } } } });
  if (!r0) return { ok: false, ma: "KHONG_CO_GIU_KHO", thongBao: "Dòng này không có giữ kho" };
  await khoaSanPham(tx, [r0.productId]);
  const r = await tx.productReservation.findUniqueOrThrow({ where: { orderItemId: input.orderItemId }, select: { id: true, quantity: true, status: true } });
  if (r.status === "RETURNED") return { ok: true, daTra: false };
  if (r.status !== "CONSUMED") return { ok: false, ma: "DA_XU_LY", thongBao: "Dòng này chưa được bán nên không có gì để trả kho" };
  const chuyen = await tx.productReservation.updateMany({ where: { id: r.id, status: "CONSUMED" }, data: { status: "RETURNED", returnedAt: input.now, reason: input.lyDo.slice(0, 200) } });
  if (chuyen.count === 0) return { ok: true, daTra: false };
  const cap = await tx.product.update({ where: { id: r0.productId }, data: { stockOnHand: { increment: r.quantity } }, select: { stockOnHand: true } });
  await tx.productMovement.create({
    data: { productId: r0.productId, type: "RETURN", quantity: r.quantity, reason: `Nhận hàng trả đơn ${r0.orderItem.order.code} — ${input.lyDo.slice(0, 120)}`, orderId: r0.orderItem.orderId, stockBeforeMovement: cap.stockOnHand - r.quantity, stockAfterMovement: cap.stockOnHand, createdByUserId: input.nguoi.id, createdByName: input.nguoi.ten },
  });
  return { ok: true, daTra: true };
}

/**
 * WORKER dọn: ACTIVE ∧ expiresAt ≤ now ⇒ EXPIRED. KHÔNG xoá giỏ, KHÔNG xoá/huỷ đơn. Chạy trùng/song song vô hại (cập nhật có điều kiện, một câu lệnh).
 * Hết hạn đã được vị từ tính từ trước đó — việc này chỉ giữ cho bảng báo cáo sạch + cho phép nhân viên thấy «đã hết hạn giữ kho».
 */
export async function quetHetHan(db: Db | Tx, input: { now: Date }): Promise<number> {
  const r = await db.productReservation.updateMany({ where: { status: "ACTIVE", expiresAt: { lte: input.now } }, data: { status: "EXPIRED", releasedAt: input.now, reason: "HET_HAN_GIU_KHO" } });
  return r.count;
}

export type LoiDoiSoat = { loai: "AM_TON" | "GIU_VUOT_TON" | "SAI_SO_CUOI" | "BAN_THIEU_SO" | "DANG_GIU_QUA_HAN_CHUA_QUET"; productId: string; chiTiet: string };
export type DongDoiSoat = { productId: string; sku: string; tonThuc: number; dangGiuHieuLuc: number; khaDung: number; daBanOnline: number };

/** ĐỐI SOÁT kho (CHỈ ĐỌC): tìm điều bất thường giữa tồn thực, giữ kho và sổ `ProductMovement`. Không sửa gì. */
export async function doiSoatKho(db: Db | Tx, input: { now: Date; productId?: string }): Promise<{ sanPham: DongDoiSoat[]; loi: LoiDoiSoat[] }> {
  const sp = await db.product.findMany({ where: input.productId ? { id: input.productId } : { OR: [{ sellOnline: true }, { reservations: { some: {} } }] }, select: { id: true, sku: true, stockOnHand: true }, orderBy: { id: "asc" } });
  const ids = sp.map((p) => p.id);
  const [giu, qua, ban, mv] = await Promise.all([
    db.productReservation.groupBy({ by: ["productId"], where: { productId: { in: ids }, status: "ACTIVE", expiresAt: { gt: input.now } }, _sum: { quantity: true } }),
    db.productReservation.groupBy({ by: ["productId"], where: { productId: { in: ids }, status: "ACTIVE", expiresAt: { lte: input.now } }, _count: true }),
    db.productReservation.findMany({ where: { productId: { in: ids }, status: { in: ["CONSUMED", "RETURNED"] } }, select: { productId: true, quantity: true, orderItem: { select: { orderId: true } } } }),
    db.productMovement.findMany({ where: { productId: { in: ids } }, select: { productId: true, type: true, quantity: true, orderId: true, stockAfterMovement: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
  ]);
  const giuTheo = new Map(giu.map((g) => [g.productId, g._sum.quantity ?? 0]));
  const quaTheo = new Map(qua.map((g) => [g.productId, g._count]));
  const dong: DongDoiSoat[] = [];
  const loiDs: LoiDoiSoat[] = [];
  for (const p of sp) {
    const dg = giuTheo.get(p.id) ?? 0;
    const banSp = ban.filter((b) => b.productId === p.id);
    dong.push({ productId: p.id, sku: p.sku, tonThuc: p.stockOnHand, dangGiuHieuLuc: dg, khaDung: tinhKhaDung(p.stockOnHand, dg), daBanOnline: banSp.reduce((s, b) => s + b.quantity, 0) });
    if (p.stockOnHand < 0) loiDs.push({ loai: "AM_TON", productId: p.id, chiTiet: `tồn thực ${p.stockOnHand}` });
    if (dg > p.stockOnHand) loiDs.push({ loai: "GIU_VUOT_TON", productId: p.id, chiTiet: `đang giữ ${dg} > tồn thực ${p.stockOnHand}` });
    const q = quaTheo.get(p.id) ?? 0;
    if (q > 0) loiDs.push({ loai: "DANG_GIU_QUA_HAN_CHUA_QUET", productId: p.id, chiTiet: `${q} phần giữ đã quá hạn nhưng chưa được dọn (không ảnh hưởng tồn khả dụng)` });
    const cuoi = mv.filter((m) => m.productId === p.id).at(-1);
    if (cuoi && cuoi.stockAfterMovement !== p.stockOnHand) loiDs.push({ loai: "SAI_SO_CUOI", productId: p.id, chiTiet: `sổ cuối ${cuoi.stockAfterMovement} ≠ tồn thực ${p.stockOnHand}` });
    for (const b of banSp.filter((x) => x.orderItem)) {
      const co = mv.some((m) => m.productId === p.id && m.type === "SALE" && m.orderId === b.orderItem.orderId);
      if (!co) loiDs.push({ loai: "BAN_THIEU_SO", productId: p.id, chiTiet: `đã bán (đơn ${b.orderItem.orderId}) nhưng không có ProductMovement SALE` });
    }
  }
  return { sanPham: dong, loi: loiDs };
}
