"use server";

import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { isCenterChecklistEnabled } from "@/lib/flags";
import { ALL_CHECKLIST_KEYS } from "@/lib/center-checklist";

type Result = { ok: true } | { ok: false; error: string };

const schema = z.object({
  centerId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  flags: z.record(z.string(), z.boolean()),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});

/** Phần 4 — lưu checklist mở/đóng 1 cơ sở 1 ngày. */
export async function saveCenterChecklist(input: unknown): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  // 20/08 — tính năng đã GỠ (cờ mặc định OFF). Layout của segment đã chặn đường VÀO trang,
  // nhưng Server Action là endpoint riêng: tab mở sẵn từ trước lúc tắt cờ, hay POST tay vào
  // action id, vẫn gọi thẳng vào đây mà không đi qua layout ⇒ phải tự chốt, kẻo "đã gỡ" mà
  // dữ liệu checklist vẫn ghi thêm được.
  if (!isCenterChecklistEnabled()) return { ok: false, error: "Tính năng checklist cơ sở đã tắt" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { centerId, note } = parsed.data;

  if (!(await checkPermission("hr_attendance:view", { centerId }))) {
    return { ok: false, error: "Không có quyền" };
  }

  // CENTER_MANAGER (không kèm SUPER_ADMIN) chỉ cơ sở mình.
  const isSuper = hasRole(session.user, "SUPER_ADMIN");
  if (!isSuper && hasRole(session.user, "CENTER_MANAGER") && centerId !== session.user.centerId) {
    return { ok: false, error: "Cơ sở không thuộc phạm vi của bạn" };
  }

  // Chỉ nhận đúng các key hợp lệ.
  const flags: Record<string, boolean> = {};
  for (const k of ALL_CHECKLIST_KEYS) flags[k] = parsed.data.flags[k] === true;

  // Cách ly cơ sở (A0-04): CenterDayChecklist ∈ SCOPED_MODELS → ghi qua scopedDb.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const date = new Date(`${parsed.data.date}T00:00:00`);
  try {
    await sdb.centerDayChecklist.upsert({
      where: { centerId_date: { centerId, date } },
      update: { ...flags, note: note || null, byUserId: session.user.id },
      create: { centerId, date, ...flags, note: note || null, byUserId: session.user.id },
    });
  } catch (err) {
    return { ok: false, error: `Lỗi lưu: ${err instanceof Error ? err.message : "Unknown"}` };
  }
  revalidatePath("/cham-cong/checklist-co-so");
  revalidatePath("/dashboard");
  return { ok: true };
}
