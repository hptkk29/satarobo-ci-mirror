"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";

// P1-g — admin phản hồi lại đánh giá phụ huynh.
const schema = z.object({
  id: z.string().min(1),
  response: z.string().trim().min(1, "Nhập nội dung phản hồi").max(2000),
});

export async function respondToFeedback(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("parent-feedback:view"))) return { ok: false, error: "Không có quyền" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

  // Cách ly cơ sở: ParentFeedback.studentId là cột phẳng (không FK). Nếu có gắn HV →
  // HV phải thuộc tầm nhìn actor; feedback ẩn danh (studentId=null) → cho qua.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const fb = await sdb.parentFeedback.findUnique({
    where: { id: parsed.data.id },
    select: { studentId: true },
  });
  if (!fb) return { ok: false, error: "Không tìm thấy đánh giá" };
  if (fb.studentId && !actor.isSuperAdmin) {
    // Student ∈ SCOPED_MODELS: sdb.findUnique trả null nếu HV ngoài tầm nhìn (hoặc đã
    // xoá) → deny. Khớp trang list (chỉ hiện feedback của HV trong tầm nhìn).
    // Vá 24/07: bỏ bypass isHoLevel trần — scoped read đã per-model (HO đúng chức năng
    // vẫn ALL; role HO khác chức năng theo scope).
    const st = await sdb.student.findUnique({
      where: { id: fb.studentId },
      select: { id: true },
    });
    if (!st) return { ok: false, error: "Không tìm thấy đánh giá" };
  }

  await sdb.parentFeedback.update({
    where: { id: parsed.data.id },
    data: {
      adminResponse: parsed.data.response,
      respondedById: session.user.id ?? null,
      respondedAt: new Date(),
    },
  });
  revalidatePath("/parent-feedback");
  return { ok: true };
}
