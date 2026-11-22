"use server";

// TRUNG TÂM KẾT NỐI AI (lát K) — Server Actions. ĐĂNG NHẬP → QUYỀN (ngay đầu thân) → zod → dịch vụ (`lib/ai-lead/dich-vu/ket-noi.ts`).
//
// Quyền: thăm dò · ghi nhận lần chạy · ghi nhận L2 → `ai-integration:manage` (Quản trị tối cao).
//        xử lý sự cố (nhận · giao · đóng · mở lại) → `ai-leads:configure` HOẶC `ai-integration:manage` (Marketing HO cùng xử lý sự cố, không giữ khoá).
// Công tắc khẩn (tắt Agent) và tạm dừng Page KHÔNG lặp ở đây: dùng lại `datHoatDongAgentAction` / `datTrangThaiPageAction` của màn Cấu hình — một đường ghi, một nơi gác.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireLiveSession } from "@/lib/auth/live-session";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { getAuditActor } from "@/lib/audit/log";
import type { KetQua, NguoiThaoTac } from "@/lib/ai-lead/dich-vu/cau-hinh";
import { loiDauTien } from "@/lib/ai-lead/dich-vu/cau-hinh-thuan";
import { chuyenTrangThaiSuCo, ghiLanChay, phatHanhThamDo } from "@/lib/ai-lead/dich-vu/ket-noi";
import { bangChungSchema, LOAI_THEO_TANG } from "@/lib/ai-lead/dich-vu/ket-noi-thuan";
import { RE } from "@/lib/ai-lead/hop-dong";

type Cong = { ok: true; ng: NguoiThaoTac } | { ok: false; error: string };

async function vaoCong(quyen: readonly string[], loiQuyen: string): Promise<Cong> {
  // Phiên phải còn SỐNG so với DB (isActive / deletedAt / tokenVersion): JWT sống 30 ngày và layout chỉ chặn lúc render, không chặn Server Action.
  const session = await requireLiveSession();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkAnyPermission(quyen))) return { ok: false, error: loiQuyen };
  const { actorId, actorName } = getAuditActor(session);
  return { ok: true, ng: { userId: actorId ?? session.user.id, userName: actorName } };
}

const MANAGE = ["ai-integration:manage"] as const;
const XU_LY = ["ai-leads:configure", "ai-integration:manage"] as const;
const LOI_MANAGE = "Chỉ Quản trị tối cao (quyền ai-integration:manage) làm được thao tác này.";
const LOI_XU_LY = "Bạn không có quyền xử lý sự cố AI Lead (ai-leads:configure hoặc ai-integration:manage).";

const id = z.string().regex(/^[a-z0-9]{20,40}$/, "Mã không hợp lệ");

function lamMoi() {
  for (const p of ["/admin/ai-lead/ket-noi", "/ai-lead/ket-noi"]) revalidatePath(p);
}

export async function phatHanhThamDoAction(input: unknown): Promise<KetQua<{ probeId: string; expiresAt: Date }>> {
  const c = await vaoCong(MANAGE, LOI_MANAGE);
  if (!c.ok) return c;
  const p = z.strictObject({ agentId: id }).safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await phatHanhThamDo(c.ng, p.data, new Date());
  if (r.ok) lamMoi();
  return r;
}

const ghiLanChaySchema = z.strictObject({
  agentId: id.nullable(),
  level: z.enum(["L1", "L2", "L3", "L4"]),
  status: z.enum(["PASS", "FAIL", "BLOCKED", "NOT_RUN", "MOCK_ONLY", "STALE"]),
  contractHash: z.string().trim().regex(RE.contractHash, "contractHash gồm 64 ký tự hex thường").optional(),
  buildSha: z.string().trim().regex(RE.buildSha, "buildSha gồm 7–40 ký tự hex thường").optional(),
  correlationId: z.string().trim().regex(RE.correlationId, "correlationId phải là UUID").optional(),
  bangChung: bangChungSchema,
  lyDo: z.string(),
});

export async function ghiLanChayAction(input: unknown): Promise<KetQua<{ runId: string }>> {
  const c = await vaoCong(MANAGE, LOI_MANAGE);
  if (!c.ok) return c;
  const p = ghiLanChaySchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await ghiLanChay(c.ng, { ...p.data, kind: LOAI_THEO_TANG[p.data.level] }, new Date());
  if (r.ok) lamMoi();
  return r;
}

export async function xuLySuCoAction(input: unknown): Promise<KetQua<object>> {
  const c = await vaoCong(XU_LY, LOI_XU_LY);
  if (!c.ok) return c;
  const p = z
    .strictObject({
      id: z.string().min(1).max(64),
      hanhDong: z.enum(["ACK", "GIAO", "BO_GIAO", "DONG", "MO_LAI"]),
      assigneeId: z.string().min(1).max(64).optional(),
      lyDo: z.string().max(500).optional(),
    })
    .safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await chuyenTrangThaiSuCo(c.ng, p.data, new Date());
  if (r.ok) lamMoi();
  return r;
}
