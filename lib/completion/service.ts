import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email/queue";

// =============================================================================
// Cụm B4 — hoàn thành khoá: tạo CourseCompletion + gợi ý khoá tiếp + care task
// tái tục + email + (END_COURSE survey đã hiển thị ở portal).
// =============================================================================

function genCertCode(): string {
  const d = new Date();
  const yymmdd =
    String(d.getFullYear()).slice(2) +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");
  // 4 ký tự ngẫu nhiên (không cần crypto mạnh cho mã chứng chỉ).
  const rand = Math.abs(Date.now() % 1_000_000).toString(36).slice(-4).toUpperCase().padStart(4, "X");
  return `CERT-${yymmdd}-${rand}`;
}

/**
 * Gợi ý khoá tiếp theo:
 *  1) Ưu tiên CoursePrerequisite (khoá mà khoá hiện tại là TIÊN QUYẾT).
 *  2) P1-2 fallback (khi CHƯA cấu hình tiên quyết): suy luận theo trình tự khoá —
 *     2a. slug dạng "...N" → "...N+1" (sata3 → sata4); 2b. cùng category,
 *     displayOrder kế tiếp. Không tạo model mới.
 */
async function suggestNextCourse(courseId: string): Promise<string | null> {
  const prereq = await db.coursePrerequisite.findFirst({
    where: { requiredCourseId: courseId },
    select: { courseId: true },
  });
  if (prereq) return prereq.courseId;

  const cur = await db.course.findUnique({
    where: { id: courseId },
    select: { slug: true, category: true, displayOrder: true },
  });
  if (!cur) return null;

  // 2a. slug có hậu tố số: sata3 → sata4.
  const m = cur.slug.match(/^(.*?)(\d+)$/);
  if (m) {
    const nextSlug = `${m[1]}${Number(m[2]) + 1}`;
    const bySlug = await db.course.findUnique({ where: { slug: nextSlug }, select: { id: true } });
    if (bySlug) return bySlug.id;
  }

  // 2b. cùng category, displayOrder lớn hơn gần nhất.
  if (cur.category) {
    const next = await db.course.findFirst({
      where: { category: cur.category, displayOrder: { gt: cur.displayOrder } },
      orderBy: { displayOrder: "asc" },
      select: { id: true },
    });
    if (next) return next.id;
  }

  return null;
}

export async function completeCourse(params: {
  studentId: string;
  courseId: string;
  classId?: string | null;
  finalAssessment?: string | null;
  finalGrade?: string | null;
  createdById?: string | null;
}): Promise<{ ok: boolean; completionId?: string; certificateCode?: string; error?: string }> {
  const [student, course] = await Promise.all([
    db.student.findUnique({
      where: { id: params.studentId },
      select: { id: true, name: true, centerId: true, parentUser: { select: { email: true, name: true } } },
    }),
    db.course.findUnique({ where: { id: params.courseId }, select: { id: true, name: true } }),
  ]);
  if (!student) return { ok: false, error: "Học viên không tồn tại" };
  if (!course) return { ok: false, error: "Khoá không tồn tại" };

  const nextCourseId = await suggestNextCourse(params.courseId);

  const completion = await db.courseCompletion.upsert({
    where: { studentId_courseId: { studentId: params.studentId, courseId: params.courseId } },
    update: {
      finalAssessment: params.finalAssessment ?? undefined,
      finalGrade: params.finalGrade ?? undefined,
      nextCourseId,
    },
    create: {
      studentId: params.studentId,
      courseId: params.courseId,
      classId: params.classId ?? null,
      finalAssessment: params.finalAssessment ?? null,
      finalGrade: params.finalGrade ?? null,
      certificateCode: genCertCode(),
      nextCourseId,
      createdById: params.createdById ?? null,
    },
    select: { id: true, certificateCode: true },
  });

  // Care task tái tục cho SALES_CSM cơ sở.
  const csm = await db.user.findFirst({
    where: { roles: { has: "SALES_CSM" }, isActive: true, deletedAt: null, ...(student.centerId ? { centerId: student.centerId } : {}) },
    select: { id: true },
  });
  await db.studentCareTask.create({
    data: {
      studentId: student.id,
      centerId: student.centerId,
      assignedToId: csm?.id ?? null,
      title: `Tư vấn tái đăng ký sau khoá ${course.name} — ${student.name}`,
      description: "Học viên vừa hoàn thành khoá — tư vấn khoá tiếp theo.",
      dueAt: new Date(Date.now() + 3 * 86400000),
    },
  }).catch(() => {});

  // Email hoàn thành khoá (A2) + mời khảo sát.
  if (student.parentUser?.email) {
    await enqueueEmail({
      to: student.parentUser.email,
      toName: student.parentUser.name ?? undefined,
      // B1.5: template DB (admin sửa ở /admin/email-templates) — inline dưới là fallback.
      templateKey: "COURSE_COMPLETION",
      vars: {
        parentName: student.parentUser.name ?? "quý phụ huynh",
        studentName: student.name,
        courseName: course.name,
        certificateCode: completion.certificateCode,
      },
      subject: `Chúc mừng bé ${student.name} hoàn thành khoá ${course.name}`,
      bodyText: `Chào ${student.parentUser.name ?? "quý phụ huynh"},\nBé ${student.name} đã hoàn thành khoá ${course.name}. Mã chứng chỉ: ${completion.certificateCode}.\nMời quý phụ huynh làm khảo sát cuối khoá tại cổng học viên (mục Khảo sát).\n— Sata Robo`,
      bodyHtml: `<div style="font-family:system-ui,sans-serif">
        <h2 style="color:#F97316">Chúc mừng hoàn thành khoá!</h2>
        <p>Bé <b>${student.name}</b> đã hoàn thành khoá <b>${course.name}</b>.</p>
        <p>Mã chứng chỉ: <b>${completion.certificateCode}</b></p>
        <p>Mời quý phụ huynh làm <b>khảo sát cuối khoá</b> tại cổng học viên (mục Khảo sát).</p>
      </div>`,
      context: { type: "COURSE_COMPLETION", id: completion.id },
    }).catch(() => {});
  }

  return { ok: true, completionId: completion.id, certificateCode: completion.certificateCode };
}
