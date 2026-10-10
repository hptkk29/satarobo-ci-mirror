"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { getAuditActor } from "@/lib/audit/log";
import { resolveActor } from "@/lib/auth/actor";
import { getModelVisibleCenterIds } from "@/lib/db-scope";
import { previewHandover, bulkReassignLeads } from "@/lib/lead-handover/service";
import { transferLead } from "../leads/actions";

// C2 — bàn giao lead. Gate leads:assign (SUPER_ADMIN/CENTER_MANAGER).

const filterSchema = z.object({
  statuses: z.array(z.string()).optional(),
  campaign: z.string().optional().or(z.literal("")),
  onlyActive: z.boolean().optional(),
});

const runSchema = filterSchema.extend({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  reason: z.string().trim().max(2000).optional().or(z.literal("")),
});

export async function previewHandoverAction(input: {
  fromUserId: string;
  statuses?: string[];
  campaign?: string;
  onlyActive?: boolean;
}): Promise<{ ok: boolean; error?: string; count?: number }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("leads:assign"))) return { ok: false, error: "Không có quyền" };
  if (!input.fromUserId) return { ok: false, error: "Chọn sale bàn giao" };

  // Cách ly cơ sở: CENTER_MANAGER chỉ thấy/bàn giao lead cơ sở mình; SUPER_ADMIN/HO = ALL.
  const actor = await resolveActor(session.user.id);
  const visibleCenterIds = getModelVisibleCenterIds("Lead", actor);

  const count = await previewHandover(
    input.fromUserId,
    {
      statuses: input.statuses,
      campaign: input.campaign || null,
      onlyActive: input.onlyActive,
    },
    visibleCenterIds,
  );
  return { ok: true, count };
}

export async function runHandoverAction(input: unknown): Promise<{ ok: boolean; error?: string; moved?: number; tasksMoved?: number }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("leads:assign"))) return { ok: false, error: "Không có quyền" };

  const parsed = runSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const d = parsed.data;

  const actor = getAuditActor(session);
  // Cách ly cơ sở: chỉ bàn giao lead trong tầm nhìn cơ sở của actor (CS1 không
  // bàn giao lead CS2). SUPER_ADMIN/HO → "ALL".
  const resolved = await resolveActor(session.user.id);
  const visibleCenterIds = getModelVisibleCenterIds("Lead", resolved);
  const res = await bulkReassignLeads({
    fromUserId: d.fromUserId,
    toUserId: d.toUserId,
    filters: { statuses: d.statuses, campaign: d.campaign || null, onlyActive: d.onlyActive },
    actorId: actor.actorId,
    actorName: actor.actorName,
    reason: d.reason || null,
    visibleCenterIds,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/admin/ban-giao-lead");
  return { ok: true, moved: res.moved, tasksMoved: res.tasksMoved };
}

// ─── Chuyển lead (01/10/2026 — chủ dự án: màn này là nơi SALE chuyển những lead phụ huynh
// đổi nhu cầu, kể cả sang cơ sở khác). KHÔNG viết lại luật chuyển: mỗi lead đi qua ĐÚNG
// `transferLead` của màn chi tiết lead — cùng cổng quyền (leads:edit, Sale chỉ lead của mình),
// cùng cách ly cơ sở, cùng kiểm sale nhận, cùng LeadTransfer/audit/chuông. Hàm này chỉ lặp và
// gom kết quả; lead nào lỗi thì báo lead đó, lead khác vẫn chuyển.

const chuyenNhieuSchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1, "Chọn ít nhất 1 lead").max(50, "Tối đa 50 lead mỗi lượt"),
  toCenterId: z.string().min(1, "Chọn cơ sở nhận"),
  toSaleId: z.string().optional().or(z.literal("")),
  handoverNote: z.string().trim().min(5, "Bắt buộc ghi phụ huynh cần gì / đã tư vấn gì (≥5 ký tự)").max(2000),
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});

export type KetQuaChuyenNhieu =
  | { ok: false; error: string }
  | { ok: true; thanhCong: number; loi: { leadId: string; error: string }[] };

export async function chuyenNhieuLeadAction(input: unknown): Promise<KetQuaChuyenNhieu> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("leads:edit"))) return { ok: false, error: "Không có quyền" };
  const parsed = chuyenNhieuSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const d = parsed.data;

  let thanhCong = 0;
  const loi: { leadId: string; error: string }[] = [];
  // Tuần tự, không song song: mỗi lượt có transaction riêng + có thể chạy máy chia của cơ sở
  // đích (`reassignForCenter`) — chạy song song thì hai lead cùng giành một lượt chia.
  for (const leadId of [...new Set(d.leadIds)]) {
    const kq = await transferLead({
      leadId,
      toCenterId: d.toCenterId,
      toSaleId: d.toSaleId || "",
      handoverNote: d.handoverNote,
      reason: d.reason || "",
    });
    if (kq.ok) thanhCong += 1;
    else loi.push({ leadId, error: kq.error ?? "Không chuyển được" });
  }
  revalidatePath("/ban-giao-lead");
  revalidatePath("/leads");
  return { ok: true, thanhCong, loi };
}
