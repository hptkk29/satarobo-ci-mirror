"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { completeCourse } from "@/lib/completion/service";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { buildStudentCourseChain, type StudentCourseChain } from "@/lib/enrollment-flow";

// B4 — đánh dấu hoàn thành khoá + đánh giá cuối khoá (GV/quản lý).

// FL2-06 (LD-7) — dây chuyền HS → khoá đang học → lớp. Trả khoá HV đang theo + lớp
// theo từng khoá để form hoàn thành chọn phụ thuộc (không bắt user tự nhớ khoá/lớp).
export async function listStudentCoursesAction(
  studentId: string,
): Promise<{ ok: boolean; error?: string; chain?: StudentCourseChain[] }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("completions:manage"))) return { ok: false, error: "Không có quyền" };
  if (!studentId) return { ok: false, error: "Thiếu học viên" };

  // Cách ly cơ sở: Student ∈ SCOPED_MODELS → ngoài scope trả null (chống IDOR đọc).
  const sdb = scopedDb(await resolveActor(session.user.id));
  const stu = await sdb.student.findUnique({ where: { id: studentId }, select: { id: true } });
  if (!stu) return { ok: false, error: "Học viên ngoài phạm vi cơ sở" };

  const enrollments = await sdb.enrollment.findMany({
    where: { studentId, deletedAt: null, status: { in: ENROLLMENT_ACTIVE_STATUS_LIST } },
    select: {
      courseId: true,
      classId: true,
      course: { select: { name: true } },
      class: { select: { name: true, classCode: true } },
    },
  });
  return { ok: true, chain: buildStudentCourseChain(enrollments) };
}

const schema = z.object({
  studentId: z.string().min(1, "Thiếu học viên"),
  courseId: z.string().min(1, "Thiếu khoá"),
  classId: z.string().optional().or(z.literal("")),
  finalAssessment: z.string().trim().max(4000).optional().or(z.literal("")),
  finalGrade: z.string().trim().max(50).optional().or(z.literal("")),
});

