"use server";

// Tab "Máy POS" — khai máy SmartPOS Techcombank ⇒ cơ sở (docs/pos-the-smartpos.md, Q-D).
//
// ── VÌ SAO CÓ MÀN NÀY ────────────────────────────────────────────────────────────────
// File giao dịch thẻ chỉ nói "máy nào quẹt", không nói "cơ sở nào thu". Cầu nối duy nhất
// là `PosTerminal.maThietBi → centerId`. Máy chưa khai (hoặc đang tắt) thì mọi giao dịch
// của nó rơi vào "Thiết bị chưa gán cơ sở" — tiền vẫn nằm đó, chỉ là không tự khớp.
//
// ── BỐN LUẬT CỦA FILE NÀY ────────────────────────────────────────────────────────────
// 1. Quyền `payments:import-pos` hỏi NGAY ĐẦU mọi action (layout gate là chưa đủ — Server
//    Action là endpoint HTTP riêng).
// 2. `scopedDb` KHÔNG che write ⇒ mọi ghi tự `passesScope` trên CẢ bản ghi đã đọc (nguồn)
//    lẫn cơ sở đích. `PosTerminal` ∈ SCOPED_MODELS với prefix `payments:`. Thêm vào đó GHI
//    đòi phạm vi MỌI cơ sở (`nhapPosDuocMoiCoSo`, Q-D) — người neo ở CS1 chỉ XEM máy của CS1.
// 3. `create` PHẢI set `centerId` (model thuộc SCOPED_MODELS). `orgUnitId` do ghi kép tự
//    điền (`lib/org/dual-write.ts`, `PosTerminal` có trong `BACKFILL_SPECS`) — KHÔNG tự
//    gọi `orgUnitIdForCenter()` ở đây.
// 4. KHÔNG xoá cứng. Máy thôi dùng thì TẮT: giao dịch cũ của nó vẫn cần tra được máy
//    đã quẹt ở cơ sở nào.
//
// Trùng `maThietBi` bắt bằng lỗi unique của DB (P2002) chứ KHÔNG hỏi trước qua `scopedDb`:
// `maThietBi` là @unique TOÀN CỤC, còn câu đọc qua `scopedDb` bị lọc theo cơ sở — người
// chỉ thấy CS1 sẽ được báo "chưa ai dùng" cho một máy đã khai ở CS2, rồi mới ăn lỗi thô
// (cùng bài học `lib/payments/method-lookup.ts`).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import { nhapPosDuocMoiCoSo } from "@/lib/payments/pos/pham-vi-nhap";

const QUYEN = "payments:import-pos";
const DUONG_DAN = "/admin/cau-hinh-van-hanh";
const MODEL = "PosTerminal";

export type KetQuaMayPos = { ok: true; id: string } | { ok: false; error: string };

/** Chuỗi tuỳ chọn: trim, rỗng ⇒ null. */
const chuoiTuyChon = (max: number, ten: string) =>
  z
    .string()
    .trim()
    .max(max, `${ten} tối đa ${max} ký tự`)
    .nullish()
    .transform((v) => (v ? v : null));

const maThietBiSchema = z
  .string()
  .trim()
  .min(1, "Nhập mã thiết bị")
  .max(64, "Mã thiết bị tối đa 64 ký tự")
  // Mã so KHỚP ĐÚNG với cột "Mã thiết bị" của file; khoảng trắng giữa mã là dấu hiệu dán
  // nhầm hai ô, lưu vào là máy không bao giờ khớp giao dịch nào.
  .regex(/^\S+$/, "Mã thiết bị không được chứa khoảng trắng");

