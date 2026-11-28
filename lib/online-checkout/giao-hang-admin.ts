import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

import { writeAudit } from "@/lib/audit/audit-log";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";

import { chuanHoaTinh } from "./giao-hang";

/**
 * V8.43 — ADMIN API CẤU HÌNH GIAO HÀNG (khu vực · phương thức · phí). MỌI con số/tên tỉnh là DỮ LIỆU người vận hành nhập; mã không chứa chính sách nào.
 *   · Quyền: `settings:edit` qua `checkPermission` (can() v2) — hôm nay chỉ Quản trị tối cao. Vai Commerce Manager / Warehouse / Kế toán CHƯA có (cần vai mới ở seed — chờ Owner chốt).
 *   · Mọi thay đổi ⇒ AuditLog (trước/sau) CÙNG giao dịch; sửa khu vực/phương thức có `version` (lạc quan): lệch ⇒ 409 `PHIEN_BAN_CU`, không ghi đè im lặng.
 *   · Một tỉnh/thành KHÔNG được thuộc hai khu vực ĐANG HOẠT ĐỘNG (nếu không, phí phụ thuộc thứ tự) ⇒ 409 `TINH_TRUNG_KHU_VUC`.
 *   · Đổi cấu hình KHÔNG đổi đơn đã tạo (đơn chụp `shippingFee/shippingAddress` lúc đặt).
 */
type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export type NguoiQuanTriGiao = { id: string; ten: string };

export async function nguoiQuanTriGiaoHang(): Promise<{ ok: true; nguoi: NguoiQuanTriGiao } | { ok: false; status: 401 | 403; ma: "UNAUTHENTICATED" | "FORBIDDEN" }> {
  const s = await auth();
  const u = s?.user as { id?: string; name?: string | null; email?: string | null } | undefined;
  if (!u?.id) return { ok: false, status: 401, ma: "UNAUTHENTICATED" };
  if (!(await checkPermission("settings:edit"))) return { ok: false, status: 403, ma: "FORBIDDEN" };
  return { ok: true, nguoi: { id: u.id, ten: u.name ?? u.email ?? u.id } };
}

const maSo = z.string().trim().regex(/^[A-Z0-9_]{2,30}$/, "Mã chỉ gồm chữ HOA, số, gạch dưới (2–30 ký tự)");
const ten = z.string().trim().min(1).max(80);
const phi = z.number().int().min(0).max(5_000_000);
const tinh = z.array(z.string().trim().min(1).max(60)).min(1).max(63);
const lyDo = z.string().trim().min(5).max(300);

export const taoKhuVucSchema = z.object({ code: maSo, name: ten, provinces: tinh, isActive: z.boolean().default(true), lyDo }).strict();
export const suaKhuVucSchema = z.object({ name: ten.optional(), provinces: tinh.optional(), isActive: z.boolean().optional(), version: z.number().int().min(1), lyDo }).strict();
export const taoPhuongThucSchema = z.object({ code: maSo, name: ten, description: z.string().trim().max(200).nullable().optional(), etaText: z.string().trim().max(80).nullable().optional(), sortOrder: z.number().int().min(0).max(1000).default(0), isActive: z.boolean().default(true), lyDo }).strict();
export const suaPhuongThucSchema = z.object({ name: ten.optional(), description: z.string().trim().max(200).nullable().optional(), etaText: z.string().trim().max(80).nullable().optional(), sortOrder: z.number().int().min(0).max(1000).optional(), isActive: z.boolean().optional(), version: z.number().int().min(1), lyDo }).strict();
export const datPhiSchema = z.object({ methodCode: maSo, zoneCode: maSo, fee: phi, freeAboveAmount: z.number().int().min(0).max(1_000_000_000).nullable().default(null), isActive: z.boolean().default(true), lyDo }).strict();

export type MaLoiGiaoAdmin = "KHONG_TIM_THAY" | "TRUNG_MA" | "PHIEN_BAN_CU" | "TINH_TRUNG_KHU_VUC" | "TINH_TRUNG_TRONG_KHU_VUC";
export type LoiGiaoAdmin = { ok: false; ma: MaLoiGiaoAdmin; thongBao: string };
export const HTTP_LOI_GIAO_ADMIN: Record<MaLoiGiaoAdmin, number> = { KHONG_TIM_THAY: 404, TRUNG_MA: 409, PHIEN_BAN_CU: 409, TINH_TRUNG_KHU_VUC: 409, TINH_TRUNG_TRONG_KHU_VUC: 400 };
const loi = (ma: MaLoiGiaoAdmin, thongBao: string): LoiGiaoAdmin => ({ ok: false, ma, thongBao });

