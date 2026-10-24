import { z } from "zod";
import type { ActionConfig, ScopedDb } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { congNgayLamViec } from "@/lib/elearning/ngay-lam-viec";
import { SLA_GRADE_DAYS } from "@/lib/elearning/metrics/constants";
import {
  isProgressWriteLocked,
  effectiveAllowLate,
  OVERDUE_LOCKED_MESSAGE,
} from "@/lib/elearning/due-lock";
import { assertPolicyAccepted } from "@/lib/elearning/policy-acceptance";
import { checkContentAccess } from "@/lib/elearning/content-gate";

/**
 * EL-15c — NỘP BÀI TẬP.
 *
 * ⚠️ Nộp KHÔNG phải là xong. Bài `TASK` lên `DONE` khi CHẤM ĐẠT, không phải khi
 * người học bấm nộp: ngưỡng khung là 80/100 và có đường nộp lại, nên "nộp = xong"
 * làm tỉ lệ hoàn thành nói dối và cấp chứng nhận cho bài trượt.
 *
 * Nhưng nộp CÓ đánh dấu "đã bắt đầu": không thế thì người đã nộp mà chưa được chấm
 * rơi vào nhóm CHƯA HỌC của báo cáo gửi quản lý trực tiếp — họ làm xong phần của
 * mình rồi mà vẫn bị đếm là chưa động tới.
 *
 * ⚠️ `dueGradeAt` ghi NGAY lúc nộp. Đây là mốc để biết người chấm có trễ hay không,
 * và nếu không ghi ở đây thì "nộp bài → có điểm trong 3 ngày làm việc" là thiện chí
 * chứ không phải cam kết đo được.
 */

export const nopBaiTapSchema = z
  .object({
    enrollmentId: z.string().min(1),
    lessonId: z.string().min(1),
    contentText: z.string().trim().min(1, "Chưa nhập nội dung bài làm").max(20_000),
  })
  .strict();

export type NopBaiTapInput = z.infer<typeof nopBaiTapSchema>;

export type KetQuaNop = {
  submissionId: string;
  attemptNo: number;
  dueGradeAt: Date;
};

/**
 * Lượt nộp GẦN NHẤT của một người trên một bài.
 *
 * ⚠️ Sắp theo `attemptNo` giảm dần, KHÔNG theo `createdAt`: hai lượt tạo trong cùng
 * một giây sẽ xếp tuỳ ý, và số thứ tự lượt tiếp theo tính sai.
 */
async function lanGanNhat(db: ScopedDb, lessonId: string, userId: string) {
  return db.trnSubmission.findFirst({
    where: { lessonId, userId },
    orderBy: { attemptNo: "desc" },
    select: {
      id: true,
      attemptNo: true,
      status: true,
      passed: true,
      attachmentsJson: true,
    },
  });
}

