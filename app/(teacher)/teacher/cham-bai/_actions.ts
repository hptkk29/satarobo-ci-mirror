// app/(teacher)/teacher/cham-bai/_actions.ts — Site GV (L6): "Giao bài".
//
// GV giao 1 template (thư viện admin) cho LỚP MÌNH phụ trách → sinh Assignment
// PUBLISHED + clone câu hỏi (nếu có) + tạo bản nộp NOT_SUBMITTED cho HV active.
//
// BẢO MẬT — khoá 2 lớp:
//   (1) checkPermission("assignments:assign-own") — capability RIÊNG của GV (không
//       phải assignments:create của TRAINING). Xem lib/auth/permissions.ts.
//   (2) classId ∈ actor.assignedClassIds — cấp LỚP (không phải cấp cơ sở): GV chỉ
//       giao vào lớp mình phụ trách, không giao lung tung trong cơ sở.
// KHÔNG import @/lib/db trần (ESLint chặn app/(teacher)/**) — đi qua scopedDb.
// Roster/enrollment đọc QUA quan hệ class (đã guard) — enrollment dev có centerId=null
// bị scopedDb lọc mất khi query trực tiếp (xem ghi chú page.tsx).
"use server";

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { rosterWhere } from "@/lib/enrollment-scope";
import { templateToAssignmentData } from "@/lib/assignments/template";
import { resolveTemplateDup, publishDraftAssignment } from "@/lib/assignments/publish-draft";
import { realDueAt } from "@/lib/lms/assignment-window";
import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import { resolveTemplateOwnerId } from "../kho-bai-tap/_owner";

// BGĐ 31/07 — file+ảnh GV đính kèm thêm khi giao (đã PUT lên R2).
const attachmentSchema = z.object({
  fileUrl: z.string().url("URL tệp không hợp lệ"),
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive().nullable().optional(),
  mimeType: z.string().max(100).nullable().optional(),
});

const schema = z.object({
  templateId: z.string().min(1, "Hãy chọn một đầu bài"),
  classId: z.string().min(1, "Hãy chọn lớp"),
  // Parity 18/08 — gắn bài vào 1 buổi học của lớp (không bắt buộc).
  sessionId: z.string().trim().optional().nullable(),
  // "YYYY-MM-DD" (input date cũ) hoặc "YYYY-MM-DDTHH:MM" (datetime-local) — rỗng = không hạn.
  due: z.string().trim().optional().nullable(),
  // Parity 18/08 — bài KIỂM TRA: thời điểm mở/đóng làm bài ("YYYY-MM-DDTHH:MM").
  openAt: z.string().trim().optional().nullable(),
  closeAt: z.string().trim().optional().nullable(),
  attachments: z.array(attachmentSchema).max(10, "Tối đa 10 tệp đính kèm").default([]),
});

type AssignResult = { ok: true; assignmentId: string } | { ok: false; error: string };

/**
 * "YYYY-MM-DD" → cuối ngày đó theo giờ VN; "YYYY-MM-DDTHH:MM" → đúng phút đó
 * (giờ VN); rỗng/không hợp lệ → null.
 */
