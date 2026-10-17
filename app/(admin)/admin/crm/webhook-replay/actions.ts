"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { replayDelivery, ReplayError } from "@/lib/crm/webhook-replay";

type Result = { ok: true; created: number } | { ok: false; error: string };

// R1-11 — replay 1 WebhookDelivery FAILED. Chỉ SUPER_ADMIN (settings:edit).
export async function replayAction(deliveryId: string): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("settings:edit"))) return { ok: false, error: "Không có quyền" };
  try {
    const r = await replayDelivery(deliveryId);
    revalidatePath("/admin/crm/webhook-replay");
    return { ok: true, created: r.created };
  } catch (e) {
    return { ok: false, error: e instanceof ReplayError ? e.message : "Lỗi replay" };
  }
}
