"use server";

// LMS-15 — Admin (GV/Manager) trả lời tin nhắn của PH theo enrollment.
// Server-action mỏng: auth + quyền (classes:view) + owner/scope check.
// TEACHER: chỉ lớp được phân công (actor.assignedClassIds).
// CENTER_MANAGER/SUPER_ADMIN: theo scopedDb (cách ly cơ sở).
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { postMessage } from "@/lib/conversation/service";

const sendSchema = z.object({
  enrollmentId: z.string().min(1),
  body: z.string().trim().min(1, "Vui lòng nhập nội dung").max(2000, "Tin nhắn tối đa 2000 ký tự"),
});

/**
 * Actor có phụ trách lớp chứa enrollment này không?
 * Teacher → lớp ∈ assignedClassIds; Manager/Super → lớp ∈ scope cơ sở (scopedDb).
 *
 * ⚠️ KHÔNG export: file 'use server' — mọi export async thành PUBLIC endpoint.
 * Hàm nhận `actor` từ THAM SỐ (không auth() bên trong) nên nếu export, client
 * gọi được với actor GIẢ (isSuperAdmin:true) → oracle dò enrollmentId cross-center.
 */
async function staffOwnsEnrollment(
  actor: Actor,
  enrollmentId: string,
): Promise<boolean> {
  // Enrollment ∈ SCOPED_MODELS (#03 Pha B) → sdb.findUnique trả null nếu ngoài cơ sở của
  // actor (chống IDOR). Nhánh GV bên dưới vẫn đúng: assignedClassIds lấy từ lớp GV đứng tên
  // (actor.ts:185) nên luôn cùng cơ sở.
  const enr = await scopedDb(actor).enrollment.findUnique({
    where: { id: enrollmentId },
    select: { classId: true },
  });
  if (!enr) return false;

  // GV được phân công lớp (chính/trợ giảng).
  if (actor.assignedClassIds.has(enr.classId)) return true;

  // Manager/Super: lớp phải nằm trong cơ sở actor thấy (scopedDb → null nếu ngoài scope).
  if (await checkPermission("classes:view-all")) {
    const cls = await scopedDb(actor).class.findUnique({
      where: { id: enr.classId },
      select: { id: true },
    });
    return !!cls;
  }
  return false;
}

export async function sendStaffMessage(input: {
  enrollmentId: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const actor = await resolveActor(session.user.id);
  if (
    !(await checkPermission("classes:view-all")) &&
    !(await checkPermission("classes:view-own"))
  ) {
    return { ok: false, error: "Không có quyền" };
  }

  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  if (!(await staffOwnsEnrollment(actor, parsed.data.enrollmentId))) {
    return { ok: false, error: "Bạn không phụ trách lớp của học viên này" };
  }

  try {
    await postMessage({
      enrollmentId: parsed.data.enrollmentId,
      authorUserId: session.user.id,
      authorSide: "STAFF",
      body: parsed.data.body,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Lỗi gửi tin nhắn" };
  }

  revalidatePath("/tin-nhan");
  return { ok: true };
}
