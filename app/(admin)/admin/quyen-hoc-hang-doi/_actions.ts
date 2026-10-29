"use server";

// app/(admin)/admin/quyen-hoc-hang-doi/_actions.ts — SERVER ACTION của HÀNG ĐỢI QUYỀN HỌC. Mỏng: kiểm đăng nhập + quyền, rồi giao cho
// `lib/entitlements/hang-doi/hanh-dong.ts` (nơi có khoá đơn, cổng, audit, idempotent).
//
// QUYỀN: MỌI hành động ghi cần `entitlements:manage` tại ĐÚNG cơ sở của dòng — kiểm bằng `checkPermission` (đi qua grant + cờ RBAC_V2 như mọi action khác)
// ở `vaoAction`, rồi service kiểm lại bằng `can()` v2 trên actor. Layout gate chưa đủ: Server Action là endpoint riêng.
// NGOẠI LỆ DUY NHẤT: `duyetHocVuotAction` (quyết định 5, 13/10/2026) — duyệt học vượt THÊM phần vượt trần gác bằng `entitlements:approve-exception` (hoặc `manage` khi service cho phép
// theo `quyenCanDuyetHocVuot`); mức quyền chính xác do `xetHanhDong` quyết dưới khoá đơn, ở đây chỉ chặn người không giữ quyền nào trong hai quyền.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import {
  danhDauCanDuyet,
  dongDongHangDoi,
  duyetHocVuot,
  duyetThuHoi,
  giuQuyenHoc,
  thuCapLai,
  type KetQuaHanhDong,
} from "@/lib/entitlements/hang-doi/hanh-dong";
import type { AuditActor } from "@/lib/audit/audit-log";

export type KetQuaAction = { ok: true; daLam: boolean; thongBao: string } | { ok: false; error: string };

const idSchema = z.object({ dongId: z.string().trim().min(1).max(64) });
const lyDoSchema = idSchema.extend({ lyDo: z.string().trim().min(10, "Lý do phải từ 10 ký tự.").max(500, "Lý do tối đa 500 ký tự.") });

type Vao = { ok: true; actor: Actor; nguoi: AuditActor } | { ok: false; error: string };

/** Đăng nhập → dòng nằm trong tầm nhìn cơ sở → `entitlements:manage` tại cơ sở của dòng. */
async function vaoAction(dongId: string): Promise<Vao> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập." };
  const actor = await resolveActor(session.user.id);
  const dong = await scopedDb(actor).studyEntitlementXuLy.findUnique({ where: { id: dongId }, select: { id: true, centerId: true, orgUnitId: true } });
  if (!dong) return { ok: false, error: "Không tìm thấy dòng hàng đợi." };
  if (!(await checkPermission("entitlements:manage", { centerId: dong.centerId, orgUnitId: dong.orgUnitId ?? undefined }))) {
    return { ok: false, error: "Bạn không có quyền xử lý hàng đợi quyền học." };
  }
  return { ok: true, actor, nguoi: { id: session.user.id, name: session.user.name ?? session.user.email ?? "Nhân viên" } };
}

/** Như `vaoAction` nhưng đủ quyền khi giữ `entitlements:manage` HOẶC `entitlements:approve-exception` tại cơ sở của dòng. */
async function vaoActionDuyet(dongId: string): Promise<Vao> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập." };
  const actor = await resolveActor(session.user.id);
  const dong = await scopedDb(actor).studyEntitlementXuLy.findUnique({ where: { id: dongId }, select: { id: true, centerId: true, orgUnitId: true } });
  if (!dong) return { ok: false, error: "Không tìm thấy dòng hàng đợi." };
  const target = { centerId: dong.centerId, orgUnitId: dong.orgUnitId ?? undefined };
  if (!(await checkPermission("entitlements:approve-exception", target)) && !(await checkPermission("entitlements:manage", target))) {
    return { ok: false, error: "Bạn không có quyền duyệt học vượt." };
  }
  return { ok: true, actor, nguoi: { id: session.user.id, name: session.user.name ?? session.user.email ?? "Nhân viên" } };
}

function ra(r: KetQuaHanhDong): KetQuaAction {
  if (r.ok && r.daLam) revalidatePath("/quyen-hoc-hang-doi");
  return r.ok ? { ok: true, daLam: r.daLam, thongBao: r.thongBao } : { ok: false, error: r.error };
}

export async function thuCapLaiAction(input: unknown): Promise<KetQuaAction> {
  const p = idSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ." };
  const v = await vaoAction(p.data.dongId);
  if (!v.ok) return v;
  return ra(await thuCapLai({ actor: v.actor, nguoi: v.nguoi, dongId: p.data.dongId, now: new Date() }));
}

export async function dongDongAction(input: unknown): Promise<KetQuaAction> {
  const p = lyDoSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };
  const v = await vaoAction(p.data.dongId);
  if (!v.ok) return v;
  return ra(await dongDongHangDoi({ actor: v.actor, nguoi: v.nguoi, dongId: p.data.dongId, lyDo: p.data.lyDo, now: new Date() }));
}

export async function giuQuyenAction(input: unknown): Promise<KetQuaAction> {
  const p = lyDoSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };
  const v = await vaoAction(p.data.dongId);
  if (!v.ok) return v;
  return ra(await giuQuyenHoc({ actor: v.actor, nguoi: v.nguoi, dongId: p.data.dongId, lyDo: p.data.lyDo, now: new Date() }));
}

export async function duyetThuHoiAction(input: unknown): Promise<KetQuaAction> {
  const p = lyDoSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };
  const v = await vaoAction(p.data.dongId);
  if (!v.ok) return v;
  return ra(await duyetThuHoi({ actor: v.actor, nguoi: v.nguoi, dongId: p.data.dongId, lyDo: p.data.lyDo, now: new Date() }));
}

export async function danhDauCanDuyetAction(input: unknown): Promise<KetQuaAction> {
  const p = lyDoSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };
  const v = await vaoAction(p.data.dongId);
  if (!v.ok) return v;
  return ra(await danhDauCanDuyet({ actor: v.actor, nguoi: v.nguoi, dongId: p.data.dongId, lyDo: p.data.lyDo, now: new Date() }));
}

export async function duyetHocVuotAction(input: unknown): Promise<KetQuaAction> {
  const p = lyDoSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };
  const v = await vaoActionDuyet(p.data.dongId);
  if (!v.ok) return v;
  return ra(await duyetHocVuot({ actor: v.actor, nguoi: v.nguoi, dongId: p.data.dongId, lyDo: p.data.lyDo, now: new Date() }));
}