export async function docCauHinhGiao(db: Db) {
  const [zones, methods, rates] = await Promise.all([
    db.shippingZone.findMany({ orderBy: { code: "asc" } }),
    db.shippingMethod.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    db.shippingRate.findMany({ orderBy: [{ methodId: "asc" }, { zoneId: "asc" }], include: { method: { select: { code: true } }, zone: { select: { code: true } } } }),
  ]);
  return {
    khuVuc: zones.map((z) => ({ id: z.id, code: z.code, name: z.name, provinces: z.provinces, isActive: z.isActive, version: z.version })),
    phuongThuc: methods.map((m) => ({ id: m.id, code: m.code, name: m.name, description: m.description, etaText: m.etaText, sortOrder: m.sortOrder, isActive: m.isActive, version: m.version })),
    phi: rates.map((r) => ({ id: r.id, methodCode: r.method.code, zoneCode: r.zone.code, fee: r.fee, freeAboveAmount: r.freeAboveAmount, isActive: r.isActive })),
  };
}

/** Tỉnh nào (đã chuẩn hoá) của `provinces` đã thuộc MỘT khu vực ĐANG HOẠT ĐỘNG khác `boQuaId`? */
async function tinhDaThuocKhuKhac(tx: Tx | Db, provinces: readonly string[], boQuaId: string | null): Promise<string | null> {
  const can = new Set(provinces.map(chuanHoaTinh));
  const khac = await tx.shippingZone.findMany({ where: { isActive: true, ...(boQuaId ? { id: { not: boQuaId } } : {}) }, select: { code: true, provinces: true } });
  for (const z of khac) for (const p of z.provinces) if (can.has(chuanHoaTinh(p))) return `${p} (khu vực ${z.code})`;
  return null;
}

const trungTrongKhu = (provinces: readonly string[]): string | null => {
  const thay = new Set<string>();
  for (const p of provinces) {
    const k = chuanHoaTinh(p);
    if (!k) return p;
    if (thay.has(k)) return p;
    thay.add(k);
  }
  return null;
};

type Actor = NguoiQuanTriGiao;
const aud = (tx: Tx, a: Actor, entityType: string, entityId: string, action: string, oldValues: Record<string, unknown> | null, newValues: Record<string, unknown>, lyDoThayDoi: string) =>
  writeAudit({ tx, actor: { id: a.id, name: a.ten }, module: "online-shipping", entityType, entityId, action, oldValues, newValues: { ...newValues, lyDo: lyDoThayDoi } });

export async function taoKhuVuc(db: Db, nguoi: Actor, raw: unknown): Promise<{ ok: true; id: string } | LoiGiaoAdmin> {
  const d = taoKhuVucSchema.parse(raw);
  const dup = trungTrongKhu(d.provinces);
  if (dup) return loi("TINH_TRUNG_TRONG_KHU_VUC", `Tỉnh/thành lặp hoặc rỗng trong danh sách: "${dup}"`);
  return db.$transaction(async (tx) => {
    if (await tx.shippingZone.findUnique({ where: { code: d.code }, select: { id: true } })) return loi("TRUNG_MA", `Mã khu vực ${d.code} đã tồn tại`);
    if (d.isActive) {
      const x = await tinhDaThuocKhuKhac(tx, d.provinces, null);
      if (x) return loi("TINH_TRUNG_KHU_VUC", `Tỉnh/thành đã thuộc khu vực đang hoạt động khác: ${x}`);
    }
    const z = await tx.shippingZone.create({ data: { code: d.code, name: d.name, provinces: d.provinces, isActive: d.isActive }, select: { id: true } });
    await aud(tx, nguoi, "ShippingZone", z.id, "CREATE", null, { code: d.code, name: d.name, provinces: d.provinces, isActive: d.isActive }, d.lyDo);
    return { ok: true as const, id: z.id };
  });
}

export async function suaKhuVuc(db: Db, nguoi: Actor, id: string, raw: unknown): Promise<{ ok: true; version: number } | LoiGiaoAdmin> {
  const d = suaKhuVucSchema.parse(raw);
  if (d.provinces) {
    const dup = trungTrongKhu(d.provinces);
    if (dup) return loi("TINH_TRUNG_TRONG_KHU_VUC", `Tỉnh/thành lặp hoặc rỗng trong danh sách: "${dup}"`);
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ShippingZone" WHERE "id" = ${id} FOR UPDATE`;
    const cu = await tx.shippingZone.findUnique({ where: { id } });
    if (!cu) return loi("KHONG_TIM_THAY", "Không tìm thấy khu vực");
    if (cu.version !== d.version) return loi("PHIEN_BAN_CU", "Khu vực đã được người khác sửa — tải lại rồi sửa tiếp");
    const sau = { name: d.name ?? cu.name, provinces: d.provinces ?? cu.provinces, isActive: d.isActive ?? cu.isActive };
    if (sau.isActive) {
      const x = await tinhDaThuocKhuKhac(tx, sau.provinces, id);
      if (x) return loi("TINH_TRUNG_KHU_VUC", `Tỉnh/thành đã thuộc khu vực đang hoạt động khác: ${x}`);
    }
    const r = await tx.shippingZone.updateMany({ where: { id, version: cu.version }, data: { ...sau, version: { increment: 1 } } });
    if (r.count === 0) throw new Error("SHIPPING_ZONE_VERSION_RACE"); // không thể xảy ra dưới khoá; nếu có ⇒ rollback
    await aud(tx, nguoi, "ShippingZone", id, "UPDATE", { name: cu.name, provinces: cu.provinces, isActive: cu.isActive, version: cu.version }, sau, d.lyDo);
    return { ok: true as const, version: cu.version + 1 };
  });
}