function parseDue(due?: string | null): Date | null {
  if (!due) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(due)) {
    const d = new Date(`${due}:00+07:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  const d = new Date(`${due}T23:59:59+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "YYYY-MM-DDTHH:MM" (giờ VN) → Date; rỗng/không hợp lệ → null. */
function parseDateTime(v?: string | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(`${v}:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function assignTemplateAction(input: {
  templateId: string;
  classId: string;
  sessionId?: string | null;
  due?: string | null;
  openAt?: string | null;
  closeAt?: string | null;
  attachments?: {
    fileUrl: string;
    fileName: string;
    fileSize?: number | null;
    mimeType?: string | null;
  }[];
}): Promise<AssignResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { templateId, classId } = parsed.data;

  // Bài KIỂM TRA (CLASSWORK) có khung giờ mở/đóng; dueAt luôn = closeAt để mọi màn
  // cũ đọc dueAt không vỡ. Bài tập về nhà chỉ có hạn nộp.
  const openAt = parseDateTime(parsed.data.openAt);
  const closeAt = parseDateTime(parsed.data.closeAt);
  if ((openAt && !closeAt) || (!openAt && closeAt)) {
    return { ok: false, error: "Hãy nhập đủ thời điểm mở và đóng bài kiểm tra" };
  }
  if (openAt && closeAt && openAt >= closeAt) {
    return { ok: false, error: "Thời điểm đóng phải sau thời điểm mở" };
  }
  const dueAt = closeAt ?? parseDue(parsed.data.due);

  const actor = await resolveActor(session.user.id);

  // (2) Cấp LỚP: chỉ giao vào lớp mình phụ trách (chống IDOR đổi classId trên client).
  if (!actor.assignedClassIds.has(classId)) {
    return { ok: false, error: "Lớp không thuộc bạn phụ trách" };
  }
  // (1) Role có capability giao bài không.
  const allowed = await checkPermission("assignments:assign-own", { classId });
  if (!allowed) return { ok: false, error: "Không có quyền giao bài" };

  const sdb = scopedDb(actorGiangDay(actor));

  // Template thư viện (không có classId — không cần scope cơ sở).
  const template = await sdb.assignmentTemplate.findUnique({
    where: { id: templateId },
    select: {
      id: true,
      title: true,
      description: true,
      instructions: true,
      kind: true,
      lessonId: true,
      totalPoints: true,
      allowText: true,
      allowFile: true,
      // Chống IDOR templateId: đề phải là CỦA MÌNH hoặc thư viện đúng khoá của lớp.
      createdById: true,
      curriculum: { select: { courseId: true } },
      // BGĐ 31/07 — file đề bài có sẵn: copy tham chiếu sang bài giao.
      attachments: {
        select: { fileUrl: true, fileName: true, fileSize: true, mimeType: true, uploadedById: true },
      },
    },
  });
  if (!template) return { ok: false, error: "Không tìm thấy đầu bài" };

  // Roster active + câu hỏi template — đọc QUA quan hệ class (guard) để né null-centerId.
  const cls = await sdb.class.findUnique({
    where: { id: classId },
    select: {
      id: true,
      name: true,
      courseId: true,
      // GIAO BÀI giữ "dang-hoc": bài mới chỉ giao cho em còn đang học. rosterWhere
      // thêm hai tầng lọc vốn thiếu ở đây (deletedAt + student.deletedAt) nên em đã
      // gỡ mềm khỏi lớp không còn bị giao bài.
      enrollments: {
        where: rosterWhere("dang-hoc"),
        select: { studentId: true },
      },
    },
  });
  if (!cls) return { ok: false, error: "Không tìm thấy lớp" };

  // Chống IDOR đổi templateId trên client: chỉ giao đề CỦA MÌNH, hoặc đề thư viện
  // đúng khoá của lớp (đề không gắn khoá dùng chung mọi khoá) — khớp danh sách
  // dialog Giao bài hiển thị.
  const { ownerId } = await resolveTemplateOwnerId(sdb, session.user.id);
  const tplCourseId = template.curriculum?.courseId ?? null;
  if (
    template.createdById !== ownerId &&
    tplCourseId !== null &&
    tplCourseId !== cls.courseId
  ) {
    return { ok: false, error: "Mẫu không thuộc khoá của lớp này" };
  }

  // Buổi học (nếu gắn) phải thuộc ĐÚNG lớp đang giao (chống tiêm sessionId lớp khác).
  let classSessionId: string | null = null;
  if (parsed.data.sessionId) {
    const ses = await sdb.classSession.findFirst({
      where: { id: parsed.data.sessionId, classId },
      select: { id: true },
    });
    if (!ses) return { ok: false, error: "Buổi học không thuộc lớp này" };
    classSessionId = ses.id;
  }

  // 1 template → tối đa 1 bài/lớp (unique [classId, templateId]).
  // ⚠️ Deadlock đã vá: tạo lớp auto-sinh Assignment DRAFT cho mọi template gắn lesson
  // (generateAssignmentsFromTemplates) — GV chọn đúng template đó ở đây từng bị chặn
  // "đã giao rồi" trong khi site GV chỉ list PUBLISHED/CLOSED và không có action
  // publish ⇒ không có cách nào mở bài cho HV. Nay: trùng DRAFT → PUBLISH bản đó
  // (tái dùng semantics publish: status + dueAt + bản nộp NOT_SUBMITTED roster);
  // trùng PUBLISHED/CLOSED → vẫn báo lỗi như cũ.
  const dup = await sdb.assignment.findFirst({
    where: { classId, templateId },
    select: { id: true, status: true },
  });
  const dupResolution = resolveTemplateDup(dup);
  if (dupResolution === "ALREADY_ASSIGNED") {
    return { ok: false, error: "Đầu bài này đã được giao cho lớp rồi" };
  }
  if (dupResolution === "PUBLISH_DRAFT" && dup) {
    // Scope đã gate ở trên (classId ∈ assignedClassIds + dup tìm theo classId đó);
    // helper chỉ là DB effect (Assignment/AssignmentSubmission không thuộc SCOPED_MODELS).
    try {
      await publishDraftAssignment({
        assignmentId: dup.id,
        dueAt,
        openAt,
        closeAt,
        classSessionId,
        studentIds: cls.enrollments.map((e) => e.studentId),
        attachments: parsed.data.attachments,
        uploadedById: session.user.id,
      });
    } catch (err) {
      console.error("[assignTemplateAction] publish draft:", err);
      return { ok: false, error: "Lỗi cơ sở dữ liệu — không giao được bài" };
    }

    // Audit best-effort (không chặn) — cùng action với nhánh tạo mới.
    try {
      const { actorId, actorName } = getAuditActor(session);
      await writeAudit({
        actor: { id: actorId, name: actorName },
        module: "assignments",
        entityType: "Assignment",
        entityId: dup.id,
        action: "assignment.assigned-by-teacher",
        newValues: {
          classId,
          templateId,
          students: cls.enrollments.length,
          publishedDraft: true, // bài DRAFT auto-sinh lúc tạo lớp, GV publish qua Giao bài
        },
      });
    } catch (err) {
      console.error("[assignTemplateAction] audit:", err);
    }

    revalidatePath("/cham-bai");
    revalidatePath("/teacher/cham-bai");
    return { ok: true, assignmentId: dup.id };
  }

  const links = await sdb.assignmentTemplateQuestion.findMany({
    where: { templateId },
    orderBy: { order: "asc" },
    select: {
      question: {
        select: {
          type: true,
          text: true,
          explanation: true,
          imageUrl: true,
          difficulty: true,
          points: true,
          timeLimitSec: true,
          correctAnswer: true,
          meta: true, // Parity 18/08 — payload soạn đề (điền khuyết/ghép cặp/sắp xếp)
          tags: true,
          curriculumId: true,
          courseId: true,
          lessonId: true,
          choices: {
            orderBy: { order: "asc" },
            select: { order: true, text: true, isCorrect: true, imageUrl: true },
          },
        },
      },
    },
  });

  const me = await sdb.user.findUnique({
    where: { id: session.user.id },
    select: { employeeId: true },
  });
  // GV giao bài = bài PUBLISHED ngay (khác admin sinh DRAFT rồi publish riêng).
  const data = {
    ...templateToAssignmentData(template, {
      classId,
      createdById: me?.employeeId ?? null,
      dueAt,
    }),
    status: "PUBLISHED" as const,
    // Parity 18/08 — khung giờ kiểm tra + buổi học gắn kèm.
    openAt,
    closeAt,
    classSessionId,
  };

  let assignmentId: string;
  try {
    assignmentId = await sdb.$transaction(async (tx) => {
      const created = await tx.assignment.create({ data, select: { id: true } });

      // BGĐ 31/07 — đính kèm: file có sẵn của đề (copy tham chiếu) + file GV thêm khi giao.
      const attachRows = [
        ...template.attachments.map((f) => ({
          assignmentId: created.id,
          fileUrl: f.fileUrl,
          fileName: f.fileName,
          fileSize: f.fileSize,
          mimeType: f.mimeType,
          uploadedById: f.uploadedById,
        })),
        ...parsed.data.attachments.map((f) => ({
          assignmentId: created.id,
          fileUrl: f.fileUrl,
          fileName: f.fileName,
          fileSize: f.fileSize ?? null,
          mimeType: f.mimeType ?? null,
          uploadedById: session.user.id,
        })),
      ];
      if (attachRows.length > 0) {
        await tx.assignmentAttachment.createMany({ data: attachRows });
      }

      // Clone câu hỏi template → Question sở hữu của bài giao (isPublic=false).
      for (const { question: q } of links) {
        await tx.question.create({
          data: {
            type: q.type,
            text: q.text,
            explanation: q.explanation,
            imageUrl: q.imageUrl,
            difficulty: q.difficulty,
            points: q.points,
            timeLimitSec: q.timeLimitSec,
            correctAnswer: q.correctAnswer,
            meta: (q.meta ?? undefined) as Prisma.InputJsonValue | undefined,
            tags: q.tags,
            curriculumId: q.curriculumId,
            courseId: q.courseId,
            lessonId: q.lessonId,
            isPublic: false,
            assignmentId: created.id,
            choices: {
              create: q.choices.map((c) => ({
                order: c.order,
                text: c.text,
                isCorrect: c.isCorrect,
                imageUrl: c.imageUrl,
              })),
            },
          },
        });
      }

      // Bản nộp NOT_SUBMITTED cho HV active (để portal HV nộp + hiện "Đã nộp x/y").
      if (cls.enrollments.length > 0) {
        await tx.assignmentSubmission.createMany({
          data: cls.enrollments.map((e) => ({
            assignmentId: created.id,
            studentId: e.studentId,
            status: "NOT_SUBMITTED" as const,
          })),
          skipDuplicates: true,
        });
      }

      return created.id;
    });
  } catch (err) {
    console.error("[assignTemplateAction]", err);
    return { ok: false, error: "Lỗi cơ sở dữ liệu — không giao được bài" };
  }

  // Audit best-effort (không chặn).
  try {
    const { actorId, actorName } = getAuditActor(session);
    await writeAudit({
      actor: { id: actorId, name: actorName },
      module: "assignments",
      entityType: "Assignment",
      entityId: assignmentId,
      action: "assignment.assigned-by-teacher",
      newValues: { classId, templateId, students: cls.enrollments.length },
    });
  } catch (err) {
    console.error("[assignTemplateAction] audit:", err);
  }

  revalidatePath("/cham-bai");
  revalidatePath("/teacher/cham-bai");
  return { ok: true, assignmentId };
}

// ──────────────────────────────────────────────────────────────────────────
// Chấm điểm HÀNG LOẠT — bài KIỂM TRA offline (HV không nộp online).
//
// GV nhập điểm cho từng HV trong roster lớp mình → upsert AssignmentSubmission
// {assignmentId,studentId} sang GRADED. Ô rỗng = bỏ qua (không đụng bản nộp cũ).
//
// BẢO MẬT — cùng khoá 2 lớp như assignTemplateAction (KHÔNG dùng classCenterVisible
// rộng của admin — GV bị siết chặt hơn ở cấp LỚP):
//   (1) checkPermission("assignments:grade") — TEACHER đã có (matrix permissions.ts).
//   (2) assignment.classId ∈ actor.assignedClassIds — chỉ chấm lớp mình phụ trách.
// Thêm: mọi studentId phải ∈ roster ACTIVE của lớp (chống tiêm studentId lạ).
// Roster đọc QUA quan hệ class (đã guard) — né enrollment null-centerId bị scopedDb lọc.
// Câu 46: chỉ đọc studentId (không contact PH).
// ──────────────────────────────────────────────────────────────────────────
const batchGradeSchema = z.object({
  assignmentId: z.string().min(1, "Thiếu mã bài"),
  scores: z
    .array(
      z.object({
        studentId: z.string().min(1),
        score: z.coerce.number().min(0, "Điểm phải ≥ 0"),
      }),
    )
    .min(1, "Chưa nhập điểm cho học viên nào"),
});

type BatchGradeResult = { ok: true; graded: number } | { ok: false; error: string };

export async function gradeBatchAction(input: {
  assignmentId: string;
  scores: { studentId: string; score: number }[];
}): Promise<BatchGradeResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const parsed = batchGradeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { assignmentId, scores } = parsed.data;

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));

  const asg = await sdb.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      classId: true,
      totalPoints: true,
      class: {
        select: {
          // CHẤM BÀI dùng "ket-khoa", KHỚP roster của màn chi tiết (page.tsx). Để
          // "dang-hoc" ở đây thì lớp đã kết khoá cho danh sách rỗng và lệnh chấm hàng
          // loạt lặng lẽ bỏ qua mọi em — giao diện báo thành công, không điểm nào vào.
          enrollments: {
            where: rosterWhere("ket-khoa"),
            select: { studentId: true },
          },
        },
      },
    },
  });
  if (!asg) return { ok: false, error: "Không tìm thấy bài" };

  // (2) Cấp LỚP: chỉ chấm lớp mình phụ trách (chống IDOR đổi assignmentId trên client).
  if (!actor.assignedClassIds.has(asg.classId)) {
    return { ok: false, error: "Bài không thuộc lớp bạn phụ trách" };
  }
  // (1) Role có capability chấm bài không.
  const allowed = await checkPermission("assignments:grade", { classId: asg.classId });
  if (!allowed) return { ok: false, error: "Không có quyền chấm bài" };

  // Chỉ chấm HV đang học của lớp + điểm trong thang.
  const rosterIds = new Set(asg.class.enrollments.map((e) => e.studentId));
  for (const s of scores) {
    if (!rosterIds.has(s.studentId)) {
      return { ok: false, error: "Có học viên không thuộc lớp" };
    }
    if (s.score < 0 || s.score > asg.totalPoints) {
      return { ok: false, error: `Điểm phải trong khoảng 0–${asg.totalPoints}` };
    }
  }

  const me = await sdb.user.findUnique({
    where: { id: session.user.id },
    select: { employeeId: true },
  });
  const gradedById = me?.employeeId ?? null;
  const now = new Date();

  try {
    await sdb.$transaction(async (tx) => {
      for (const s of scores) {
        await tx.assignmentSubmission.upsert({
          where: { assignmentId_studentId: { assignmentId, studentId: s.studentId } },
          update: { status: "GRADED", score: s.score, gradedAt: now, gradedById },
          create: {
            assignmentId,
            studentId: s.studentId,
            status: "GRADED",
            score: s.score,
            gradedAt: now,
            gradedById,
          },
        });
      }
    });
  } catch (err) {
    console.error("[gradeBatchAction]", err);
    return { ok: false, error: "Lỗi cơ sở dữ liệu — không lưu được điểm" };
  }

  revalidatePath("/cham-bai");
  revalidatePath("/teacher/cham-bai");
  return { ok: true, graded: scores.length };
}

// ──────────────────────────────────────────────────────────────────────────
// GIA HẠN "NỘP TRỄ" — mở lại cửa nộp cho bài đã quá hạn (chủ dự án 25/08).
//
// Quá hạn nay TỰ ĐÓNG (suy lúc đọc — lib/lms/assignment-window.ts). Nút này là đường
// duy nhất mở lại: ghi hạn MỚI vào `lateUntil`, KHÔNG BAO GIỜ đụng `dueAt` gốc — sửa
// `dueAt` là xoá luôn dấu vết bài từng trễ, và mọi bản nộp cũ đang mang cờ LATE bỗng
// thành đúng hạn trong học bạ. (Luật này học từ TrnAssignment bên e-learning.)
//
// Gia hạn là NGOẠI LỆ CHÍNH SÁCH nên bắt buộc có lý do + ghi audit, giống ô "Cho phép
// nộp trễ" của lượt giao e-learning.
//
// BẢO MẬT — cùng khoá 2 lớp như 2 action trên:
//   (1) checkPermission("assignments:assign-own") — ai giao được bài thì mở lại được
//       cửa nộp của chính bài đó; KHÔNG đẻ capability mới (seed vai phải chạy tay trên
//       prod, thêm key mới là tính năng chết câm ở nơi chưa seed).
//   (2) assignment.classId ∈ actor.assignedClassIds — chỉ lớp mình phụ trách.
// ──────────────────────────────────────────────────────────────────────────
const lateWindowSchema = z.object({
  assignmentId: z.string().min(1, "Thiếu mã bài"),
  /** "YYYY-MM-DDTHH:MM" — đồng hồ VN (input datetime-local), đọc bằng parseDateTime. */
  lateUntil: z.string().trim().min(1, "Hãy chọn hạn nộp bù"),
  reason: z
    .string()
    .trim()
    .min(5, "Hãy ghi lý do gia hạn (ít nhất 5 ký tự)")
    .max(500, "Lý do tối đa 500 ký tự"),
});

type LateWindowResult = { ok: true } | { ok: false; error: string };

export async function grantLateWindowAction(input: {
  assignmentId: string;
  lateUntil: string;
  reason: string;
}): Promise<LateWindowResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const parsed = lateWindowSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const until = parseDateTime(parsed.data.lateUntil);
  if (!until) return { ok: false, error: "Hạn nộp bù không hợp lệ" };

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));

  const asg = await sdb.assignment.findUnique({
    where: { id: parsed.data.assignmentId },
    select: { id: true, classId: true, status: true, dueAt: true },
  });
  if (!asg) return { ok: false, error: "Không tìm thấy bài" };

  // (2) Cấp LỚP trước (chống IDOR đổi assignmentId trên client), rồi mới tới capability.
  if (!actor.assignedClassIds.has(asg.classId)) {
    return { ok: false, error: "Bài không thuộc lớp bạn phụ trách" };
  }
  // (1) Role có capability giao/mở bài không.
  const allowed = await checkPermission("assignments:assign-own", { classId: asg.classId });
  if (!allowed) return { ok: false, error: "Không có quyền gia hạn bài tập" };

  // Bài chưa giao / đã lưu trữ thì không có ai để gia hạn — HV chưa từng thấy bài.
  if (asg.status === "DRAFT") return { ok: false, error: "Bài chưa giao cho lớp — hãy giao bài trước" };
  if (asg.status === "ARCHIVED") return { ok: false, error: "Bài đã lưu trữ — không gia hạn được" };

  const now = new Date();
  if (until.getTime() <= now.getTime()) {
    return { ok: false, error: "Hạn nộp bù phải ở tương lai" };
  }
  // Hạn bù trước hạn gốc thì cửa gia hạn không bao giờ mở được (bài đóng đúng lúc
  // quá `dueAt`) — chặn ở đây thay vì để GV tưởng đã mở rồi ngồi chờ HV nộp.
  // `realDueAt` là bộ lọc dùng chung, bỏ qua `dueAt` kiểu epoch 1970 của bài seed.
  const hanGoc = realDueAt(asg.dueAt);
  if (hanGoc && until.getTime() <= hanGoc.getTime()) {
    return { ok: false, error: "Hạn nộp bù phải sau hạn nộp gốc" };
  }

  try {
    await sdb.assignment.update({
      where: { id: asg.id },
      data: {
        lateUntil: until,
        lateReason: parsed.data.reason,
        // ⚠️ id NGƯỜI DÙNG (User.id) — KHÁC `createdById` vốn là Employee.id. Cột không
        // có khoá ngoại nên không có gì nhắc, phải nói ở đây kẻo màn sau tra nhầm bảng.
        lateGrantedById: session.user.id,
        lateGrantedAt: now,
        // Bài bị ĐÓNG TAY (admin) thì mở lại NGAY TRONG CÙNG lệnh ghi này. Đây là chỗ
        // duy nhất lật cờ: assignmentWindow() cố ý để `status = CLOSED` thắng cửa gia
        // hạn, nên không lật ở đây là nút gia hạn bấm xong không có tác dụng gì.
        // Bài KHÔNG có hạn gốc lật xong vẫn đóng đúng `lateUntil` — assignmentWindow()
        // lấy `lateUntil` làm mốc đóng cho nhóm này, không rơi lại về "mở mãi".
        ...(asg.status === "CLOSED" ? { status: "PUBLISHED" as const } : {}),
      },
    });
  } catch (err) {
    console.error("[grantLateWindowAction]", err);
    return { ok: false, error: "Lỗi cơ sở dữ liệu — không lưu được gia hạn" };
  }

  try {
    const { actorId, actorName } = getAuditActor(session);
    await writeAudit({
      actor: { id: actorId, name: actorName },
      module: "assignments",
      entityType: "Assignment",
      entityId: asg.id,
      action: "assignment.late-window-granted",
      // Lý do đi vào cột `reason` của AuditLog (đúng chỗ của nó), không nhét vào newValues.
      reason: parsed.data.reason,
      newValues: {
        classId: asg.classId,
        lateUntil: until.toISOString(),
        reopenedFromClosed: asg.status === "CLOSED",
      },
    });
  } catch (err) {
    console.error("[grantLateWindowAction] audit:", err);
  }

  revalidatePath("/cham-bai");
  revalidatePath("/teacher/cham-bai");
  revalidatePath("/teacher/lop"); // tab "Bài tập & Kiểm tra" của Class Hub đọc cùng cột
  return { ok: true };
}

/**
 * Thu hồi cửa nộp bù (bài quay lại tự đóng theo `dueAt`).
 *
 * Có nút này vì gia hạn mà không rút lại được là một cái bẫy: GV gõ nhầm "26/09" thay vì
 * "26/08" là bài mở toang một tháng và không ai đóng được ngoài admin.
 *
 * CỐ Ý không set lại `status = CLOSED` khi bài CÓ hạn gốc: bài trở về PUBLISHED-quá-hạn
 * và assignmentWindow() tự cho ra "Đã đóng". Ghi CLOSED xuống cột sẽ khoá luôn nút gia
 * hạn lần sau ở màn admin.
 *
 * NGOẠI LỆ — bài KHÔNG có hạn gốc thì phải ghi CLOSED. Với nhóm đó `lateUntil` chính là
 * mốc đóng duy nhất, xoá nó đi mà không ghi gì lại là bài rơi về "mở mãi": nút "Thu hồi"
 * làm ngược hẳn điều nó hứa, và mở toang vĩnh viễn một bài admin từng đóng tay (đường
 * DUY NHẤT tới được đây với `dueAt` rỗng là bài admin đã đóng rồi GV mở nộp bù).
 */
export async function revokeLateWindowAction(input: {
  assignmentId: string;
}): Promise<LateWindowResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const parsed = z
    .object({ assignmentId: z.string().min(1, "Thiếu mã bài") })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));

  const asg = await sdb.assignment.findUnique({
    where: { id: parsed.data.assignmentId },
    select: { id: true, classId: true, lateUntil: true, dueAt: true },
  });
  if (!asg) return { ok: false, error: "Không tìm thấy bài" };
  if (!actor.assignedClassIds.has(asg.classId)) {
    return { ok: false, error: "Bài không thuộc lớp bạn phụ trách" };
  }
  const allowed = await checkPermission("assignments:assign-own", { classId: asg.classId });
  if (!allowed) return { ok: false, error: "Không có quyền gia hạn bài tập" };

  // Không có hạn gốc → xoá `lateUntil` là bài mở mãi, nên phải đóng bằng cột `status`.
  // Đòi có `lateUntil` thật để bấm nhầm vào bài chưa từng gia hạn (dữ liệu cũ trên tab
  // đang mở, hoặc gọi thẳng action) không biến "thu hồi" thành "đóng bài".
  const dongLaiBangCot = asg.lateUntil != null && realDueAt(asg.dueAt) == null;

  try {
    await sdb.assignment.update({
      where: { id: asg.id },
      // Xoá cả 4 cột: giữ lại `lateReason` mồ côi thì màn sau in ra lý do của một lần
      // gia hạn không còn hiệu lực. Dấu vết ai-mở-vì-sao nằm ở AuditLog.
      data: {
        lateUntil: null,
        lateReason: null,
        lateGrantedById: null,
        lateGrantedAt: null,
        ...(dongLaiBangCot ? { status: "CLOSED" as const } : {}),
      },
    });
  } catch (err) {
    console.error("[revokeLateWindowAction]", err);
    return { ok: false, error: "Lỗi cơ sở dữ liệu — không thu hồi được gia hạn" };
  }

  try {
    const { actorId, actorName } = getAuditActor(session);
    await writeAudit({
      actor: { id: actorId, name: actorName },
      module: "assignments",
      entityType: "Assignment",
      entityId: asg.id,
      action: "assignment.late-window-revoked",
      oldValues: { lateUntil: asg.lateUntil?.toISOString() ?? null },
      // Ghi rõ lần thu hồi nào có kèm đóng cột `status` — nếu không, sổ audit chỉ thấy
      // "gỡ gia hạn" trong khi bài thực sự chuyển sang CLOSED.
      ...(dongLaiBangCot ? { newValues: { status: "CLOSED" } } : {}),
    });
  } catch (err) {
    console.error("[revokeLateWindowAction] audit:", err);
  }

  revalidatePath("/cham-bai");
  revalidatePath("/teacher/cham-bai");
  revalidatePath("/teacher/lop");
  return { ok: true };
}
