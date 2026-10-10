"use server";

import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { TeacherRank, EmploymentType, TeacherStatus } from "@prisma/client";
import type { Prisma, Role } from "@prisma/client";
import { reconcileUserOrgRoles, OrgRoleSyncError } from "@/lib/auth/org-role-sync";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { syncConversationMembership } from "@/lib/chat/sync-membership";

type Result = { ok: true } | { ok: false; error: string };

// Gác quyền quản lý GV: SUPER_ADMIN/HR toàn quyền; CENTER_MANAGER chỉ trong cơ sở mình.
// Cách ly cơ sở (A0-04): Class ∈ SCOPED_MODELS → đọc qua scopedDb (trả kèm sdb);
// TeacherProfile/TeacherReview/User không scope — cách ly qua gate employees:edit.
async function requireTeacherManager(targetUserId: string) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Chưa đăng nhập" };
  const sdb = scopedDb(await resolveActor(session.user.id));

  // employees:edit có cả tầng GLOBAL (HO_HR) và CENTER (CENTER_HR) — truyền
  // centerId của GV đích để v2 đánh giá đúng nhánh CENTER.
  const target = await sdb.user.findUnique({
    where: { id: targetUserId },
    select: { centerId: true },
  });
  if (!(await checkPermission("employees:edit", { centerId: target?.centerId ?? null }))) {
    return { ok: false as const, error: "Không có quyền quản lý giáo viên" };
  }
  if (hasRole(session.user, "CENTER_MANAGER")) {
    if (!target || target.centerId !== session.user.centerId) {
      return { ok: false as const, error: "Giáo viên không thuộc cơ sở của bạn" };
    }
  }
  return { ok: true as const, session, sdb };
}

const profileSchema = z.object({
  userId: z.string().min(1),
  rank: z.nativeEnum(TeacherRank),
  employmentType: z.nativeEnum(EmploymentType),
  status: z.nativeEnum(TeacherStatus),
  bio: z.string().trim().max(2000).optional().or(z.literal("")),
  courseIds: z.array(z.string().min(1)).max(50),
});

