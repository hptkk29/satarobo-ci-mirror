"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { getAuditActor } from "@/lib/audit/log";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";

// Cách ly cơ sở: Notification ∈ SCOPED_MODELS → đọc qua scopedDb (auto null-filter)
// + passesScope trước khi publish/xoá; create chỉ gán centerId trong tầm nhìn actor.

// =============================================================================
// ADMIN NOTIFICATIONS — Phase NHÓM 3
// Tạo / publish / xoá thông báo cho phụ huynh.
// =============================================================================

const createSchema = z
  .object({
    title: z.string().trim().min(3, "Tiêu đề quá ngắn").max(200),
    body: z.string().trim().min(5, "Nội dung quá ngắn").max(5000),
    audience: z.enum(["ALL_PARENTS", "CENTER", "CLASS", "STUDENT"]),
    centerId: z.string().trim().optional().nullable(),
    classId: z.string().trim().optional().nullable(),
    studentId: z.string().trim().optional().nullable(),
    publish: z.boolean().optional(),
  })
  .refine((d) => d.audience !== "CENTER" || !!d.centerId, {
    message: "Chọn cơ sở",
    path: ["centerId"],
  })
  .refine((d) => d.audience !== "CLASS" || !!d.classId, {
    message: "Chọn lớp",
    path: ["classId"],
  })
  .refine((d) => d.audience !== "STUDENT" || !!d.studentId, {
    message: "Chọn học viên",
    path: ["studentId"],
  });

export async function createNotification(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("notifications:manage"))) {
    return { ok: false, error: "Không có quyền" };
  }

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const d = parsed.data;
  const { actorId, actorName } = getAuditActor(session);

  // Cách ly cơ sở: không cho phát thông báo nhắm tới cơ sở/lớp/HV ngoài tầm nhìn actor.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  if (d.audience === "CENTER" && d.centerId) {
    // GHI đối xứng ĐỌC (vá 24/07): scope per-model — role HO không có quyền
    // notifications: không được gửi thông báo nhắm cơ sở ngoài scope.
    if (!passesScope("Notification", { centerId: d.centerId }, actor)) {
      return { ok: false, error: "Không có quyền với cơ sở này" };
    }
  }
  if (d.audience === "CLASS" && d.classId) {
    const cls = await sdb.class.findUnique({ where: { id: d.classId }, select: { centerId: true } });
    if (!cls || !passesScope("Class", cls, actor)) return { ok: false, error: "Không có quyền với lớp này" };
  }
  if (d.audience === "STUDENT" && d.studentId) {
    const st = await sdb.student.findUnique({ where: { id: d.studentId }, select: { centerId: true } });
    if (!st || !passesScope("Student", st, actor)) return { ok: false, error: "Không có quyền với học viên này" };
  }

  await sdb.notification.create({
    data: {
      title: d.title,
      body: d.body,
      audience: d.audience,
      centerId: d.audience === "CENTER" ? d.centerId : null,
      classId: d.audience === "CLASS" ? d.classId : null,
      studentId: d.audience === "STUDENT" ? d.studentId : null,
      isPublished: d.publish ?? true,
      publishedAt: d.publish === false ? null : new Date(),
      createdById: actorId,
      createdByName: actorName,
    },
  });

  revalidatePath("/notifications");
  return { ok: true };
}

export async function toggleNotificationPublish(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("notifications:manage"))) {
    return { ok: false, error: "Không có quyền" };
  }

  // Cách ly cơ sở: chỉ publish/unpublish thông báo trong tầm nhìn cơ sở của actor.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const n = await sdb.notification.findUnique({
    where: { id },
    select: { isPublished: true, centerId: true },
  });
  if (!n || !passesScope("Notification", n, actor)) return { ok: false, error: "Không tìm thấy" };

  const willPublish = !n.isPublished;
  await sdb.notification.update({
    where: { id },
    data: {
      isPublished: willPublish,
      ...(willPublish ? { publishedAt: new Date() } : {}),
    },
  });
  revalidatePath("/notifications");
  return { ok: true };
}

export async function deleteNotification(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("notifications:manage"))) {
    return { ok: false, error: "Không có quyền" };
  }
  // Cách ly cơ sở: chỉ xoá thông báo trong tầm nhìn cơ sở của actor (chống IDOR).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const n = await sdb.notification.findUnique({ where: { id }, select: { centerId: true } });
  if (!n || !passesScope("Notification", n, actor)) {
    return { ok: false, error: "Không tìm thấy" };
  }
  await sdb.notification.delete({ where: { id } }).catch(() => null);
  revalidatePath("/notifications");
  return { ok: true };
}
