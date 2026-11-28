import type { Prisma, PrismaClient } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";
import { tinhKhaDung, tongDangGiu } from "@/lib/inventory/giu-kho";

/**
 * V8.42 — DANH MỤC HỌC CỤ BÁN ONLINE (Commerce v2 · P0-A). Đọc từ `Product` (kho hàng bán được) — KHÔNG có bảng danh mục thứ hai.
 *   · chỉ sản phẩm `sellOnline = true` ∧ `status = ACTIVE` (cờ mặc định TẮT: chưa có gì bán nếu Admin chưa bật từng sản phẩm);
 *   · biến thể = mỗi biến thể là MỘT Product (SKU/giá/tồn riêng), gom bằng `onlineGroupKey` + nhãn `onlineVariantLabel`;
 *   · tồn khả dụng = `stockOnHand − Σ giữ kho còn hiệu lực` (cùng công thức với lõi giữ kho); số tồn thật KHÔNG lộ khi dồi dào;
 *   · KHÔNG lộ `costPrice`, ghi chú nội bộ, tồn ngưỡng tối thiểu. Giá = `salePrice` do MÁY CHỦ; client không gửi giá.
 * `now` BẮT BUỘC (luật 19).
 */
type Db = PrismaClient;

export const NGUONG_CHI_CON = 5;
export const SO_LUONG_TOI_DA_MAC_DINH = 5;
export type TrangThaiTonKho = "CON_HANG" | "CHI_CON" | "HET_HANG";
export type TonKhoDto = { trangThai: TrangThaiTonKho; conLai: number | null };

/** THUẦN. `conLai` chỉ có khi `CHI_CON` — còn dồi dào hay hết thì không lộ số. */
export function tonKhoHienThi(khaDung: number, nguong: number = NGUONG_CHI_CON): TonKhoDto {
  if (khaDung <= 0) return { trangThai: "HET_HANG", conLai: null };
  if (khaDung <= nguong) return { trangThai: "CHI_CON", conLai: khaDung };
  return { trangThai: "CON_HANG", conLai: null };
}
/** THUẦN. Trần số lượng mỗi dòng: cấu hình của sản phẩm, mặc định 5; không bao giờ vượt tồn khả dụng khi mua (xem giỏ). */
export const soLuongToiDaCuaSanPham = (onlineMaxQty: number | null): number => onlineMaxQty ?? SO_LUONG_TOI_DA_MAC_DINH;

export type SanPhamHocCuDto = {
  id: string;
  sku: string;
  ten: string;
  moTa: string | null;
  danhMuc: string;
  anh: string[];
  donGia: number;
  giaGoc: number | null;
  nhom: { khoa: string | null; nhanBienThe: string | null };
  tonKho: TonKhoDto;
  soLuongToiDa: number;
  muaKem: string[];
  daDangKyBaoCoHang: boolean;
};

const CHON = {
  id: true, sku: true, name: true, description: true, category: true, imageUrls: true, salePrice: true, stockOnHand: true,
  onlineGroupKey: true, onlineVariantLabel: true, onlineMaxQty: true,
  onlineAddons: { select: { addonProductId: true, sortOrder: true, addon: { select: { id: true, sellOnline: true, status: true } } }, orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] },
} satisfies Prisma.ProductSelect;

type Dong = {
  id: string; sku: string; name: string; description: string | null; category: string; imageUrls: string[]; salePrice: number; stockOnHand: number;
  onlineGroupKey: string | null; onlineVariantLabel: string | null; onlineMaxQty: number | null;
  onlineAddons: Array<{ addonProductId: string; addon: { id: string; sellOnline: boolean; status: string } }>;
};

