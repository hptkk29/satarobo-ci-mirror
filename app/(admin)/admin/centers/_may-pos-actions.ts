"use server";

// Khai máy SmartPOS Techcombank ⇒ cơ sở (docs/pos-the-smartpos.md, Q-D) — dùng ở mục "Máy POS quẹt thẻ" của màn Cơ sở
// (`/centers/<id>/edit`, docs/pos-hai-nut-khai-may.md §2). 09/10/2026: dời từ tab "Máy POS" của Cấu hình vận hành; CỔNG KHÔNG ĐỔI
// — mục ấy chỉ cố định `centerId` theo trang, còn ba action vẫn tự gác như trước (scopedDb không che write).
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
/** Đường CŨ (tab Máy POS ở Cấu hình vận hành). Giữ để `[MPOS-03]` không phải đổi một chữ — vô hại, chỉ là một lần làm mới thừa. */
const DUONG_DAN = "/admin/cau-hinh-van-hanh";
const MODEL = "PosTerminal";

/**
 * Làm mới nơi máy được liệt kê. Trước 09/10/2026 chỉ có `DUONG_DAN`; từ lúc máy nằm ở trang cơ sở, gọi từ đó mà chỉ làm mới
 * đường cũ thì danh sách đứng nguyên sau toast "đã lưu" (V32). `centerId` = cơ sở CHỨA máy (không phải cơ sở người dùng đang mở).
 */
function lamMoi(centerId: string) {
  revalidatePath(DUONG_DAN);
  revalidatePath(`/admin/centers/${centerId}/edit`);
}

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

/**
 * Chuỗi tuỳ chọn khi SỬA: `undefined` (không gửi) ⇒ GIỮ NGUYÊN, chuỗi rỗng ⇒ `null` (xoá có chủ đích) — CÙNG quy ước với `maTcbTuyChon`.
 * Bản cũ dùng `chuoiTuyChon` (`undefined → null`): gọi `{ id, centerId }` để chuyển máy thì `maQuay` / `ten` bị ghi NULL, trong khi ba
 * mã TCB được giữ — hai quy ước ngược nhau trong cùng một action, và `phanGiaiMay` đòi `maQuay` khớp nên giao dịch của POS Agent mất đường
 * về máy mà không lỗi nào báo. Ca `[HN2-RD-01]`.
 */
const chuoiGiuKhiVang = (max: number, ten: string) =>
  z
    .string()
    .trim()
    .max(max, `${ten} tối đa ${max} ký tự`)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

/**
 * `centerId` là TUỲ CHỌN và có nghĩa là "CHUYỂN máy sang cơ sở này". Vắng ⇒ máy ở yên cơ sở của nó.
 * Hộp thoại Sửa ở màn Cơ sở KHÔNG gửi nó: bản cũ gửi `centerId` của TRANG, nên một trang CS1 cũ (máy đã được bên kỹ thuật chuyển sang CS2)
 * đổi tên máy là kéo máy về lại CS1 — và đổi cơ sở của máy là đổi cơ sở của MỌI giao dịch thẻ nó quẹt về sau. Ca `[HN2-RD-01]`.
 */
const suaSchema = z.object({
  id: z.string().trim().min(1),
  maQuay: chuoiGiuKhiVang(64, "Mã quầy"),
  ten: chuoiGiuKhiVang(120, "Tên máy"),
  centerId: z.string().trim().min(1, "Chọn cơ sở đặt máy").optional(),
  ...maTcb,
});

/** Ba ô mã TCB — `tsc` liệt kê nơi phải thêm khi có ô mới. */
const TRUONG_MA_TCB = ["maCuaHang", "maNhaCungCap", "maTcbQuay"] as const;

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
    lamMoi(may.centerId);
    return { ok: true, id: may.id };
  } catch (e) {
    if (laLoiTrung(e)) {
      return {
        ok: false,
        // Danh sách ở màn Cơ sở chỉ liệt kê máy của MỘT cơ sở, nên dòng trùng thường nằm ở CƠ SỞ KHÁC — và người khai là Kế toán
        // HO (nhìn mọi cơ sở), không còn là người "ngoài phạm vi" như câu cũ nói ("báo Kế toán Hội sở" gửi họ về chính họ). V33.
        error: `Mã thiết bị "${d.maThietBi}" đã được khai. Mỗi máy chỉ khai một lần — nếu máy nằm trong danh sách của cơ sở này, sửa hoặc bật lại nó; nếu không thấy, máy đang được khai ở một cơ sở khác — mở trang cơ sở đó để tìm.`,
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
  // ĐÍCH: đổi sang cơ sở ngoài phạm vi là gán chéo cơ sở. Chỉ kiểm khi CÓ GỬI `centerId` VÀ nó KHÁC: giữ nguyên
  // cơ sở thì vế nguồn ở trên đã `passesScope` đúng cơ sở ấy, và đòi `isActive` ở đây sẽ
  // khoá luôn việc sửa tên máy nằm ở cơ sở đã ngừng.
  // eslint-disable-next-line no-restricted-syntax -- so DỮ LIỆU "có đổi cơ sở không", KHÔNG phải cổng quyền; cổng là passesScope (nguồn ở trên, đích trong kiemCoSoDich)
  if (d.centerId !== undefined && d.centerId !== truoc.centerId) {
    const loiCoSo = await kiemCoSoDich(sdb, actor, d.centerId);
    if (loiCoSo) return { ok: false, error: loiCoSo };
  }

  // CHỈ những khoá ĐƯỢC GỬI (`undefined` ⇒ giữ nguyên; rỗng ⇒ null = xoá có chủ đích). Cùng quy ước cho mã quầy · tên · ba mã TCB ·
  // cơ sở. `sau` và `truocSoSanh` dựng từ CÙNG danh sách khoá — audit không bịa ra một lần "xoá mã quầy" cho khoá không ai đụng.
  const sau: Record<string, string | null> = {};
  const truocSoSanh: Record<string, string | null> = {};
  const ghi = (khoa: string, moi: string | null | undefined, cu: string | null) => {
    if (moi === undefined) return;
    sau[khoa] = moi;
    truocSoSanh[khoa] = cu;
  };
  ghi("maQuay", d.maQuay, truoc.maQuay);
  ghi("ten", d.ten, truoc.ten);
  ghi("centerId", d.centerId, truoc.centerId);
  for (const k of TRUONG_MA_TCB) ghi(k, d[k], truoc[k]);
  // Không có gì để đổi ⇒ thôi (cổng đã qua; chưa có phép ghi nào đứng trước nên không vi phạm luật rollback).
  if (Object.keys(sau).length === 0) return { ok: true, id: truoc.id };
  const coSoSau = d.centerId ?? truoc.centerId;

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
      orgUnitId: coSoSau,
      tx,
    });
  });
  lamMoi(coSoSau);
  // Đổi cơ sở (gọi trực tiếp — UI cơ sở cố định cơ sở của máy): trang cơ sở CŨ cũng phải bỏ máy khỏi danh sách.
  // eslint-disable-next-line no-restricted-syntax -- so DỮ LIỆU "có đổi cơ sở không" để biết trang nào cần làm mới, KHÔNG phải cổng quyền
  if (truoc.centerId !== coSoSau) lamMoi(truoc.centerId);
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
  lamMoi(truoc.centerId);
  return { ok: true, id: truoc.id };
}