export const cauHinhNopBaiTap: ActionConfig<NopBaiTapInput, KetQuaNop> = {
  name: "nopBaiTap",
  permission: "elearning:lesson:learn",
  module: "elearning",
  entityType: "TrnSubmission",
  auditAction: "CREATE",
  schema: nopBaiTapSchema,
  handler: async ({ db, actor, input }) => {
    // ⚠️ CỔNG CHÍNH SÁCH — luật cứng #7 và điều kiện pháp lý, không phải bước UX.
    // Ba đường ghi tiến độ anh em (`reading-progress`, `video-heartbeat`,
    // `exam-taking`) đều có nó; nộp bài tập cũng là một lượt ghi tiến độ, và bài nộp
    // còn mang dữ liệu cá nhân của BÊN THỨ BA (§13.3). Bỏ cổng ở đúng đường thu
    // thập nhiều dữ liệu nhất là chỗ khó biện minh nhất.
    await assertPolicyAccepted(actor.userId);

    const gd = await db.trnEnrollment.findFirst({
      where: { id: input.enrollmentId },
      select: {
        id: true,
        userId: true,
        courseId: true,
        status: true,
        dueAt: true,
        centerId: true,
        assignmentId: true,
        assignment: { select: { allowLate: true } },
      },
    });
    if (!gd) throw new ActionError("NOT_FOUND", "Không tìm thấy lượt học");

    // ⚠️ Chỉ CHÍNH CHỦ nộp được. `elearning:lesson:learn` là quyền "được học", không
    // phải quyền "học thay người khác" — thiếu bước này thì bất kỳ ai có quyền học
    // đều nộp bài vào hồ sơ của người khác.
    if (gd.userId !== actor.userId) {
      throw new ActionError("FORBIDDEN", "Đây không phải lượt học của bạn");
    }
    if (gd.status === "REVOKED") {
      throw new ActionError("REVOKED", "Lượt học đã bị thu hồi");
    }

    // ⚠️ Cùng cổng quá hạn với mọi đường ghi tiến độ khác. Nộp bài là một lượt ghi
    // tiến độ; miễn cho nó là để một đường vòng qua hạn chót.
    if (
      isProgressWriteLocked({
        dueAt: gd.dueAt,
        allowLate: effectiveAllowLate({
          assignmentId: gd.assignmentId,
          assignmentAllowLate: gd.assignment?.allowLate,
        }),
        now: new Date(),
      })
    ) {
      throw new ActionError("OVERDUE_LOCKED", OVERDUE_LOCKED_MESSAGE);
    }

    const bai = await db.trnLesson.findFirst({
      where: {
        id: input.lessonId,
        deletedAt: null,
        // Ràng buộc theo KHOÁ của lượt ghi danh: nếu không, nộp được vào một bài
        // của khoá khác và lượt nộp đó không bao giờ cuộn lên đâu cả.
        module: { courseId: gd.courseId },
      },
      select: { id: true, kind: true, rubricId: true },
    });
    if (!bai) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");

    // ⚠️ CỔNG NỘI DUNG — chuỗi 4 điều kiện ở máy chủ (BA §3.2, luật cứng #7).
    // Cùng phép kiểm mà đường thi và đường đọc đang chạy.
    const khoa = await db.trnCourse.findFirst({
      where: { id: gd.courseId, deletedAt: null },
      select: {
        id: true,
        visibility: true,
        selfEnrollEnabled: true,
        securityLevel: true,
        versions: { where: { status: "PUBLISHED" }, select: { id: true }, take: 1 },
      },
    });
    if (!khoa) throw new ActionError("NOT_FOUND", "Không tìm thấy khoá học");
    const tuChoi = checkContentAccess({
      actor,
      course: {
        id: khoa.id,
        visibility: khoa.visibility,
        selfEnrollEnabled: khoa.selfEnrollEnabled,
        securityLevel: khoa.securityLevel,
        hasPublishedVersion: khoa.versions.length > 0,
      },
      hasEnrollment: true,
    });
    if (tuChoi) throw new ActionError("NOT_FOUND", tuChoi.message);

    if (bai.kind !== "TASK") {
      throw new ActionError("WRONG_KIND", "Bài này không phải bài tập");
    }
    // Cổng xuất bản đã chặn bài `TASK` không khung, nhưng khoá cũ xuất bản trước
    // cổng đó vẫn có thể lọt. Nói thẳng thay vì để lượt nộp treo không ai chấm được.
    if (!bai.rubricId) {
      throw new ActionError(
        "BAI_TAP_CHUA_CO_KHUNG",
        "Bài tập này chưa có khung chấm — báo Đào tạo, đừng nộp vội",
      );
    }

    const truoc = await lanGanNhat(db, bai.id, actor.userId);
    if (truoc) {
      // ⚠️ Đang chờ chấm thì KHÔNG cho nộp thêm. Cho nộp là đẻ hai lượt cùng chờ,
      // người chấm không biết đọc bản nào, và sổ bù SLA của lượt trước mất mốc.
      if (truoc.status === "SUBMITTED") {
        throw new ActionError(
          "DANG_CHO_CHAM",
          "Bài của bạn đang chờ chấm — chưa nộp lại được",
        );
      }
      // ⚠️ Chấm xong mà ĐẠT thì thôi; chấm xong mà CHƯA ĐẠT thì phải nộp lại được.
      //
      // Bản đầu chặn cả hai, trong khi màn học (`task-view.nopDuoc`) vẫn mời "Nộp
      // lại" cho ca chưa đạt — bày ra một lựa chọn mà máy chủ luôn từ chối. Với
      // ngưỡng 80/100 thì "chưa đạt" là ca THƯỜNG, nên đó là ngõ cụt vĩnh viễn cho
      // đúng nhóm người cần nộp lại nhất: bài không bao giờ lên xong, và điều kiện
      // hoàn thành khoá không bao giờ đạt.
      if (truoc.status === "GRADED" && truoc.passed === true) {
        throw new ActionError(
          "DA_DAT_ROI",
          "Lượt này đã đạt — không cần nộp lại.",
        );
      }
    }

    const now = new Date();
    const dueGradeAt = congNgayLamViec(now, SLA_GRADE_DAYS);
    const orgUnitId = await orgUnitIdForCenter(gd.centerId);
    if (!orgUnitId) {
      // `TrnSubmission.orgUnitId` là NOT NULL. Ném rõ ở đây hơn là để Prisma ném
      // một lỗi ràng buộc mà người học đọc không hiểu.
      throw new ActionError(
        "MISSING_ORG_UNIT",
        "Không xác định được đơn vị của lượt học — liên hệ quản trị",
      );
    }

    const attemptNo = (truoc?.attemptNo ?? 0) + 1;
    let lan: { id: string };
    try {
      lan = await db.trnSubmission.create({
        data: {
          lessonId: bai.id,
          enrollmentId: gd.id,
          userId: actor.userId,
          attemptNo,
          contentText: input.contentText,
          // ⚠️ CHÉP tệp đính kèm sang lượt mới.
          //
          // Không chép thì người bị trả về sửa phần VIẾT sẽ nộp lại và người chấm
          // lượt 2 thấy 0 bằng chứng — video dạy thử, ghi âm hội thoại biến mất, dù
          // chúng vẫn nằm nguyên trên kho và vẫn thuộc lượt cũ. Họ phải tải lại một
          // tệp 300MB cho một lần sửa vài dòng chữ.
          //
          // Chép SỔ, không chép byte: khoá vẫn trỏ tệp cũ. Nghĩa là xoá lượt cũ sẽ
          // làm hỏng lượt mới — nợ đi cùng cột `attachmentsJson` không có khoá ngoại,
          // đã ghi trong commit.
          attachmentsJson: truoc?.attachmentsJson ?? undefined,
          // ⚠️ ĐÓNG BĂNG khung tại thời điểm nộp. Suy khung qua `TrnLesson.rubricId`
          // lúc chấm là chấm bài cũ bằng thước mới nếu Đào tạo đổi khung giữa chừng.
          rubricId: bai.rubricId,
          status: "SUBMITTED",
          submittedAt: now,
          dueGradeAt,
          centerId: gd.centerId,
          orgUnitId,
        },
        select: { id: true },
      });
    } catch (e) {
      // Hai tab cùng bấm Nộp: `@@unique([lessonId, userId, attemptNo])` chặn, và
      // `P2002` không phải `ActionError` nên nó sẽ thoát ra thành lỗi 500 câm.
      if ((e as { code?: string }).code === "P2002") {
        throw new ActionError(
          "DANG_NOP",
          "Bài này vừa được nộp — tải lại trang để xem lượt nộp của bạn",
        );
      }
      throw e;
    }

    // ⚠️ ĐÁNH DẤU ĐÃ BẮT ĐẦU — nếu không, người vừa nộp bị đếm là CHƯA HỌC.
    //
    // Báo cáo tuân thủ xếp nhóm bằng `startedAt || progressPercent > 0`
    // (`report-compliance.ts`). Bài `TASK` chỉ lên `DONE` khi CHẤM ĐẠT, nên
    // `progressPercent` đứng yên trong suốt thời gian chờ chấm. Không ghi
    // `startedAt` thì người đã làm xong phần của mình nằm trong nhóm "chưa động
    // tới" của báo cáo gửi thẳng quản lý trực tiếp — trong lúc họ đang chờ NGƯỜI
    // KHÁC.
    //
    // Ghi MỘT LẦN: `startedAt` là mốc bắt đầu, không phải mốc hoạt động gần nhất.
    await db.trnEnrollment.updateMany({
      where: { id: gd.id, startedAt: null },
      data: { startedAt: now },
    });

    // Tiến độ bài lên ĐANG HỌC, chưa phải xong. Xong là việc của đường CHẤM.
    await db.trnLessonProgress.upsert({
      where: {
        enrollmentId_lessonId: { enrollmentId: gd.id, lessonId: bai.id },
      },
      update: { lastActivityAt: now },
      create: {
        enrollmentId: gd.id,
        lessonId: bai.id,
        userId: actor.userId,
        status: "IN_PROGRESS",
        firstStartedAt: now,
        lastActivityAt: now,
      },
    });

    return {
      entityId: lan.id,
      data: { submissionId: lan.id, attemptNo, dueGradeAt },
      newValues: {
        lessonId: bai.id,
        attemptNo,
        status: "SUBMITTED",
        dueGradeAt,
        // KHÔNG ghi `contentText` vào audit: đó là bài làm của một người, và nhật ký
        // audit đọc được rộng hơn màn chấm.
      },
    };
  },
};
