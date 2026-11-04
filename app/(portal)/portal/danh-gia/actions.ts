"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getPortalContext } from "@/lib/portal/session";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";

// Phase NHÓM 3 — phụ huynh gửi đánh giá (gắn với con đang chọn).
const schema = z.object({
  rating: z.number().int().min(1).max(5),
  content: z.string().trim().min(5, "Vui lòng nhập nội dung").max(2000),
});

export async function createParentFeedback(input: {
  rating: number;
  content: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getPortalContext();
  if (!ctx) return { ok: false, error: "Chưa đăng nhập" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }

  // ParentFeedback KHÔNG thuộc SCOPED_MODELS → scopedDb pass-through (portal cách ly
  // bằng ownership: parentUserId/activeStudent đã verify trong getPortalContext).
  const sdb = scopedDb(await resolveActor(ctx.parentUserId));
  await sdb.parentFeedback.create({
    data: {
      parentUserId: ctx.parentUserId,
      parentName: ctx.parentName,
      studentId: ctx.activeStudent?.id ?? null,
      studentName: ctx.activeStudent?.name ?? null,
      rating: parsed.data.rating,
      content: parsed.data.content,
    },
  });

  revalidatePath("/portal/danh-gia");
  revalidatePath("/parent-feedback");
  return { ok: true };
}
