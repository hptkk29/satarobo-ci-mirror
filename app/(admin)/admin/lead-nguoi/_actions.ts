"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { getAuditActor } from "@/lib/audit/log";
import { resolveActor } from "@/lib/auth/actor";
import { getModelVisibleCenterIds } from "@/lib/db-scope";
import { chuanNguong } from "@/lib/lead/lead-nguoi";
import {
  phanBoLaiLeadNguoi,
  type CachPhanBo,
} from "@/lib/lead/nguoi-service";

// Lead nguội — gate `leads:assign`, cùng quyền với màn Bàn giao lead: cả hai đều là thao tác
// ĐỔI CHỦ hàng loạt, nên không có lý do để hai màn đòi hai quyền khác nhau.

const locSchema = z.object({
  nguongNgay: z.union([z.number(), z.string()]).optional(),
  centerId: z.string().optional().or(z.literal("")),
  trang: z.number().int().min(1).max(100_000).optional(),
  soDong: z.number().int().optional(),
});

const phanBoSchema = locSchema.extend({
  leadIds: z.array(z.string().min(1)).min(1).max(500),
  cach: z.discriminatedUnion("kieu", [
    z.object({ kieu: z.literal("vong") }),
    z.object({ kieu: z.literal("nguoi"), nhanId: z.string().min(1) }),
  ]),
  // ⚠️ BẮT BUỘC, không cho rỗng. Đây là thao tác giật lead khỏi tay người khác; ba tháng sau
  // người bị giật hỏi "vì sao" thì phải có câu trả lời, không phải một dòng log trống.
  lyDo: z.string().trim().min(3).max(2000),
});

export async function phanBoLeadNguoiAction(input: unknown): Promise<{
  ok: boolean;
  error?: string;
  daChia?: number;
  boQua?: { leadId: string; lyDo: string }[];
}> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("leads:assign"))) return { ok: false, error: "Không có quyền" };

  const parsed = phanBoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const actor = await resolveActor(session.user.id);
  const visibleCenterIds = getModelVisibleCenterIds("Lead", actor);
  const { actorId, actorName } = getAuditActor(session);

  const kq = await phanBoLaiLeadNguoi({
    leadIds: parsed.data.leadIds,
    cach: parsed.data.cach as CachPhanBo,
    now: new Date(),
    nguongNgay: chuanNguong(parsed.data.nguongNgay),
    visibleCenterIds,
    actorId,
    actorName,
    lyDo: parsed.data.lyDo,
  });

  revalidatePath("/leads");
  revalidatePath("/lead-nguoi");
  return { ok: true, daChia: kq.daChia, boQua: kq.boQua };
}