/**
 * GĐ2 POS (docs/pos-gd2-thiet-ke.md §6.1) — mã do Techcombank cấp trên portal merchant (mã cửa hàng ·
 * mã nhà cung cấp `merchant_code` · mã TCB quầy), cho GĐ4 (agent). Trim, rỗng ⇒ `null`, ≤ 64, KHÔNG
 * khoảng trắng giữa mã (cùng lý `maThietBiSchema`: khoảng trắng giữa mã là dán nhầm hai ô — agent sẽ
 * so khớp ĐÚNG chuỗi). `undefined` (biểu mẫu không gửi ô này) GIỮ NGUYÊN khi sửa — không xoá trắng thứ
 * người khác vừa khai. Không `@unique`: một cửa hàng nhiều máy.
 */
const maTcbTuyChon = (ten: string) =>
  z
    .string()
    .trim()
    .max(64, `${ten} tối đa 64 ký tự`)
    .regex(/^\S*$/, `${ten} không được chứa khoảng trắng`)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

const maTcb = {
  maCuaHang: maTcbTuyChon("Mã cửa hàng"),
  maNhaCungCap: maTcbTuyChon("Mã nhà cung cấp"),
  maTcbQuay: maTcbTuyChon("Mã TCB quầy"),
};

const taoSchema = z.object({
  maThietBi: maThietBiSchema,
  maQuay: chuoiTuyChon(64, "Mã quầy"),
  ten: chuoiTuyChon(120, "Tên máy"),
  centerId: z.string().trim().min(1, "Chọn cơ sở đặt máy"),
  ...maTcb,
});

const suaSchema = z.object({
  id: z.string().trim().min(1),
  maQuay: chuoiTuyChon(64, "Mã quầy"),
  ten: chuoiTuyChon(120, "Tên máy"),
  centerId: z.string().trim().min(1, "Chọn cơ sở đặt máy"),
  ...maTcb,
});

/** Ba ô mã TCB — `tsc` liệt kê nơi phải thêm khi có ô mới. */
const TRUONG_MA_TCB = ["maCuaHang", "maNhaCungCap", "maTcbQuay"] as const;
type TruongMaTcb = (typeof TRUONG_MA_TCB)[number];

const batTatSchema = z.object({
  id: z.string().trim().min(1),
  active: z.boolean(),
});

const KHONG_QUYEN = "Bạn không có quyền khai máy POS.";
const NGOAI_PHAM_VI = "Máy này hoặc cơ sở đích nằm ngoài phạm vi bạn quản lý.";
/**
 * Q-D (docs/pos-the-smartpos.md): chỉ Kế toán HO + Quản trị tối cao cấu hình máy POS. Máy quyết
 * định CƠ SỞ của mọi giao dịch thẻ nó quẹt, nên cổng này đo ĐÚNG phạm vi mà import đòi
 * (`nhapPosDuocMoiCoSo`): vai cơ sở được cấp `payments:import-pos` (RoleDef sửa trên DB, v1
 * `ACCOUNTANT` khi rollback) mà khai được máy của cơ sở khác (chưa khai) về cơ sở mình thì mọi
 * giao dịch của máy đó đổi cơ sở — kế toán cơ sở kia mất hàng chờ, người cơ sở này đọc ghi chú
 * khách cơ sở kia. Ca `[MPOS-06]`.
 */
const LOI_PHAM_VI_MAY_POS = "Chỉ Kế toán Hội sở (nhìn được mọi cơ sở) mới khai được máy POS.";

