"use server";

import { z } from "zod";
import { defineAction } from "@/lib/actions/define";
import { ActionError } from "@/lib/actions/factory";
import { assertPolicyForAction } from "@/lib/elearning/content-gate";
import {
  acceptPolicy,
  currentPolicyVersion,
  ELEARNING_POLICY_KEY,
} from "@/lib/elearning/policy-acceptance";
import { isLessonDone } from "@/lib/elearning/reading";
import {
  cauHinhKhieuNaiCo,
  cauHinhQuyetCo,
} from "@/lib/elearning/watch-flag-appeal";
import {
  effectiveAllowLate,
  isProgressWriteLocked,
  OVERDUE_LOCKED,
  OVERDUE_LOCKED_MESSAGE,
} from "@/lib/elearning/due-lock";

/**
 * EL-04 — hai Server Action của khu đào tạo nội bộ.
 *
 * ⚠️ File `"use server"` chỉ được export HÀM ASYNC. Một `export const` lạc vào
 * đây làm Server Action vỡ LÚC CHẠY (E352) mà `pnpm build` vẫn xanh — nên hằng số
 * nào cũng phải nằm ở `lib/`, không nằm ở file này.
 *
 * Vì sao hai action này đi qua `defineAction` trong khi NHỊP ĐỌC thì không: cả
 * hai đều sinh một dòng CHỨNG TỪ (đánh dấu hoàn thành, ghi nhận đồng ý) và ĐÁNG
 * được audit. Nhịp 15 giây thì ngược lại — audit nó là nhấn chìm đúng những dòng
 * cần đọc. Xem `app/api/elearning/reading-heartbeat/route.ts`.
 */

export const markLessonReadAction = defineAction({
  name: "markLessonRead",
  permission: "elearning:lesson:learn",
  module: "elearning",
  entityType: "TrnLessonProgress",
  auditAction: "UPDATE",
  schema: z.object({
    enrollmentId: z.string().min(1),
    lessonId: z.string().min(1),
  }),
  handler: async ({ db, actor, input }) => {
    // Cổng chính sách TRƯỚC mọi lệnh ghi. Dùng bản đã map sang `ActionError` —
    // `PolicyNotAcceptedError` không phải `ActionError` nên ném thẳng là màn 500.
    await assertPolicyForAction(actor.userId);

    // Sở hữu: khoá theo CHÍNH userId, không tin id client gửi.
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
    if (!enrollment || enrollment.status === "REVOKED") {
      throw new ActionError("NOT_FOUND", "Không tìm thấy lượt học của bạn");
    }

    const lesson = await db.trnLesson.findFirst({
      where: {
        id: input.lessonId,
        deletedAt: null,
        module: { courseId: enrollment.courseId },
      },
      select: { id: true, minReadSeconds: true },
    });
    if (!lesson) {
      throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");
    }

    const now = new Date();
    if (
      isProgressWriteLocked({
        dueAt: enrollment.dueAt,
        allowLate: effectiveAllowLate({
          assignmentId: enrollment.assignmentId,
          assignmentAllowLate: enrollment.assignment?.allowLate,
        }),
        now,
      })
    ) {
      throw new ActionError(OVERDUE_LOCKED, OVERDUE_LOCKED_MESSAGE);
    }

    const progress = await db.trnLessonProgress.findUnique({
      where: {
        enrollmentId_lessonId: {
          enrollmentId: enrollment.id,
          lessonId: lesson.id,
        },
      },
      select: {
        id: true,
        readSeconds: true,
        scrollMaxPct: true,
        verifiedAt: true,
      },
    });

    // 🔴 KHÔNG cho bấm để hoàn thành. Nút này chỉ CHỐT một trạng thái mà đo lường
    // đã đạt; nếu nó tự đặt `verifiedAt` thì toàn bộ cơ chế đo thành trang trí và
    // mọi người sẽ mở bài rồi bấm ngay.
    if (
      !progress ||
      !isLessonDone({
        readSeconds: progress.readSeconds,
        scrollMaxPct: progress.scrollMaxPct,
        minReadSeconds: lesson.minReadSeconds,
      })
    ) {
      throw new ActionError(
        "NOT_YET_DONE",
        "Chưa đủ điều kiện hoàn thành — cần đọc đủ thời gian và xem hết bài",
      );
    }

    // Đã chốt rồi thì thôi: `verifiedAt` là mốc LẦN ĐẦU đạt, và mọi chỉ số
    // đúng-hạn đọc mốc đó. Bấm lại không được đẩy nó về sau.
    if (progress.verifiedAt) {
      return { entityId: progress.id, data: { alreadyDone: true } };
    }

    await db.trnLessonProgress.update({
      where: { id: progress.id },
      data: { status: "DONE", verifiedAt: now, completedAt: now },
    });

    return {
      entityId: progress.id,
      oldValues: { verifiedAt: null },
      newValues: { verifiedAt: now },
      data: { alreadyDone: false },
    };
  },
});

export const acceptPolicyAction = defineAction({
  name: "acceptElearningPolicy",
  // Chỉ cần vào được khu là xác nhận được chính sách của chính mình — không đòi
  // quyền học, vì người chỉ có quyền xem báo cáo cũng phải xác nhận được.
  permission: "elearning:portal:access",
  module: "elearning",
  entityType: "TrnPolicyAcceptance",
  auditAction: "CREATE",
  schema: z.object({}),
  handler: async ({ actor }) => {
    const { version } = await acceptPolicy(actor.userId, ELEARNING_POLICY_KEY);
    return {
      entityId: `${actor.userId}:${ELEARNING_POLICY_KEY}:${version}`,
      newValues: { policyKey: ELEARNING_POLICY_KEY, policyVersion: version },
      data: { version, current: currentPolicyVersion() },
    };
  },
});

/**
 * EL-13 — khiếu nại cờ nghi ngờ, và quyết định của người xử.
 *
 * Hai action này ĐI QUA action factory (tức có audit), khác hẳn nhịp xem. Nhịp 15
 * giây sẽ nhấn chìm bảng audit; nhưng khiếu nại và quyết định là chứng từ về hành
 * vi người lao động, và chúng ĐÁNG được ghi lại.
 */
export const khieuNaiCoAction = defineAction(cauHinhKhieuNaiCo);
export const quyetCoAction = defineAction(cauHinhQuyetCo);
