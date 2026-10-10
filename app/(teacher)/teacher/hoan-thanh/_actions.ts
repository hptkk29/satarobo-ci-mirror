// app/(teacher)/teacher/hoan-thanh/_actions.ts — Đề xuất hoàn thành khoá (site GV).
// proposeCourseCompletion: GV đề xuất (own-class) → CourseCompletionRequest PENDING.
// Đường DUYỆT nay ở app/(admin)/admin/hoan-thanh-khoa/ (03/09) — trước đó
// reviewCourseCompletion nằm trong file này và KHÔNG CÓ CALLER NÀO trong toàn repo,
// nên mỗi lần GV bấm đề xuất là một dòng PENDING không ai thấy và không ai duyệt được
// (QA vòng 1, BUG-028). GV KHÔNG tự xác nhận hoàn thành (đó là completions:manage).
"use server";

import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/auth/check-permission";

type Result = { ok: true } | { ok: false; error: string };

const proposeSchema = z.object({
  enrollmentId: z.string().min(1),
  note: z.string().max(1000).optional().nullable(),
});

export async function proposeCourseCompletion(input: unknown): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("completions:propose-own"))) {
    return { ok: false, error: "Không có quyền đề xuất hoàn thành khoá" };
  }
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  const { enrollmentId, note } = parsed.data;

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));
  const classIds = [...actor.assignedClassIds];

  // Own-class + thông tin ghi danh đọc QUA quan hệ class (enrollment dev centerId=null
  // bị scopedDb lọc nếu query thẳng).
  const clsMatch = classIds.length
    ? await sdb.class.findMany({
        where: { id: { in: classIds } },
        select: {
          centerId: true,
          enrollments: {
            where: { id: enrollmentId, deletedAt: null },
            select: {
              studentId: true,
              courseId: true,
              course: { select: { nextCourseId: true } },
            },
          },
        },
      })
    : [];
  const hit = clsMatch.find((c) => c.enrollments.length > 0);
  if (!hit)
    return { ok: false, error: "Ghi danh không thuộc lớp bạn phụ trách" };
  const enr = hit.enrollments[0];

  const [existingCompletion, existingReq] = await Promise.all([
    sdb.courseCompletion.findFirst({
      where: { studentId: enr.studentId, courseId: enr.courseId },
      select: { id: true },
    }),
    sdb.courseCompletionRequest.findFirst({
      where: { enrollmentId, status: "PENDING" },
      select: { id: true },
    }),
  ]);
  if (existingCompletion)
    return { ok: false, error: "Học viên đã hoàn thành khoá này" };
  if (existingReq) return { ok: false, error: "Đã có đề xuất đang chờ duyệt" };

  try {
    await sdb.courseCompletionRequest.create({
      data: {
        enrollmentId,
        studentId: enr.studentId,
        courseId: enr.courseId,
        centerId: hit.centerId,
        requesterId: session.user.id,
        nextCourseId: enr.course.nextCourseId ?? null,
        note: note?.trim() || null,
      },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi gửi đề xuất: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath("/teacher/hoan-thanh");
  return { ok: true };
}