function laLoiTrung(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

function tenNguoi(user: { id: string; name?: string | null; email?: string | null }): string {
  return user.name ?? user.email ?? user.id;
}

/**
 * Cơ sở đích phải (a) trong phạm vi actor và (b) có thật + đang hoạt động.
 *
 * `Center` ∈ SCOPE_EXEMPT nên `scopedDb` không lọc nó — vế (a) là `passesScope` trên
 * chính model đang ghi. Vế (b) chặn trước lỗi khoá ngoại thô của Postgres.
 */
async function kiemCoSoDich(
  sdb: ReturnType<typeof scopedDb>,
  actor: Actor,
  centerId: string,
): Promise<string | null> {
  if (!passesScope(MODEL, { centerId }, actor)) return NGOAI_PHAM_VI;
  const coSo = await sdb.center.findFirst({
    where: { id: centerId, isActive: true },
    select: { id: true },
  });
  return coSo ? null : "Cơ sở không tồn tại hoặc đã ngừng hoạt động.";
}

// ─── TẠO ──────────────────────────────────────────────────────────────────────────────
export async function taoMayPosAction(input: unknown): Promise<KetQuaMayPos> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission(QUYEN))) return { ok: false, error: KHONG_QUYEN };

  const parsed = taoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const d = parsed.data;

  const actor = await resolveActor(session.user.id);
  if (!nhapPosDuocMoiCoSo(actor)) return { ok: false, error: LOI_PHAM_VI_MAY_POS };
  const sdb = scopedDb(actor);
  const loiCoSo = await kiemCoSoDich(sdb, actor, d.centerId);
  if (loiCoSo) return { ok: false, error: loiCoSo };

  try {
    const may = await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      const m = await tx.posTerminal.create({
        data: {
          maThietBi: d.maThietBi,
          maQuay: d.maQuay,
          ten: d.ten,
          maCuaHang: d.maCuaHang ?? null,
          maNhaCungCap: d.maNhaCungCap ?? null,
          maTcbQuay: d.maTcbQuay ?? null,
          // PosTerminal ∈ SCOPED_MODELS ⇒ create PHẢI tự set centerId.
          centerId: d.centerId,
          active: true,
          createdById: session.user.id,
        },
        select: {
          id: true,
          maThietBi: true,
          maQuay: true,
          ten: true,
          maCuaHang: true,
          maNhaCungCap: true,
          maTcbQuay: true,
          centerId: true,
          active: true,
        },
      });
      await writeAudit({
        actor: { id: session.user.id, name: tenNguoi(session.user) },
        module: "payments",
        entityType: MODEL,
        entityId: m.id,
        action: "CREATE",
        newValues: { ...m },
        orgUnitId: m.centerId,
        tx,
      });
      return m;
    });
    revalidatePath(DUONG_DAN);
    return { ok: true, id: may.id };
  } catch (e) {
    if (laLoiTrung(e)) {
      return {
        ok: false,
        // Dòng trùng có thể nằm ở cơ sở người này KHÔNG thấy (bảng đọc qua scopedDb) — câu
        // "tìm trong bảng" trần sẽ bắt họ tìm một dòng không bao giờ hiện ra.
        error: `Mã thiết bị "${d.maThietBi}" đã được khai. Mỗi máy chỉ khai một lần — nếu dòng đó có trong bảng, sửa hoặc bật lại nó; nếu không thấy, máy đang thuộc một cơ sở ngoài phạm vi của bạn — báo Kế toán Hội sở.`,
      };
    }
    throw e;
  }
}

