// lib/lms/media-consent.ts — R3-06: media tag bắt buộc + StudentConsent (privacy-first).
// C6.1 upload phải tag ≥1 HS · C6.2 không tag → không hiển thị PH · C6.3 chưa consent → không tag
// · C6.4 thu hồi consent → media có tag con đó ẩn ngay.
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";

type ConsentDbClient = PrismaClient | Prisma.TransactionClient;

export class ConsentError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ConsentError";
    this.code = code;
  }
}

/**
 * #08 — ngữ cảnh audit khi PH tự bật/thu hồi consent trên portal (hoặc admin đổi hộ).
 * Truyền `audit` → ghi AuditLog (ai – lúc nào – GRANTED/REVOKED – nguồn) CÙNG transaction
 * với StudentConsent. KHÔNG truyền (test/nội bộ) → chỉ upsert như cũ (không audit).
 * Nhánh convert lead (convert-lead-v2.ts) tự ghi audit riêng nên KHÔNG gọi các hàm này.
 */
export type ConsentAuditOpts = {
  actor: AuditActor;
  /** Nguồn thay đổi (mặc định PORTAL_SELF_SERVICE). */
  source?: string;
  /** orgUnitId để scope AuditLog; bỏ trống → tự suy từ Student.centerId. */
  orgUnitId?: string | null;
};

async function upsertConsent(
  client: ConsentDbClient,
  studentId: string,
  status: "GRANTED" | "REVOKED",
): Promise<void> {
  const revokedAt = status === "REVOKED" ? new Date() : null;
  await client.studentConsent.upsert({
    where: { studentId_type: { studentId, type: "CLASS_MEDIA" } },
    update: { status, revokedAt },
    create: { studentId, type: "CLASS_MEDIA", status, revokedAt },
  });
}

async function applyConsent(
  studentId: string,
  status: "GRANTED" | "REVOKED",
  audit?: ConsentAuditOpts,
): Promise<void> {
  if (!audit) {
    await upsertConsent(db, studentId, status);
    return;
  }
  // Consent + audit atomic: thay đổi quyền riêng tư LUÔN đi kèm dấu vết (DoD #08).
  await db.$transaction(async (tx) => {
    await upsertConsent(tx, studentId, status);
    const orgUnitId =
      audit.orgUnitId ??
      (await tx.student.findUnique({ where: { id: studentId }, select: { centerId: true } }))
        ?.centerId ??
      null;
    await writeAudit({
      actor: audit.actor,
      module: "enrollment",
      entityType: "StudentConsent",
      entityId: studentId,
      action: status === "GRANTED" ? "CONSENT_GRANTED" : "CONSENT_REVOKED",
      newValues: { type: "CLASS_MEDIA", status, source: audit.source ?? "PORTAL_SELF_SERVICE" },
      orgUnitId,
      tx,
    });
  });
}

/** PH cấp đồng ý dùng hình ảnh cho 1 học viên (audit tuỳ chọn). */
export async function grantMediaConsent(studentId: string, audit?: ConsentAuditOpts): Promise<void> {
  await applyConsent(studentId, "GRANTED", audit);
}

/** PH thu hồi đồng ý (C6.4) — audit tuỳ chọn. */
export async function revokeMediaConsent(studentId: string, audit?: ConsentAuditOpts): Promise<void> {
  await applyConsent(studentId, "REVOKED", audit);
}

/** Bật/tắt consent theo boolean (dùng cho toggle portal). */
export async function setMediaConsent(
  studentId: string,
  grant: boolean,
  audit?: ConsentAuditOpts,
): Promise<void> {
  await applyConsent(studentId, grant ? "GRANTED" : "REVOKED", audit);
}

export async function hasMediaConsent(studentId: string): Promise<boolean> {
  const c = await db.studentConsent.findUnique({
    where: { studentId_type: { studentId, type: "CLASS_MEDIA" } },
    select: { status: true },
  });
  return c?.status === "GRANTED";
}

/**
 * R7-09 — HS đang học của 1 lớp CHƯA có consent CLASS_MEDIA (status != GRANTED).
 * Dùng cho banner cảnh báo lúc upload: nhắc GV làm mờ thủ công / loại khỏi khung,
 * và chặn tag các HS này (server-side). Trả [] nếu lớp không có HS.
 */
export async function getNonConsentStudents(
  classId: string,
): Promise<{ id: string; name: string }[]> {
  const enrollments = await db.enrollment.findMany({
    where: { classId, status: { in: ENROLLMENT_ACTIVE_STATUS_LIST } },
    select: { student: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const students = enrollments.map((e) => e.student);
  if (students.length === 0) return [];

  const granted = await db.studentConsent.findMany({
    where: {
      studentId: { in: students.map((s) => s.id) },
      type: "CLASS_MEDIA",
      status: "GRANTED",
    },
    select: { studentId: true },
  });
  const grantedSet = new Set(granted.map((g) => g.studentId));
  return students.filter((s) => !grantedSet.has(s.id));
}

/** C6.3 — chỉ tag được HS đã GRANTED consent. */
export async function tagStudentToMedia(mediaId: string, studentId: string): Promise<void> {
  if (!(await hasMediaConsent(studentId))) {
    throw new ConsentError("NO_CONSENT", "Học viên chưa đồng ý dùng hình ảnh — không thể gắn thẻ.");
  }
  await db.mediaStudentTag.create({ data: { mediaId, studentId } });
}

/**
 * C6.1/C6.2/C6.4 — media có hiển thị cho PH của 1 học viên không:
 * media APPROVED + có tag học viên đó + học viên đang GRANTED consent.
 */
export async function isMediaVisibleForStudent(mediaId: string, studentId: string): Promise<boolean> {
  const [media, tag, consent] = await Promise.all([
    db.classSessionMedia.findUnique({ where: { id: mediaId }, select: { status: true } }),
    db.mediaStudentTag.findFirst({ where: { mediaId, studentId }, select: { id: true } }),
    hasMediaConsent(studentId),
  ]);
  return media?.status === "APPROVED" && !!tag && consent;
}
