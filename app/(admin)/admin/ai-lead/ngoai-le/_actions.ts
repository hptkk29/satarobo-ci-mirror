"use server";

// app/(admin)/admin/ai-lead/ngoai-le/_actions.ts — Server Actions của màn «Ngoại lệ» (Exception Center).
//
// MỌI action: (1) có phiên → (2) `checkPermission("ai-leads:review")` NGAY ĐẦU → (3) dựng Actor → (4) zod (strict) → (5) gọi dịch vụ `ngoai-le.ts`.
// Phạm vi cơ sở + khoá lạc quan + audit nằm ở dịch vụ (nơi duy nhất ghi). File này KHÔNG chứa điều kiện quyền/cơ sở nào — layout gate chưa đủ cho Server Action.
// Lỗi HỆ THỐNG được ném tiếp (Sentry bắt); chỉ lỗi nghiệp vụ thành `{ ok: false }`.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import type { ActionResult } from "@/lib/actions/factory";
import { danhDauDaXuLy, giaoNguoi, thuLaiTaoLead, type KetQuaNgoaiLe } from "@/lib/ai-lead/dich-vu/ngoai-le";
import type { NguoiThaoTac } from "@/lib/ai-lead/dich-vu/duyet";

const idHoSo = z.string().trim().min(1).max(64);
const phienBan = z.number().int().min(1).max(1_000_000);

const lenhCoLyDo = z.object({ draftId: idHoSo, version: phienBan, lyDo: z.string().max(1000) }).strict();
const lenhGiao = z.object({ draftId: idHoSo, version: phienBan, nguoiNhanId: idHoSo }).strict();

function loi<T>(code: string, message: string, field?: string): ActionResult<T> {
  return { ok: false, error: { code, message, ...(field ? { field } : {}) } };
}

/** Cổng chung: phiên + quyền xử lý + Actor. Quyền hỏi ĐẦU TIÊN (trước cả khi đọc input). */
async function canhGac(): Promise<{ ok: true; nguoi: NguoiThaoTac } | { ok: false; res: ActionResult<never> }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, res: loi("UNAUTHENTICATED", "Bạn cần đăng nhập lại.") };
  if (!(await checkPermission("ai-leads:review"))) return { ok: false, res: loi("PERMISSION_DENIED", "Bạn không có quyền xử lý hồ sơ AI.") };
  const actor = await resolveActor(session.user.id);
  return { ok: true, nguoi: { actor, ten: session.user.name?.trim() || "Nhân viên" } };
}

function laiKetQua<T>(kq: KetQuaNgoaiLe<T>, draftId: string): ActionResult<T> {
  if (kq.ok) {
    revalidatePath("/ai-lead");
    revalidatePath("/ai-lead/ngoai-le");
    revalidatePath(`/ai-lead/${draftId}`);
    return { ok: true, data: kq.data };
  }
  return { ok: false, error: kq.error };
}

function loiDauVao(e: z.ZodError): ActionResult<never> {
  const issue = e.issues[0];
  return loi("VALIDATION", issue?.message ?? "Dữ liệu không hợp lệ", issue?.path.join(".") || undefined);
}

export async function thuLaiTaoLeadAction(input: unknown) {
  const g = await canhGac();
  if (!g.ok) return g.res;
  const p = lenhCoLyDo.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  const kq = await thuLaiTaoLead(g.nguoi, p.data);
  if (kq.ok) revalidatePath("/leads");
  return laiKetQua(kq, p.data.draftId);
}

export async function danhDauDaXuLyAction(input: unknown) {
  const g = await canhGac();
  if (!g.ok) return g.res;
  const p = lenhCoLyDo.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  return laiKetQua(await danhDauDaXuLy(g.nguoi, p.data), p.data.draftId);
}

export async function giaoNguoiAction(input: unknown) {
  const g = await canhGac();
  if (!g.ok) return g.res;
  const p = lenhGiao.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  return laiKetQua(await giaoNguoi(g.nguoi, p.data), p.data.draftId);
}