// ─── SỬA (mã quầy, tên, cơ sở) ────────────────────────────────────────────────────────
// `maThietBi` KHÔNG sửa được: nó là khoá khớp với file. Gõ sai thì tắt dòng cũ, khai dòng mới
// — giữ vết máy nào đã từng mang mã nào.
export async function suaMayPosAction(input: unknown): Promise<KetQuaMayPos> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission(QUYEN))) return { ok: false, error: KHONG_QUYEN };

  const parsed = suaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const d = parsed.data;

  const actor = await resolveActor(session.user.id);
  if (!nhapPosDuocMoiCoSo(actor)) return { ok: false, error: LOI_PHAM_VI_MAY_POS };
  const sdb = scopedDb(actor);
  const truoc = await sdb.posTerminal.findUnique({
    where: { id: d.id },
    select: {
      id: true,
      maThietBi: true,
      maQuay: true,
      ten: true,
      maCuaHang: true,
      maNhaCungCap: true,
      maTcbQuay: true,
      centerId: true,
      active: true,
    },
  });
  // NGUỒN: bản ghi đã đọc phải trong phạm vi (scopedDb không che write).
  if (!truoc || !passesScope(MODEL, truoc, actor)) {
    return { ok: false, error: "Không tìm thấy máy POS này." };
  }
  // ĐÍCH: đổi sang cơ sở ngoài phạm vi là gán chéo cơ sở. Chỉ kiểm khi ĐỔI: giữ nguyên
  // cơ sở thì vế nguồn ở trên đã `passesScope` đúng cơ sở ấy, và đòi `isActive` ở đây sẽ
  // khoá luôn việc sửa tên máy nằm ở cơ sở đã ngừng.
  // eslint-disable-next-line no-restricted-syntax -- so DỮ LIỆU "có đổi cơ sở không", KHÔNG phải cổng quyền; cổng là passesScope (nguồn ở trên, đích trong kiemCoSoDich)
  if (d.centerId !== truoc.centerId) {
    const loiCoSo = await kiemCoSoDich(sdb, actor, d.centerId);
    if (loiCoSo) return { ok: false, error: loiCoSo };
  }

  // Ba mã TCB: chỉ những ô biểu mẫu GỬI lên (rỗng ⇒ null = xoá có chủ đích; không gửi ⇒ giữ nguyên).
  const maTcbGui: Partial<Record<TruongMaTcb, string | null>> = {};
  const maTcbCu: Partial<Record<TruongMaTcb, string | null>> = {};
  for (const k of TRUONG_MA_TCB) {
    const v = d[k];
    if (v === undefined) continue;
    maTcbGui[k] = v;
    maTcbCu[k] = truoc[k];
  }
  const sau = { maQuay: d.maQuay, ten: d.ten, centerId: d.centerId, ...maTcbGui };
  const truocSoSanh = { maQuay: truoc.maQuay, ten: truoc.ten, centerId: truoc.centerId, ...maTcbCu };

  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    // `centerId` có trong `data` ⇒ ghi kép tự cập nhật `orgUnitId` theo cơ sở mới.
    await tx.posTerminal.update({ where: { id: truoc.id }, data: sau });
    await writeAudit({
      actor: { id: session.user.id, name: tenNguoi(session.user) },
      module: "payments",
      entityType: MODEL,
      entityId: truoc.id,
      action: "UPDATE",
      oldValues: truocSoSanh,
      newValues: sau,
      orgUnitId: d.centerId,
      tx,
    });
  });
  revalidatePath(DUONG_DAN);
  return { ok: true, id: truoc.id };
}

// ─── BẬT / TẮT ────────────────────────────────────────────────────────────────────────
export async function batTatMayPosAction(input: unknown): Promise<KetQuaMayPos> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission(QUYEN))) return { ok: false, error: KHONG_QUYEN };

  const parsed = batTatSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const d = parsed.data;

  const actor = await resolveActor(session.user.id);
  if (!nhapPosDuocMoiCoSo(actor)) return { ok: false, error: LOI_PHAM_VI_MAY_POS };
  const sdb = scopedDb(actor);
  const truoc = await sdb.posTerminal.findUnique({
    where: { id: d.id },
    select: { id: true, centerId: true, active: true },
  });
  if (!truoc || !passesScope(MODEL, truoc, actor)) {
    return { ok: false, error: "Không tìm thấy máy POS này." };
  }
  if (truoc.active === d.active) return { ok: true, id: truoc.id };

  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    await tx.posTerminal.update({ where: { id: truoc.id }, data: { active: d.active } });
    await writeAudit({
      actor: { id: session.user.id, name: tenNguoi(session.user) },
      module: "payments",
      entityType: MODEL,
      entityId: truoc.id,
      action: d.active ? "ENABLE" : "DISABLE",
      oldValues: { active: truoc.active },
      newValues: { active: d.active },
      orgUnitId: truoc.centerId,
      tx,
    });
  });
  revalidatePath(DUONG_DAN);
  return { ok: true, id: truoc.id };
}