async function dungDto(db: Db, rows: Dong[], parentUserId: string | null, now: Date): Promise<SanPhamHocCuDto[]> {
  const ids = rows.map((r) => r.id);
  const [giu, dk] = await Promise.all([
    tongDangGiu(db, ids, now),
    parentUserId && ids.length ? db.productRestockSubscription.findMany({ where: { parentUserId, productId: { in: ids } }, select: { productId: true } }) : Promise.resolve([]),
  ]);
  const dangKy = new Set(dk.map((x) => x.productId));
  return rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    ten: r.name,
    moTa: r.description,
    danhMuc: r.category,
    anh: r.imageUrls,
    donGia: r.salePrice,
    giaGoc: null,
    nhom: { khoa: r.onlineGroupKey, nhanBienThe: r.onlineVariantLabel },
    tonKho: tonKhoHienThi(tinhKhaDung(r.stockOnHand, giu.get(r.id) ?? 0)),
    soLuongToiDa: soLuongToiDaCuaSanPham(r.onlineMaxQty),
    // chỉ gợi ý mua kèm sản phẩm CŨNG đang bán Online
    muaKem: r.onlineAddons.filter((a) => a.addon.sellOnline && a.addon.status === "ACTIVE").map((a) => a.addonProductId),
    daDangKyBaoCoHang: dangKy.has(r.id),
  }));
}

const BAN_ONLINE = { sellOnline: true, status: "ACTIVE" as const };