export async function markCourseCompletion(
  input: unknown,
): Promise<{ ok: boolean; error?: string; certificateCode?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("completions:manage"))) return { ok: false, error: "Không có quyền" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const d = parsed.data;

  // Cách ly cơ sở (chống IDOR ghi): HV (Student ∈ SCOPED_MODELS) + lớp nếu có phải
  // thuộc tầm nhìn cơ sở actor — như bản BULK. scopedDb trả null nếu ngoài scope.
  const sdb = scopedDb(await resolveActor(session.user.id));
  const stu = await sdb.student.findUnique({ where: { id: d.studentId }, select: { id: true } });
  if (!stu) return { ok: false, error: "Học viên ngoài phạm vi cơ sở" };
  if (d.classId) {
    const cls = await sdb.class.findUnique({ where: { id: d.classId }, select: { id: true } });
    if (!cls) return { ok: false, error: "Lớp ngoài phạm vi cơ sở" };
  }

  const res = await completeCourse({
    studentId: d.studentId,
    courseId: d.courseId,
    classId: d.classId || null,
    finalAssessment: d.finalAssessment || null,
    finalGrade: d.finalGrade || null,
    createdById: session.user.id,
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/admin/hoan-thanh-khoa");
  return { ok: true, certificateCode: res.certificateCode };
}

// =============================================================================
// Bulk — hoàn thành khoá hàng loạt theo LỚP. courseId suy từ Class.courseId
// (không hỏi user chọn khoá riêng). Học viên đã có CourseCompletion cho khoá
// này → BỎ QUA (không lỗi). Dùng chung completeCourse() để sinh mã chứng chỉ
// nhất quán với form đơn lẻ.
// =============================================================================

const bulkSchema = z.object({
  classId: z.string().min(1, "Thiếu lớp"),
  studentIds: z.array(z.string().min(1)).min(1, "Chưa chọn học viên nào"),
  finalAssessment: z.string().trim().max(4000).optional().or(z.literal("")),
  finalGrade: z.string().trim().max(50).optional().or(z.literal("")),
});

export type BulkCompleteResult = {
  ok: boolean;
  error?: string;
  created: number;
  skipped: number;
  errors: { studentId: string; error: string }[];
};

export async function bulkCompleteByClass(input: unknown): Promise<BulkCompleteResult> {
  const empty = { created: 0, skipped: 0, errors: [] as { studentId: string; error: string }[] };
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập", ...empty };
  if (!(await checkPermission("completions:manage"))) return { ok: false, error: "Không có quyền", ...empty };

  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ", ...empty };
  const d = parsed.data;

  // scopedDb: cách ly cơ sở — CENTER_MANAGER không thao tác lớp của CS khác.
  const sdb = scopedDb(await resolveActor(session.user.id));

  // courseId suy từ lớp — không tin tưởng client gửi courseId.
  const klass = await sdb.class.findUnique({
    where: { id: d.classId },
    select: { id: true, courseId: true },
  });
  if (!klass) return { ok: false, error: "Lớp không tồn tại", ...empty };

  let created = 0;
  let skipped = 0;
  const errors: { studentId: string; error: string }[] = [];

  // Dedupe danh sách học viên gửi lên.
  const uniqueIds = Array.from(new Set(d.studentIds));

  for (const studentId of uniqueIds) {
    // Đã hoàn thành khoá này → bỏ qua (không upsert/đè).
    const existing = await sdb.courseCompletion.findUnique({
      where: { studentId_courseId: { studentId, courseId: klass.courseId } },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const res = await completeCourse({
      studentId,
      courseId: klass.courseId,
      classId: klass.id,
      finalAssessment: d.finalAssessment || null,
      finalGrade: d.finalGrade || null,
      createdById: session.user.id,
    });
    if (res.ok) created += 1;
    else errors.push({ studentId, error: res.error ?? "Lỗi" });
  }

  revalidatePath("/admin/hoan-thanh-khoa");
  return { ok: true, created, skipped, errors };
}

// ── Duyệt đề xuất hoàn thành khoá do GIÁO VIÊN gửi ───────────────────────────
//
// Nửa còn thiếu của vòng làm việc (QA site GV vòng 1, BUG-028). Giáo viên bấm "Đề xuất
// hoàn thành" ở /teacher/hoan-thanh sinh một CourseCompletionRequest PENDING, nhưng
// hàm duyệt trước đây nằm trong route group của GIÁO VIÊN và KHÔNG CÓ CALLER NÀO trong
// toàn repo — không ai duyệt được, giáo viên cũng không rút lại được (enum chỉ có
// PENDING/APPROVED/REJECTED). Dời về đây cho đúng chủ: đây là hành động của trung tâm.
//
// Logic giữ NGUYÊN như bản cũ, chỉ thêm revalidate cho màn admin.
const reviewSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().max(1000).optional().nullable(),
});

/** CENTER_MANAGER duyệt đề xuất hoàn thành cùng cơ sở → tạo CourseCompletion. */
export async function reviewCourseCompletion(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  // Bản cũ (khi hàm còn nằm ở route group giáo viên) kiểm quyền bằng
  // hasRole(SUPER_ADMIN | CENTER_MANAGER) — vi phạm luật cứng #1 của Nền Hệ thống
  // (mọi kiểm quyền đi qua MỘT cửa) và là lý do file đó phải nằm trong
  // INLINE_AUTHZ_ALLOWLIST. Chuyển sang đúng quyền của hành động, khớp với gate của
  // trang: cùng một `completions:manage`, nên menu, cổng trang và cổng ghi không lệch.
  if (!(await checkPermission("completions:manage"))) {
    return { ok: false, error: "Không có quyền duyệt" };
  }
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  const { id, decision, note } = parsed.data;

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const req = await sdb.courseCompletionRequest.findUnique({
    where: { id },
    select: { status: true, centerId: true, studentId: true, courseId: true },
  });
  // Cách ly cơ sở do chính lượt đọc này lo: `CourseCompletionRequest` có `centerId`
  // nên thuộc SCOPED_MODELS ⇒ scopedDb chèn bộ lọc cơ sở vào findUnique, đề xuất của
  // cơ sở khác trả về null và dừng ngay tại đây. Bản cũ so `req.centerId` với
  // `session.user.centerId` — vừa thừa, vừa đọc cơ sở từ JWT (nguồn quyền là DB, luật
  // cứng #6), vừa sai với người giữ vai ở nhiều cơ sở.
  if (!req) return { ok: false, error: "Không tìm thấy đề xuất" };
  if (req.status !== "PENDING")
    return { ok: false, error: "Đề xuất đã được xử lý" };

  if (decision === "APPROVED") {
    const res = await completeCourse({
      studentId: req.studentId,
      courseId: req.courseId,
      createdById: session.user.id,
    });
    if (!res.ok)
      return { ok: false, error: res.error ?? "Lỗi xác nhận hoàn thành" };
  }

  try {
    await sdb.courseCompletionRequest.update({
      where: { id },
      data: {
        status: decision,
        reviewedById: session.user.id,
        reviewedByName: session.user.name ?? null,
        reviewedAt: new Date(),
        reviewNote: note?.trim() || null,
      },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi duyệt: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  // Cả hai màn: bảng chờ duyệt ở đây, và badge "Chờ duyệt" bên site giáo viên.
  revalidatePath("/hoan-thanh-khoa");
  revalidatePath("/teacher/hoan-thanh");
  return { ok: true };
}
