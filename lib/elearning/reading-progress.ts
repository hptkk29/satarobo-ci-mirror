import "server-only";

import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import {
  assertPolicyAccepted,
  PolicyNotAcceptedError,
} from "@/lib/elearning/policy-acceptance";
import { cuonKhoaSauKhiXongBai } from "@/lib/elearning/rollup";
import { checkContentAccess } from "@/lib/elearning/content-gate";
import {
  capReadSeconds,
  isLessonDone,
  mergeSnapshot,
  type ReadSnapshot,
} from "@/lib/elearning/reading";
import {
  effectiveAllowLate,
  isProgressWriteLocked,
  OVERDUE_LOCKED,
  OVERDUE_LOCKED_MESSAGE,
} from "@/lib/elearning/due-lock";

/**
 * EL-04 — GHI NHỊP ĐỌC. Chỗ mọi cổng hội tụ.
 *
 * ─── THỨ TỰ CỔNG LÀ HỢP ĐỒNG, KHÔNG PHẢI GU ─────────────────────────────────
 *   quyền vào khu → quyền học → SỞ HỮU (chống IDOR) → chấp nhận chính sách
 *   → cổng nội dung → khoá sau hạn → ghi
 *
 * Đổi thứ tự làm rò thông tin, không chỉ làm xấu mã:
 *  · Kiểm sở hữu SAU cổng nội dung ⇒ người lạ dò được khoá nào tồn tại qua việc
 *    phân biệt hai thông báo lỗi.
 *  · Kiểm chính sách SAU khi ghi ⇒ đã thu mất một nhịp của người chưa đồng ý, và
 *    một nhịp đã ghi thì không "chưa thu" lại được.
 *  · Kiểm hạn SAU khi ghi ⇒ hạn chót không có hiệu lực gì.
 */

export type GhiNhipInput = {
  actor: Actor;
  enrollmentId: string;
  lessonId: string;
  /** Số client báo lên — CHƯA tin được, sẽ bị kẹp. */
  readSeconds: number;
  scrollMaxPct: number;
  /** Số thứ tự nhịp, chống nhịp tới trễ/đảo thứ tự. */
  seq: number;
  now: Date;
};

export type GhiNhipKetQua =
  | { ok: true; snapshot: ReadSnapshot; done: boolean }
  | { ok: false; code: string; message: string };

/**
 * Ghi một nhịp đọc. Trả kết quả thay vì ném — bên gọi (Route Handler) tự dựng
 * envelope; ném qua nhiều tầng chỉ làm mất mã lỗi.
 */