/** FIX 10 phần 1 — lưu hồ sơ chuyên môn + khoá dạy được. */
export async function updateTeacherProfile(input: unknown): Promise<Result> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { userId, rank, employmentType, status, bio, courseIds } = parsed.data;

  const gate = await requireTeacherManager(userId);
  if (!gate.ok) return gate;

  const teacher = await gate.sdb.user.findUnique({
    where: { id: userId },
    select: { role: true, roles: true, orgUnitId: true, centerId: true },
  });
  if (!teacher) return { ok: false, error: "Không tìm thấy người dùng" };

  // P1-b: lưu/duyệt hồ sơ GV → ĐẢM BẢO vai trò TEACHER có trong roles[] (đa vai
  // trò 3B). User cũ chỉ có role chính = TEACHER cũng được đồng bộ vào roles[].
  const needsTeacherRole = !hasRole(teacher, "TEACHER");
  // Đây là đường THỨ TƯ cấp vai TEACHER → cũng phải sinh UserOrgRole, nếu không GV lại
  // rơi vào ca 07/08/2026: có roles[] mà RBAC v2 rỗng quyền (không điểm danh được).
  const previousRoles: Role[] =
    teacher.roles.length > 0 ? teacher.roles : [teacher.role];
  const anchorOrgUnitId =
    teacher.orgUnitId ?? (await orgUnitIdForCenter(teacher.centerId));

  try {
    await gate.sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      if (needsTeacherRole) {
        const nextRoles = Array.from(new Set<Role>([...teacher.roles, "TEACHER"]));
        await tx.user.update({
          where: { id: userId },
          data: { roles: { set: nextRoles } },
        });
        await reconcileUserOrgRoles({
          tx,
          userId,
          previous: { roles: previousRoles, orgUnitId: anchorOrgUnitId },
          next: { roles: nextRoles, orgUnitId: anchorOrgUnitId },
          actorId: gate.session.user.id ?? null,
          actorName: gate.session.user.name ?? gate.session.user.email ?? "Unknown",
          reason: "Tự động gán khi lưu hồ sơ giáo viên",
        });
      }
      const profile = await tx.teacherProfile.upsert({
        where: { userId },
        update: { rank, employmentType, status, bio: bio || null },
        create: { userId, rank, employmentType, status, bio: bio || null },
        select: { id: true },
      });
      // Thay toàn bộ khoá dạy được.
      await tx.teacherCourse.deleteMany({ where: { teacherProfileId: profile.id } });
      if (courseIds.length > 0) {
        await tx.teacherCourse.createMany({
          data: courseIds.map((courseId) => ({
            teacherProfileId: profile.id,
            courseId,
          })),
          skipDuplicates: true,
        });
      }
    });
  } catch (err) {
    if (err instanceof OrgRoleSyncError) return { ok: false, error: err.message };
    return {
      ok: false,
      error: `Lỗi lưu hồ sơ: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath("/teachers");
  revalidatePath(`/teachers/${userId}`);
  return { ok: true };
}

// ── PHẦN 2 — phân công lớp ────────────────────────────────────────────────

const assignSchema = z.object({
  classId: z.string().min(1),
  teacherUserId: z.string().min(1),
  as: z.enum(["teacher", "assistant"]),
});

/** Gán GV làm GV chính / trợ giảng cho 1 lớp. */
export async function assignClassToTeacher(input: unknown): Promise<Result> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { classId, teacherUserId, as } = parsed.data;

  const gate = await requireTeacherManager(teacherUserId);
  if (!gate.ok) return gate;

  const cls = await gate.sdb.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: { id: true, centerId: true },
  });
  if (!cls) return { ok: false, error: "Lớp không tồn tại" };
  if (hasRole(gate.session.user, "CENTER_MANAGER") && cls.centerId !== gate.session.user.centerId) {
    return { ok: false, error: "Lớp không thuộc cơ sở của bạn" };
  }

  try {
    // US-03 chat — gán GV/TA vào lớp phải vào nhóm lớp trong CÙNG transaction (BR-12).
    await gate.sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      await tx.class.update({
        where: { id: classId },
        data: as === "teacher" ? { teacherId: teacherUserId } : { assistantId: teacherUserId },
      });
      await syncConversationMembership(tx, classId);
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch (err) {
    return { ok: false, error: `Lỗi gán lớp: ${err instanceof Error ? err.message : "Unknown"}` };
  }

  revalidatePath(`/teachers/${teacherUserId}`);
  revalidatePath("/teachers");
  revalidatePath(`/classes/${classId}/edit`);
  return { ok: true };
}

// ── PHẦN 6 — đánh giá nội bộ ──────────────────────────────────────────────

const reviewSchema = z.object({
  userId: z.string().min(1),
  score: z.coerce.number().int().min(1).max(5),
  // Bắt buộc nội dung → chống tạo nhầm đánh giá rỗng (chỉ có sao).
  note: z.string().trim().min(5, "Nhập nội dung nhận xét (tối thiểu 5 ký tự)").max(2000),
});

/** Ghi 1 đánh giá nội bộ/dự giờ cho GV. */
export async function addTeacherReview(input: unknown): Promise<Result> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { userId, score, note } = parsed.data;

  const gate = await requireTeacherManager(userId);
  if (!gate.ok) return gate;

  try {
    const profile = await gate.sdb.teacherProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
      select: { id: true },
    });
    await gate.sdb.teacherReview.create({
      data: {
        teacherProfileId: profile.id,
        reviewerId: gate.session.user.id ?? null,
        reviewerName: gate.session.user.name ?? gate.session.user.email ?? "Quản lý",
        score,
        note: note || null,
      },
    });
  } catch (err) {
    return { ok: false, error: `Lỗi lưu đánh giá: ${err instanceof Error ? err.message : "Unknown"}` };
  }

  revalidatePath(`/teachers/${userId}`);
  return { ok: true };
}

const unassignSchema = z.object({
  classId: z.string().min(1),
  teacherUserId: z.string().min(1),
  as: z.enum(["teacher", "assistant"]),
});

/** Gỡ GV khỏi lớp (chính / trợ giảng). */
export async function unassignClassFromTeacher(input: unknown): Promise<Result> {
  const parsed = unassignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { classId, teacherUserId, as } = parsed.data;

  const gate = await requireTeacherManager(teacherUserId);
  if (!gate.ok) return gate;

  const cls = await gate.sdb.class.findUnique({
    where: { id: classId },
    select: { centerId: true, teacherId: true, assistantId: true },
  });
  if (!cls) return { ok: false, error: "Lớp không tồn tại" };
  if (hasRole(gate.session.user, "CENTER_MANAGER") && cls.centerId !== gate.session.user.centerId) {
    return { ok: false, error: "Lớp không thuộc cơ sở của bạn" };
  }

  try {
    // US-03 chat — gỡ GV/TA khỏi lớp: leftAt + SYSTEM message trong CÙNG transaction
    // (US-03 AC2 / F-KICK bước 1).
    await gate.sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      await tx.class.update({
        where: { id: classId },
        data: as === "teacher" ? { teacherId: null } : { assistantId: null },
      });
      await syncConversationMembership(tx, classId);
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch (err) {
    return { ok: false, error: `Lỗi gỡ lớp: ${err instanceof Error ? err.message : "Unknown"}` };
  }

  revalidatePath(`/teachers/${teacherUserId}`);
  revalidatePath("/teachers");
  revalidatePath(`/classes/${classId}/edit`);
  return { ok: true };
}