export async function taoPhuongThuc(db: Db, nguoi: Actor, raw: unknown): Promise<{ ok: true; id: string } | LoiGiaoAdmin> {
  const d = taoPhuongThucSchema.parse(raw);
  return db.$transaction(async (tx) => {
    if (await tx.shippingMethod.findUnique({ where: { code: d.code }, select: { id: true } })) return loi("TRUNG_MA", `Mã phương thức ${d.code} đã tồn tại`);
    const m = await tx.shippingMethod.create({ data: { code: d.code, name: d.name, description: d.description ?? null, etaText: d.etaText ?? null, sortOrder: d.sortOrder, isActive: d.isActive }, select: { id: true } });
    await aud(tx, nguoi, "ShippingMethod", m.id, "CREATE", null, { code: d.code, name: d.name, sortOrder: d.sortOrder, isActive: d.isActive }, d.lyDo);
    return { ok: true as const, id: m.id };
  });
}

export async function suaPhuongThuc(db: Db, nguoi: Actor, id: string, raw: unknown): Promise<{ ok: true; version: number } | LoiGiaoAdmin> {
  const d = suaPhuongThucSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ShippingMethod" WHERE "id" = ${id} FOR UPDATE`;
    const cu = await tx.shippingMethod.findUnique({ where: { id } });
    if (!cu) return loi("KHONG_TIM_THAY", "Không tìm thấy phương thức");
    if (cu.version !== d.version) return loi("PHIEN_BAN_CU", "Phương thức đã được người khác sửa — tải lại rồi sửa tiếp");
    const sau = { name: d.name ?? cu.name, description: d.description === undefined ? cu.description : d.description, etaText: d.etaText === undefined ? cu.etaText : d.etaText, sortOrder: d.sortOrder ?? cu.sortOrder, isActive: d.isActive ?? cu.isActive };
    const r = await tx.shippingMethod.updateMany({ where: { id, version: cu.version }, data: { ...sau, version: { increment: 1 } } });
    if (r.count === 0) throw new Error("SHIPPING_METHOD_VERSION_RACE");
    await aud(tx, nguoi, "ShippingMethod", id, "UPDATE", { name: cu.name, description: cu.description, etaText: cu.etaText, sortOrder: cu.sortOrder, isActive: cu.isActive, version: cu.version }, sau, d.lyDo);
    return { ok: true as const, version: cu.version + 1 };
  });
}

/** Đặt (tạo hoặc sửa) phí của MỘT cặp phương thức × khu vực. Phương thức giao nhanh «chỉ vài khu vực» = chỉ đặt phí ở các khu vực đó. */
export async function datPhiGiao(db: Db, nguoi: Actor, raw: unknown): Promise<{ ok: true; id: string; taoMoi: boolean } | LoiGiaoAdmin> {
  const d = datPhiSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const [m, z] = await Promise.all([tx.shippingMethod.findUnique({ where: { code: d.methodCode }, select: { id: true } }), tx.shippingZone.findUnique({ where: { code: d.zoneCode }, select: { id: true } })]);
    if (!m) return loi("KHONG_TIM_THAY", `Không có phương thức ${d.methodCode}`);
    if (!z) return loi("KHONG_TIM_THAY", `Không có khu vực ${d.zoneCode}`);
    const cu = await tx.shippingRate.findUnique({ where: { methodId_zoneId: { methodId: m.id, zoneId: z.id } } });
    const r = await tx.shippingRate.upsert({
      where: { methodId_zoneId: { methodId: m.id, zoneId: z.id } },
      create: { methodId: m.id, zoneId: z.id, fee: d.fee, freeAboveAmount: d.freeAboveAmount, isActive: d.isActive },
      update: { fee: d.fee, freeAboveAmount: d.freeAboveAmount, isActive: d.isActive },
      select: { id: true },
    });
    await aud(tx, nguoi, "ShippingRate", r.id, cu ? "UPDATE" : "CREATE", cu ? { fee: cu.fee, freeAboveAmount: cu.freeAboveAmount, isActive: cu.isActive } : null, { methodCode: d.methodCode, zoneCode: d.zoneCode, fee: d.fee, freeAboveAmount: d.freeAboveAmount, isActive: d.isActive }, d.lyDo);
    return { ok: true as const, id: r.id, taoMoi: !cu };
  });
}