export async function ghiNhipDoc(input: GhiNhipInput): Promise<GhiNhipKetQua> {
  const { actor } = input;

  // ── 1. Quyền vào khu + quyền học ──────────────────────────────────────────
  if (!can(actor, "elearning:portal:access") || !can(actor, "elearning:lesson:learn")) {
    return {
      ok: false,
      code: "PERMISSION_DENIED",
      message: "Bạn không có quyền học trong khu đào tạo nội bộ",
    };
  }

  // ── 2. SỞ HỮU — chống IDOR ────────────────────────────────────────────────
  // Khoá theo CHÍNH `userId` của actor, không tin `enrollmentId` client gửi lên.
  // Thiếu vế `userId` thì bất kỳ ai đoán được một id lượt ghi danh đều ghi được
  // tiến độ cho người khác, và bản ghi đó mang tên họ trong mọi báo cáo.
  const enrollment = await db.trnEnrollment.findFirst({
    where: { id: input.enrollmentId, userId: actor.userId },
    select: {
      id: true,
      courseId: true,
      status: true,
      dueAt: true,
      assignmentId: true,
      assignment: { select: { allowLate: true } },
    },
  });
  // Không tìm thấy VÀ không thuộc về mình đều trả CÙNG MỘT lỗi: phân biệt hai ca
  // là nói cho người dò biết id nào có thật.
  if (!enrollment) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Không tìm thấy lượt học của bạn",
    };
  }
  if (enrollment.status === "REVOKED") {
    return { ok: false, code: "REVOKED", message: "Lượt học đã bị thu hồi" };
  }

  // ── 3. Chấp nhận chính sách — TRƯỚC khi ghi, không phải sau ────────────────
  try {
    await assertPolicyAccepted(actor.userId);
  } catch (e) {
    if (e instanceof PolicyNotAcceptedError) {
      return { ok: false, code: "POLICY_NOT_ACCEPTED", message: e.message };
    }
    throw e;
  }

  // ── 4. Bài phải thuộc khoá của lượt này, và cổng nội dung ─────────────────
  const lesson = await db.trnLesson.findFirst({
    where: {
      id: input.lessonId,
      deletedAt: null,
      module: { courseId: enrollment.courseId },
    },
    select: { id: true, minReadSeconds: true },
  });
  // Bài không thuộc khoá đã ghi danh ⇒ cùng lỗi NOT_FOUND. Đây là vế thứ hai của
  // chống IDOR: có lượt ghi danh hợp lệ KHÔNG cho phép ghi tiến độ lên bài của
  // khoá khác.
  if (!lesson) {
    return { ok: false, code: "NOT_FOUND", message: "Không tìm thấy bài học" };
  }

  const course = await db.trnCourse.findUnique({
    where: { id: enrollment.courseId },
    select: {
      id: true,
      visibility: true,
      selfEnrollEnabled: true,
      securityLevel: true,
      versions: { where: { status: "PUBLISHED" }, select: { id: true }, take: 1 },
    },
  });
  if (!course) {
    return { ok: false, code: "NOT_FOUND", message: "Không tìm thấy khoá học" };
  }
  const tuChoi = checkContentAccess({
    actor,
    course: {
      id: course.id,
      visibility: course.visibility,
      selfEnrollEnabled: course.selfEnrollEnabled,
      securityLevel: course.securityLevel,
      hasPublishedVersion: course.versions.length > 0,
    },
    hasEnrollment: true,
  });
  if (tuChoi) return { ok: false, ...tuChoi };

  // ── 5. Khoá sau hạn ───────────────────────────────────────────────────────
  const allowLate = effectiveAllowLate({
    assignmentId: enrollment.assignmentId,
    assignmentAllowLate: enrollment.assignment?.allowLate,
  });
  if (isProgressWriteLocked({ dueAt: enrollment.dueAt, allowLate, now: input.now })) {
    return {
      ok: false,
      code: OVERDUE_LOCKED,
      message: OVERDUE_LOCKED_MESSAGE,
    };
  }

  // ── 6. Ghi ────────────────────────────────────────────────────────────────
  const cu = await db.trnLessonProgress.findUnique({
    where: {
      enrollmentId_lessonId: {
        enrollmentId: enrollment.id,
        lessonId: lesson.id,
      },
    },
    select: { readSeconds: true, scrollMaxPct: true, seq: true, verifiedAt: true },
  });

  // Nhịp tới trễ hoặc đảo thứ tự: bỏ, nhưng KHÔNG báo lỗi — với người dùng thì
  // không có gì sai, và một lỗi ở đây sẽ hiện lên giữa lúc họ đang đọc.
  if (cu && input.seq <= cu.seq) {
    return {
      ok: true,
      snapshot: { readSeconds: cu.readSeconds, scrollMaxPct: cu.scrollMaxPct },
      done: cu.verifiedAt != null,
    };
  }

  const nen: ReadSnapshot = cu
    ? { readSeconds: cu.readSeconds, scrollMaxPct: cu.scrollMaxPct }
    : { readSeconds: 0, scrollMaxPct: 0 };

  const gop = mergeSnapshot(nen, {
    // Kẹp TRƯỚC khi gộp: client bơm 99999 thì phải bị cắt về `db + biên`, chứ
    // không phải được gộp vào rồi mới cắt.
    readSeconds: capReadSeconds({ client: input.readSeconds, db: nen.readSeconds }),
    scrollMaxPct: input.scrollMaxPct,
  });

  const xong = isLessonDone({
    readSeconds: gop.readSeconds,
    scrollMaxPct: gop.scrollMaxPct,
    minReadSeconds: lesson.minReadSeconds,
  });

  await db.trnLessonProgress.upsert({
    where: {
      enrollmentId_lessonId: {
        enrollmentId: enrollment.id,
        lessonId: lesson.id,
      },
    },
    update: {
      readSeconds: gop.readSeconds,
      scrollMaxPct: gop.scrollMaxPct,
      seq: input.seq,
      lastActivityAt: input.now,
      status: xong ? "DONE" : "IN_PROGRESS",
      // `verifiedAt` và `completedAt` chỉ ĐẶT MỘT LẦN, không ghi đè: chúng là mốc
      // "lần đầu đạt", và đọc lại bài sau đó không được đẩy mốc về sau.
      ...(xong && cu?.verifiedAt == null
        ? { verifiedAt: input.now, completedAt: input.now }
        : {}),
    },
    create: {
      enrollmentId: enrollment.id,
      lessonId: lesson.id,
      userId: actor.userId,
      readSeconds: gop.readSeconds,
      scrollMaxPct: gop.scrollMaxPct,
      seq: input.seq,
      firstStartedAt: input.now,
      lastActivityAt: input.now,
      status: xong ? "DONE" : "IN_PROGRESS",
      ...(xong ? { verifiedAt: input.now, completedAt: input.now } : {}),
    },
  });

  // ⚠️ Chỉ cuộn khi bài này VỪA đạt: cuộn mỗi nhịp heartbeat là ba câu đếm mỗi
  // 15 giây cho mỗi người đang đọc. Hàm cuộn tự nuốt lỗi — nó là việc phụ, không
  // được làm hỏng việc ghi tiến độ vừa xong.
  if (xong && cu?.verifiedAt == null) {
    await cuonKhoaSauKhiXongBai(enrollment.id, input.now);
  }

  return { ok: true, snapshot: gop, done: xong };
}
