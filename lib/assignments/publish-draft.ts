// lib/assignments/publish-draft.ts — gỡ deadlock giao bài từ template.
//
// Tạo lớp auto-sinh Assignment DRAFT cho mọi template gắn lesson của lớp
// (lib/lms/assignment.ts → generateAssignmentsFromTemplates). GV chọn đúng template
// đó ở màn "Giao bài" → dup-check unique [classId, templateId] nổ "đã giao rồi" —
// nhưng site GV chỉ list PUBLISHED/CLOSED và KHÔNG có action publish riêng ⇒ GV
// không có cách nào mở bài cho HV (deadlock, gặp ngay khi go-live tạo lớp hàng loạt).
//
// Fix: bản trùng DRAFT → PUBLISH bản đó (đúng semantics publishAssignment của admin:
// update status + createMany bản nộp NOT_SUBMITTED skipDuplicates — KHÔNG chép logic
// tạo bài/clone câu hỏi vì DRAFT đã có sẵn từ lúc auto-sinh). Trùng PUBLISHED/CLOSED/
// ARCHIVED → vẫn báo lỗi như cũ (resolveTemplateDup).
//
// Tách khỏi app/(teacher)/teacher/cham-bai/_actions.ts ("use server" cần session +
// checkPermission) để test service-level. ⚠️ Caller PHẢI tự gate quyền + scope
// (classId ∈ actor.assignedClassIds) TRƯỚC khi gọi — hàm này chỉ là DB effect
// (Assignment/AssignmentSubmission không thuộc SCOPED_MODELS; scopedDb vốn không
// che write — xem CLAUDE.md §5).
import type { AssignmentStatus } from "@prisma/client";
import { db } from "@/lib/db";

export type TemplateDupResolution = "CREATE_NEW" | "PUBLISH_DRAFT" | "ALREADY_ASSIGNED";

/** THUẦN (test được) — quyết định khi template đã có Assignment trong lớp. */
export function resolveTemplateDup(
  dup: { status: AssignmentStatus } | null,
): TemplateDupResolution {
  if (!dup) return "CREATE_NEW";
  return dup.status === "DRAFT" ? "PUBLISH_DRAFT" : "ALREADY_ASSIGNED";
}

/**
 * Publish 1 Assignment DRAFT có sẵn: PUBLISHED + set dueAt, thêm file GV đính kèm
 * lúc giao (file template đã copy sẵn khi auto-sinh), sinh bản nộp NOT_SUBMITTED
 * cho roster active. Idempotent phần bản nộp (skipDuplicates).
 */
export async function publishDraftAssignment(opts: {
  assignmentId: string;
  dueAt: Date | null;
  /** Parity 18/08 — bài KIỂM TRA có khung giờ làm bài (openAt/closeAt). */
  openAt?: Date | null;
  closeAt?: Date | null;
  /** Parity 18/08 — gắn bài vào 1 buổi học (caller đã kiểm buổi thuộc đúng lớp). */
  classSessionId?: string | null;
  /** Roster HV active của lớp — caller đọc QUA quan hệ class đã guard. */
  studentIds: string[];
  attachments?: {
    fileUrl: string;
    fileName: string;
    fileSize?: number | null;
    mimeType?: string | null;
  }[];
  uploadedById?: string | null;
}): Promise<void> {
  const attachments = opts.attachments ?? [];
  await db.$transaction(async (tx) => {
    await tx.assignment.update({
      where: { id: opts.assignmentId },
      data: {
        status: "PUBLISHED",
        dueAt: opts.dueAt,
        openAt: opts.openAt ?? null,
        closeAt: opts.closeAt ?? null,
        classSessionId: opts.classSessionId ?? null,
      },
    });
    if (attachments.length > 0) {
      await tx.assignmentAttachment.createMany({
        data: attachments.map((f) => ({
          assignmentId: opts.assignmentId,
          fileUrl: f.fileUrl,
          fileName: f.fileName,
          fileSize: f.fileSize ?? null,
          mimeType: f.mimeType ?? null,
          uploadedById: opts.uploadedById ?? null,
        })),
      });
    }
    if (opts.studentIds.length > 0) {
      await tx.assignmentSubmission.createMany({
        data: opts.studentIds.map((studentId) => ({
          assignmentId: opts.assignmentId,
          studentId,
          status: "NOT_SUBMITTED" as const,
        })),
        skipDuplicates: true,
      });
    }
  });
}