export async function docDanhMucHocCu(db: Db, input: { danhMuc?: string; q?: string; trang: number; soLuong: number; parentUserId: string | null; now: Date }): Promise<{ muc: SanPhamHocCuDto[]; tong: number }> {
  const q = input.q?.trim();
  const where = {
    ...BAN_ONLINE,
    ...(input.danhMuc ? { category: input.danhMuc as never } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { sku: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
  const [rows, tong] = await Promise.all([
    db.product.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (input.trang - 1) * input.soLuong, take: input.soLuong, select: CHON }),
    db.product.count({ where }),
  ]);
  return { muc: await dungDto(db, rows as unknown as Dong[], input.parentUserId, input.now), tong };
}

/** Một sản phẩm + các biến thể cùng nhóm (kể cả chính nó). null nếu không bán Online. */
export async function docMotHocCu(db: Db, input: { id: string; parentUserId: string | null; now: Date }): Promise<{ sanPham: SanPhamHocCuDto; bienThe: SanPhamHocCuDto[] } | null> {
  const r = await db.product.findFirst({ where: { id: input.id, ...BAN_ONLINE }, select: CHON });
  if (!r) return null;
  const nhom = r.onlineGroupKey
    ? await db.product.findMany({ where: { onlineGroupKey: r.onlineGroupKey, ...BAN_ONLINE }, orderBy: [{ onlineVariantLabel: "asc" }, { id: "asc" }], select: CHON })
    : [r];
  const dtos = await dungDto(db, [r, ...nhom.filter((x) => x.id !== r.id)] as unknown as Dong[], input.parentUserId, input.now);
  return { sanPham: dtos[0]!, bienThe: dtos };
}

/** «Báo khi có hàng». Chỉ sản phẩm đang bán Online; idempotent. Trả `false` nếu sản phẩm không bán Online (không tiết lộ sản phẩm nội bộ). */
export async function dangKyBaoCoHang(db: Db, input: { productId: string; parentUserId: string; now: Date }): Promise<boolean> {
  const p = await db.product.findFirst({ where: { id: input.productId, ...BAN_ONLINE }, select: { id: true } });
  if (!p) return false;
  const khoa = { productId_parentUserId: { productId: input.productId, parentUserId: input.parentUserId } };
  await db.productRestockSubscription.upsert({ where: khoa, create: { productId: input.productId, parentUserId: input.parentUserId, createdAt: input.now }, update: {} });
  // Đã được báo rồi mà đăng ký LẠI ⇒ làm mới (lần báo sau có dedupeKey khác); chưa được báo ⇒ không đổi gì (idempotent).
  await db.productRestockSubscription.updateMany({ where: { ...{ productId: input.productId, parentUserId: input.parentUserId }, notifiedAt: { not: null } }, data: { notifiedAt: null, createdAt: input.now } });
  return true;
}

/** Huỷ đăng ký (idempotent). Luôn ok — không tiết lộ có/không. */
export async function huyBaoCoHang(db: Db, input: { productId: string; parentUserId: string }): Promise<void> {
  await db.productRestockSubscription.deleteMany({ where: { productId: input.productId, parentUserId: input.parentUserId } });
}

const NOI_DUNG = { title: "Sản phẩm đã có hàng trở lại", body: "Sản phẩm ba mẹ quan tâm đã có hàng trở lại. Xem trong cửa hàng Sata Robo." } as const;

/**
 * GỬI thông báo «có hàng lại» cho người đã đăng ký — CHỈ khi sản phẩm đang bán Online VÀ còn khả dụng > 0; mỗi đăng ký chỉ báo MỘT lần
 * (`notifiedAt`); chạy trùng/song song vô hại (cập nhật có điều kiện + `dedupeKey`). Nội dung trung tính: không giá, không số lượng.
 * Người nhận = học viên đầu tiên của phụ huynh (cách bảng `Notification` chạm tới một phụ huynh: audience STUDENT). Phụ huynh chưa có con ⇒ bỏ qua (cũng không mua được).
 */
export async function guiThongBaoCoHangLai(db: Db, input: { productId: string; now: Date }): Promise<number> {
  const p = await db.product.findFirst({ where: { id: input.productId, ...BAN_ONLINE }, select: { id: true, stockOnHand: true } });
  if (!p) return 0;
  const giu = await tongDangGiu(db, [p.id], input.now);
  if (tinhKhaDung(p.stockOnHand, giu.get(p.id) ?? 0) <= 0) return 0;
  const cho = await db.productRestockSubscription.findMany({ where: { productId: p.id, notifiedAt: null }, select: { id: true, parentUserId: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 500 });
  let gui = 0;
  for (const s of cho) {
    const con = await db.student.findFirst({ where: { parentUserId: s.parentUserId }, orderBy: { id: "asc" }, select: { id: true } });
    if (!con) continue; // chưa có con ⇒ KHÔNG đánh dấu đã báo: có con rồi vẫn nhận được
    // GIAO DỊCH: đánh dấu đã báo + tạo thông báo cùng thành công hoặc cùng huỷ — lỗi giữa chừng KHÔNG làm mất lượt báo (lượt quét sau thử lại).
    const daGui = await db.$transaction(async (tx) => {
      const dau = await tx.productRestockSubscription.updateMany({ where: { id: s.id, notifiedAt: null }, data: { notifiedAt: input.now } });
      if (dau.count === 0) return false; // luồng khác đã báo
      await tx.notification.createMany({ data: [{ title: NOI_DUNG.title, body: NOI_DUNG.body, audience: "STUDENT" as const, studentId: con.id, centerId: null, isPublished: true, dedupeKey: `restock:${p.id}:${s.id}:${s.createdAt.getTime()}` }], skipDuplicates: true });
      await writeAudit({ tx, actor: { id: null, name: "Hệ thống (có hàng lại)" }, module: "online-restock", entityType: "ProductRestockSubscription", entityId: s.id, action: "RESTOCK_NOTIFIED", newValues: { productId: p.id } });
      return true;
    });
    if (daGui) gui++;
  }
  return gui;
}

/**
 * QUÉT «có hàng lại» THEO TRẠNG THÁI THẬT (không theo từng đường làm tăng tồn: nhập kho, kiểm kê, nhả giữ kho do huỷ/hết hạn, trả hàng… đều dẫn tới `khaDung > 0`).
 * Chỉ xét sản phẩm CÒN người chờ chưa báo + đang bán Online; `guiThongBaoCoHangLai` tự kiểm khả dụng > 0 nên KHÔNG báo khi chưa có hàng thật.
 * Lỗi một sản phẩm không chặn sản phẩm khác (và không đánh dấu đã báo) ⇒ lượt sau thử lại. Idempotent.
 */
export async function quetThongBaoCoHang(db: Db, input: { now: Date; toiDaSanPham?: number }): Promise<{ sanPham: number; daGui: number; loi: number }> {
  const sp = await db.productRestockSubscription.findMany({ where: { notifiedAt: null, product: { ...BAN_ONLINE } }, distinct: ["productId"], select: { productId: true }, take: input.toiDaSanPham ?? 100 });
  let daGui = 0;
  let loi = 0;
  for (const x of sp) {
    try {
      daGui += await guiThongBaoCoHangLai(db, { productId: x.productId, now: input.now });
    } catch (err) {
      loi++;
      console.error(`[co-hang-lai] sản phẩm ${x.productId}: lỗi, sẽ thử lại lượt sau`, err);
    }
  }
  return { sanPham: sp.length, daGui, loi };
}
