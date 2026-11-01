"use server";

// app/(admin)/admin/ai-lead/_actions.ts — Server Actions của màn «Hồ sơ chờ AI» (lát C).
//
// MỌI action: (1) có phiên → (2) `checkPermission("ai-leads:review")` NGAY ĐẦU → (3) dựng Actor → (4) zod → (5) gọi dịch vụ `duyet.ts`.
// Phạm vi cơ sở + khoá lạc quan + audit nằm ở `duyet.ts` (nơi duy nhất ghi). File này KHÔNG chứa điều kiện quyền/cơ sở nào — layout gate chưa đủ cho Server Action.
// Lỗi HỆ THỐNG được ném tiếp (Sentry bắt); chỉ lỗi nghiệp vụ (`LoiDuyet`) thành `{ ok: false }`.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireLiveSession } from "@/lib/auth/live-session";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import type { ActionResult } from "@/lib/actions/factory";
import {
  baoDaNhanTrongPageInbox,
  botSung,
  chuyenNguoi,
  duyet,
  nhanXuLy,
  traHoSo,
  tuChoi,
  type KetQuaDuyet,
  type NguoiThaoTac,
} from "@/lib/ai-lead/dich-vu/duyet";

const idHoSo = z.string().trim().min(1).max(64);
const phienBan = z.number().int().min(1).max(1_000_000);

const lenhCoBan = z.object({ draftId: idHoSo, version: phienBan }).strict();
const lenhBoSung = z
  .object({
    draftId: idHoSo,
    version: phienBan,
    fbName: z.string().max(200).optional(),
    phone: z.string().max(40).optional(),
    campusCenterId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
const lenhTuChoi = z.object({ draftId: idHoSo, version: phienBan, lyDo: z.string().max(1000) }).strict();
const lenhChuyen = z.object({ draftId: idHoSo, version: phienBan, nguoiNhanId: idHoSo }).strict();

function loi<T>(code: string, message: string, field?: string): ActionResult<T> {
  return { ok: false, error: { code, message, ...(field ? { field } : {}) } };
}

/** Cổng chung: phiên + quyền xử lý + Actor. Quyền hỏi ĐẦU TIÊN (trước cả khi đọc input). */
async function canhGac(): Promise<{ ok: true; nguoi: NguoiThaoTac } | { ok: false; res: ActionResult<never> }> {
  // Phiên phải còn SỐNG so với DB (isActive / deletedAt / tokenVersion): JWT sống 30 ngày và layout chỉ chặn lúc render, không chặn Server Action — nhân sự đã nghỉ hay người giữ cookie cũ sẽ vẫn xử lý được hồ sơ (PII + tạo lead).
  const session = await requireLiveSession();
  if (!session?.user?.id) return { ok: false, res: loi("UNAUTHENTICATED", "Bạn cần đăng nhập lại.") };
  if (!(await checkPermission("ai-leads:review"))) return { ok: false, res: loi("PERMISSION_DENIED", "Bạn không có quyền xử lý hồ sơ AI.") };
  const actor = await resolveActor(session.user.id);
  return { ok: true, nguoi: { actor, ten: session.user.name?.trim() || "Nhân viên" } };
}

function laiKetQua<T>(kq: KetQuaDuyet<T>, draftId: string): ActionResult<T> {
  if (kq.ok) {
    revalidatePath("/ai-lead");
    revalidatePath(`/ai-lead/${draftId}`);
    return { ok: true, data: kq.data };
  }
  return { ok: false, error: kq.error };
}

function loiDauVao(e: z.ZodError): ActionResult<never> {
  const issue = e.issues[0];
  return loi("VALIDATION", issue?.message ?? "Dữ liệu không hợp lệ", issue?.path.join(".") || undefined);
}

export async function nhanXuLyAction(input: unknown) {
  const g = await canhGac();
  if (!g.ok) return g.res;
  const p = lenhCoBan.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  return laiKetQua(await nhanXuLy(g.nguoi, p.data), p.data.draftId);
}

export async function boSungAction(input: unknown) {
  const g = await canhGac();
  if (!g.ok) return g.res;
  const p = lenhBoSung.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  return laiKetQua(await botSung(g.nguoi, p.data), p.data.draftId);
}

export async function duyetAction(input: unknown) {
  const g = await canhGac();
  if (!g.ok) return g.res;
  const p = lenhCoBan.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  const kq = await duyet(g.nguoi, p.data);
  if (kq.ok) revalidatePath("/leads");
  return laiKetQua(kq, p.data.draftId);
}

export async function tuChoiAction(input: unknown) {
  const g = await canhGac();
  if (!g.ok) return g.res;
  const p = lenhTuChoi.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  return laiKetQua(await tuChoi(g.nguoi, p.data), p.data.draftId);
}

export async function chuyenNguoiAction(input: unknown) {
  const g = await canhGac();
  if (!g.ok) return g.res;
  const p = lenhChuyen.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  return laiKetQua(await chuyenNguoi(g.nguoi, p.data), p.data.draftId);
}

export async function traHoSoAction(input: unknown) {
  const g = await canhGac();
  if (!g.ok) return g.res;
  const p = lenhCoBan.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  return laiKetQua(await traHoSo(g.nguoi, p.data), p.data.draftId);
}

export async function baoDaNhanAction(input: unknown) {
  const g = await canhGac();
  if (!g.ok) return g.res;
  const p = lenhCoBan.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  return laiKetQua(await baoDaNhanTrongPageInbox(g.nguoi, p.data), p.data.draftId);
}
