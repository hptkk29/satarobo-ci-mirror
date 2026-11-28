"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { actionFail, type ActionResult } from "@/lib/actions/factory";
import { isElearningEnabled } from "@/lib/flags";
import { chayThuLuat, type KetQuaChayThu } from "@/lib/elearning/automation-thu";

/**
 * P7 — "Chạy thử trên dữ liệu 7 ngày" của màn Khai luật. CHỈ ĐỌC (không action factory ⇒ không ghi AuditLog, không ghi nhật ký thi hành).
 * Gác như khai luật: `elearning:program:manage`. ⚠️ Tệp `"use server"` chỉ export HÀM async.
 */
const dauVao = z.object({ trigger: z.string().min(1).max(40), conditionJson: z.unknown() }).strict();

export async function chayThuLuatAction(input: unknown): Promise<ActionResult<Extract<KetQuaChayThu, { ok: true }> | { khongHoTro: string }>> {
  const session = await auth();
  if (!session?.user?.id) return actionFail("AUTH", "Chưa đăng nhập");
  if (!isElearningEnabled()) return actionFail("NOT_FOUND", "Không tìm thấy");
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:program:manage")) return actionFail("PERMISSION_DENIED", "Bạn không có quyền chạy thử luật");
  const p = dauVao.safeParse(input);
  if (!p.success) return actionFail("VALIDATION", "Dữ liệu không hợp lệ");
  const r = await chayThuLuat(scopedDb(actor), { trigger: p.data.trigger, conditionJson: p.data.conditionJson, now: new Date() });
  if ("loi" in r) return actionFail("VALIDATION", r.loi);
  if (!r.ok) return { ok: true, data: { khongHoTro: r.khongHoTro } };
  return { ok: true, data: r };
}
