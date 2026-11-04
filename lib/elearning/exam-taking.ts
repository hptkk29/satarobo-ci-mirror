import { z } from "zod";
import type { ActionConfig, ScopedDb } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import type { Actor } from "@/lib/auth/actor";
import { checkContentAccess } from "@/lib/elearning/content-gate";
import {
  assertPolicyAccepted,
  PolicyNotAcceptedError,
} from "@/lib/elearning/policy-acceptance";
import { effectiveAllowLate, isProgressWriteLocked } from "@/lib/elearning/due-lock";
import { ghiXongBai } from "@/lib/elearning/lesson-done";
import { cueInlineSchema, laCauChamDuoc } from "@/lib/elearning/lesson-cue";
import {
  chamMotCau,
  tinhDiemLuot,
  soLuotChoPhep,
  conChoCooldown,
  hetGio,
} from "@/lib/elearning/exam-grading";

/**
 * EL-14d — LÀM BÀI THI.
 *
 * ⚠️ MỘT đường nối đề ↔ bài, không hai. Lược đồ có cả `TrnLesson.examId` lẫn
 * `TrnExam.lessonId`; dùng cả hai là hai nguồn sự thật, và báo cáo sẽ đếm đôi.
 * Đường được dùng là **`TrnLesson.examId`** — nó là thứ `trnLessonCreateSchema` đã
 * đòi cho bài `QUIZ` từ GĐ1, và là chiều mà trang học cần (nạp bài rồi mới biết đề).
 * `TrnExam.lessonId` để dành, hiện KHÔNG đường nào ghi.
 *
 * ─── THỨ TỰ CỔNG LÀ HỢP ĐỒNG ───────────────────────────────────────────────
 *   quyền → SỞ HỮU lượt ghi danh → thu hồi → chính sách → bài thuộc khoá
 *   → cổng nội dung → khoá sau hạn → trần lượt → thời gian chờ → tạo lượt thi
 *
 * ⚠️ Hạn chót chặn BẮT ĐẦU, KHÔNG chặn NỘP. Lượt đã mở trước hạn được nộp và chấm
 * bình thường. Chặn nộp giữa chừng là làm mất bài người ta vừa làm — thiệt hại
 * không hồi phục, và họ không làm gì sai.
 */

// ── Bắt đầu thi ────────────────────────────────────────────────────────────

export const batDauThiSchema = z
  .object({ enrollmentId: z.string().min(1), lessonId: z.string().min(1) })
  .strict();
export type BatDauThiInput = z.infer<typeof batDauThiSchema>;

type NenThi = {
  enrollment: {
    id: string;
    courseId: string;
    centerId: string;
    orgUnitId: string;
    dueAt: Date | null;
    assignmentId: string | null;
    assignment: { allowLate: boolean } | null;
  };
  examId: string;
};

/**
 * Chuỗi cổng dùng chung cho mọi thao tác thi.
 *
 * Gom vào một chỗ vì ba action (bắt đầu · lưu câu · nộp) phải đi qua CÙNG một
 * chuỗi. Chép ba lần là ba bản sẽ trôi khỏi nhau, và bản lỏng nhất thành cửa sau.
 */
async function quaCong(
  db: ScopedDb,
  actor: Actor,
  input: { enrollmentId: string; lessonId: string },
): Promise<NenThi> {
  // ── SỞ HỮU — khoá theo CHÍNH `userId`, không tin id trên đường truyền ──────
  const enrollment = await db.trnEnrollment.findFirst({
    where: { id: input.enrollmentId, userId: actor.userId },
    select: {
      id: true,
      courseId: true,
      status: true,
      centerId: true,
      orgUnitId: true,
      dueAt: true,
      assignmentId: true,
      assignment: { select: { allowLate: true } },
    },
  });
  if (!enrollment) {
    throw new ActionError("NOT_FOUND", "Không tìm thấy lượt học của bạn");
  }
  if (enrollment.status === "REVOKED") {
    throw new ActionError("REVOKED", "Lượt học đã bị thu hồi");
  }

  try {
    await assertPolicyAccepted(actor.userId);
  } catch (e) {
    if (e instanceof PolicyNotAcceptedError) {
      throw new ActionError("POLICY_NOT_ACCEPTED", e.message);
    }
    throw e;
  }

  const lesson = await db.trnLesson.findFirst({
    where: {
      id: input.lessonId,
      deletedAt: null,
      module: { courseId: enrollment.courseId },
    },
    select: { id: true, kind: true, examId: true },
  });
  // Bài không thuộc khoá đã ghi danh ⇒ cùng lỗi NOT_FOUND. Đây là vế thứ hai của
  // chống IDOR: có lượt ghi danh hợp lệ KHÔNG cho phép thi đề của khoá khác.
  if (!lesson) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");
  if (lesson.kind !== "QUIZ") {
    throw new ActionError("WRONG_KIND", `Bài này là dạng ${lesson.kind}, không phải bài kiểm tra`);
  }
  if (!lesson.examId) {
    throw new ActionError(
      "BAI_CHUA_CO_DE",
      "Bài kiểm tra này chưa gắn đề — báo với Đào tạo",
    );
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
  if (!course) throw new ActionError("NOT_FOUND", "Không tìm thấy khoá học");
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
  if (tuChoi) throw new ActionError("NOT_FOUND", tuChoi.message);

  return { enrollment, examId: lesson.examId };
}

export const cauHinhBatDauThi: ActionConfig<
  BatDauThiInput,
  { attemptId: string; attemptNo: number }
> = {
  name: "batDauThi",
  permission: "elearning:lesson:learn",
  module: "elearning",
  entityType: "TrnExamAttempt",
  auditAction: "CREATE",
  schema: batDauThiSchema,
  handler: async ({ db, actor, input }) => {
    const nen = await quaCong(db, actor, input);
    const now = new Date();

    // ── Khoá sau hạn: chặn BẮT ĐẦU ──────────────────────────────────────────
    const allowLate = effectiveAllowLate({
      assignmentId: nen.enrollment.assignmentId,
      assignmentAllowLate: nen.enrollment.assignment?.allowLate,
    });
    if (isProgressWriteLocked({ dueAt: nen.enrollment.dueAt, allowLate, now })) {
      throw new ActionError(
        "OVERDUE_LOCKED",
        "Đã quá hạn — liên hệ Đào tạo để được gia hạn trước khi thi",
      );
    }

    const de = await db.trnExam.findFirst({
      where: { id: nen.examId, deletedAt: null },
      select: {
        id: true,
        isActive: true,
        maxAttempts: true,
        cooldownHours: true,
        _count: { select: { questions: true } },
      },
    });
    if (!de) throw new ActionError("NOT_FOUND", "Không tìm thấy đề thi");
    if (!de.isActive) {
      // Đề nháp là đề chưa đóng băng bộ câu — cho thi là chấm trên một thang có
      // thể đổi sau lưng người học.
      throw new ActionError("DE_CHUA_KICH_HOAT", "Đề chưa được kích hoạt — báo với Đào tạo");
    }

    const [daThi, soMoKhoa] = await Promise.all([
      db.trnExamAttempt.findMany({
        where: { examId: de.id, userId: actor.userId },
        select: { attemptNo: true, status: true, submittedAt: true },
        orderBy: { attemptNo: "desc" },
      }),
      db.trnExamUnlock.count({ where: { examId: de.id, userId: actor.userId } }),
    ]);

    // Lượt đang mở dở ⇒ trả về chính nó. Tạo lượt mới là đốt một lượt của người
    // học chỉ vì họ tải lại trang.
    const dangMo = daThi.find((a) => a.status === "IN_PROGRESS");
    if (dangMo) {
      const luot = await db.trnExamAttempt.findFirst({
        where: { examId: de.id, userId: actor.userId, attemptNo: dangMo.attemptNo },
        select: { id: true, attemptNo: true },
      });
      if (luot) {
        return { entityId: luot.id, data: { attemptId: luot.id, attemptNo: luot.attemptNo } };
      }
    }

    const tran = soLuotChoPhep({ maxAttempts: de.maxAttempts, soLanMoKhoa: soMoKhoa });
    if (daThi.length >= tran) {
      throw new ActionError(
        "HET_LUOT_THI",
        `Đã dùng hết ${tran} lượt thi. Liên hệ Đào tạo nếu cần mở thêm lượt.`,
      );
    }

    // ⚠️ Đếm từ `submittedAt` của lượt trước, KHÔNG từ `startedAt`. Đếm từ lúc bắt
    // đầu cho phép mở một lượt rồi bỏ đó để "đốt" thời gian chờ.
    const nopGanNhat = daThi
      .map((a) => a.submittedAt)
      .filter((d): d is Date => d != null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const cho = conChoCooldown({
      nopLanTruoc: nopGanNhat,
      cooldownHours: de.cooldownHours,
      now,
    });
    if (!cho.duoc) {
      throw new ActionError(
        "CHUA_HET_THOI_GIAN_CHO",
        `Còn ${cho.conLaiPhut} phút nữa mới được thi lại`,
      );
    }

    const attemptNo = (daThi[0]?.attemptNo ?? 0) + 1;
    try {
      const luot = await db.trnExamAttempt.create({
        data: {
          examId: de.id,
          userId: actor.userId,
          enrollmentId: nen.enrollment.id,
          attemptNo,
          status: "IN_PROGRESS",
          startedAt: now,
          // ⚠️ Đơn vị lấy TỪ lượt ghi danh. Không suy được thì không tới đây được —
          // hai cột này NOT NULL trên `TrnEnrollment`.
          centerId: nen.enrollment.centerId,
          orgUnitId: nen.enrollment.orgUnitId,
          // NOT NULL, ghi cứng lúc INSERT.
          purgeAfter: new Date(now.getTime() + 90 * 24 * 3600_000),
        },
        select: { id: true, attemptNo: true },
      });
      return {
        entityId: luot.id,
        data: { attemptId: luot.id, attemptNo: luot.attemptNo },
        newValues: { examId: de.id, attemptNo },
      };
    } catch (e) {
      const ma =
        typeof e === "object" && e !== null && "code" in e
          ? (e as { code?: unknown }).code
          : undefined;
      // ⚠️ `@@unique([examId, userId, attemptNo])` là thứ chặn HAI TAB cùng bấm
      // "Bắt đầu thi" tạo ra hai lượt. Không bắt lỗi này thì tab thứ hai nhận màn
      // hình 500, và người học tưởng hệ thống hỏng.
      if (ma === "P2002") {
        throw new ActionError(
          "DANG_MO_LUOT_KHAC",
          "Bạn vừa mở một lượt thi ở nơi khác — tải lại trang",
        );
      }
      throw e;
    }
  },
};

// ── Lưu một câu trả lời ────────────────────────────────────────────────────

export const luuCauTraLoiSchema = z
  .object({
    attemptId: z.string().min(1),
    examQuestionId: z.string().min(1),
    /** Chỉ số lựa chọn đã chọn. Rỗng = bỏ trống câu. */
    chon: z.array(z.number().int().min(0).max(9)).max(10),
    textAnswer: z.union([z.null(), z.string().max(10_000)]).optional(),
  })
  .strict();
export type LuuCauTraLoiInput = z.infer<typeof luuCauTraLoiSchema>;

/**
 * Nạp lượt thi ĐANG MỞ của chính người gọi.
 *
 * Khoá theo `userId`: không kiểm thì ai đoán được một `attemptId` đều ghi được câu
 * trả lời vào bài của người khác.
 */
async function napLuotDangMo(db: ScopedDb, actor: Actor, attemptId: string) {
  const luot = await db.trnExamAttempt.findFirst({
    where: { id: attemptId, userId: actor.userId },
    select: {
      id: true,
      examId: true,
      enrollmentId: true,
      status: true,
      startedAt: true,
      attemptNo: true,
      exam: {
        select: {
          id: true,
          durationMin: true,
          passScore: true,
          maxScore: true,
        },
      },
    },
  });
  if (!luot) throw new ActionError("NOT_FOUND", "Không tìm thấy lượt thi của bạn");
  if (luot.status !== "IN_PROGRESS") {
    throw new ActionError("LUOT_DA_DONG", "Lượt thi này đã nộp rồi");
  }

  // ⚠️ KIỂM LẠI lượt ghi danh, không chỉ tin lượt thi đã mở.
  //
  // Chuỗi cổng đầy đủ chạy ở `batDauThi`, nhưng một lượt thi sống tới 30 phút — và
  // trong khoảng đó lượt ghi danh có thể bị THU HỒI. Không kiểm lại thì người đã bị
  // thu hồi vẫn nộp được, vẫn được chấm, và vẫn được ghi "đã hoàn thành" vào một
  // khoá họ không còn thuộc về.
  if (luot.enrollmentId) {
    const gd = await db.trnEnrollment.findFirst({
      where: { id: luot.enrollmentId, userId: actor.userId },
      select: { status: true, courseId: true },
    });
    if (!gd) throw new ActionError("NOT_FOUND", "Không tìm thấy lượt học của bạn");
    if (gd.status === "REVOKED") {
      throw new ActionError("REVOKED", "Lượt học đã bị thu hồi");
    }
    return { ...luot, courseId: gd.courseId };
  }

  return { ...luot, courseId: null as string | null };
}

export const cauHinhLuuCauTraLoi: ActionConfig<LuuCauTraLoiInput, { daLuu: boolean }> = {
  name: "luuCauTraLoi",
  permission: "elearning:lesson:learn",
  module: "elearning",
  entityType: "TrnExamAnswer",
  auditAction: "UPDATE",
  schema: luuCauTraLoiSchema,
  handler: async ({ db, actor, input }) => {
    const luot = await napLuotDangMo(db, actor, input.attemptId);

    // ⚠️ Hết giờ thì KHÔNG nhận câu mới, nhưng phần đã lưu vẫn còn. Đây là lý do
    // lưu DẦN từng câu: mất mạng mười giây không được biến thành mất cả bài.
    if (hetGio({ startedAt: luot.startedAt, durationMin: luot.exam.durationMin, now: new Date() })) {
      throw new ActionError("HET_GIO", "Đã hết giờ làm bài — nộp bài để được chấm");
    }

    // Câu phải thuộc ĐÚNG đề của lượt này.
    const eq = await db.trnExamQuestion.findFirst({
      where: { id: input.examQuestionId, examId: luot.examId },
      select: { id: true },
    });
    if (!eq) throw new ActionError("NOT_FOUND", "Câu hỏi không thuộc đề này");

    await db.trnExamAnswer.upsert({
      where: {
        attemptId_examQuestionId: { attemptId: luot.id, examQuestionId: eq.id },
      },
      update: {
        selectedChoiceIds: input.chon.map(String),
        textAnswer: input.textAnswer ?? null,
      },
      create: {
        attemptId: luot.id,
        examQuestionId: eq.id,
        selectedChoiceIds: input.chon.map(String),
        textAnswer: input.textAnswer ?? null,
      },
    });

    return { entityId: eq.id, data: { daLuu: true } };
  },
};

// ── Nộp bài ────────────────────────────────────────────────────────────────

export const nopBaiSchema = z.object({ attemptId: z.string().min(1) }).strict();
export type NopBaiInput = z.infer<typeof nopBaiSchema>;

export type KetQuaNop = {
  status: string;
  totalScore: number | null;
  passed: boolean | null;
  choChamTay: boolean;
};

export const cauHinhNopBai: ActionConfig<NopBaiInput, KetQuaNop> = {
  name: "nopBai",
  permission: "elearning:lesson:learn",
  module: "elearning",
  entityType: "TrnExamAttempt",
  auditAction: "UPDATE",
  schema: nopBaiSchema,
  handler: async ({ db, actor, input }) => {
    const luot = await napLuotDangMo(db, actor, input.attemptId);
    const now = new Date();

    const cacCau = await db.trnExamQuestion.findMany({
      where: { examId: luot.examId },
      select: {
        id: true,
        points: true,
        question: { select: { type: true, contentJson: true } },
      },
    });
    const traLoi = await db.trnExamAnswer.findMany({
      where: { attemptId: luot.id },
      select: { id: true, examQuestionId: true, selectedChoiceIds: true },
    });
    const traLoiCua = new Map(traLoi.map((a) => [a.examQuestionId, a]));

    // ⚠️ CHẤM Ở SERVER, đọc đáp án từ DB. Không nhận "đúng/sai" từ client — nhận là
    // để người ta gửi thẳng `{dung:true}` và bỏ qua cả bài thi.
    const ketCau = cacCau.map((c) => {
      const a = traLoiCua.get(c.id);
      const r = cueInlineSchema.safeParse(c.question.contentJson);
      const cau = r.success && laCauChamDuoc(r.data) ? r.data : null;
      const kq = chamMotCau({
        type: c.question.type,
        cau,
        chon: (a?.selectedChoiceIds ?? []).map(Number).filter(Number.isInteger),
        diemToiDa: c.points,
      });
      return { examQuestionId: c.id, answerId: a?.id ?? null, kq };
    });

    const tong = tinhDiemLuot({
      cacCau: ketCau.map((k) => ({ diem: k.kq.cham === "MAY" ? k.kq.diem : null })),
      passScore: luot.exam.passScore,
    });

    await db.$transaction(async (t) => {
      // Ghi điểm từng câu ĐÃ chấm máy. Câu chấm tay để `null` — `null` là "chưa ai
      // chấm", khác hẳn 0 là "đã chấm, sai".
      for (const k of ketCau) {
        if (k.kq.cham !== "MAY") continue;
        await t.trnExamAnswer.upsert({
          where: {
            attemptId_examQuestionId: {
              attemptId: luot.id,
              examQuestionId: k.examQuestionId,
            },
          },
          update: { isCorrect: k.kq.dung, score: k.kq.diem },
          create: {
            attemptId: luot.id,
            examQuestionId: k.examQuestionId,
            isCorrect: k.kq.dung,
            score: k.kq.diem,
          },
        });
      }

      await t.trnExamAttempt.update({
        where: { id: luot.id },
        data: {
          // ⚠️ `PENDING_GRADE` là trạng thái RIÊNG. Đóng thẳng sang `GRADED` khi còn
          // câu chấm tay nghĩa là chốt điểm 0 và tính trượt cho người chưa ai đọc
          // bài — và lượt đó không nằm trong hàng chờ chấm của ai.
          status: tong.choChamTay ? "PENDING_GRADE" : "GRADED",
          submittedAt: now,
          gradedAt: tong.choChamTay ? null : now,
          totalScore: tong.totalScore,
          passed: tong.passed,
        },
      });
    });

    // ── Ghi tiến độ bài học khi ĐẠT ─────────────────────────────────────────
    // Trượt thì giữ nguyên `IN_PROGRESS`: enum `TrnLessonProgressStatus` cố ý không
    // có `FAILED`, và bịa một trạng thái thứ hai cho "chưa xong" là đẻ nguồn sự
    // thật thứ hai cạnh `progressPercent`.
    if (tong.passed === true && luot.enrollmentId && luot.courseId) {
      await ghiXongBaiThi(db, {
        enrollmentId: luot.enrollmentId,
        userId: actor.userId,
        examId: luot.examId,
        courseId: luot.courseId,
        now,
      });
    }

    return {
      entityId: luot.id,
      data: {
        status: tong.choChamTay ? "PENDING_GRADE" : "GRADED",
        totalScore: tong.totalScore,
        passed: tong.passed,
        choChamTay: tong.choChamTay,
      },
      newValues: {
        attemptNo: luot.attemptNo,
        totalScore: tong.totalScore,
        passed: tong.passed,
      },
    };
  },
};

/**
 * Đánh dấu bài `QUIZ` đã xong sau khi ĐẠT.
 *
 * Tìm bài qua `TrnLesson.examId` — đường nối duy nhất (xem chú thích đầu tệp).
 */
export async function ghiXongBaiThi(
  db: ScopedDb,
  i: {
    enrollmentId: string;
    userId: string;
    examId: string;
    courseId: string;
    now: Date;
  },
): Promise<void> {
  // ⚠️ RÀNG BUỘC theo khoá của lượt ghi danh. `TrnLesson.examId` KHÔNG unique và
  // một đề gắn được vào nhiều bài, nên `findFirst` trần có thể trả về bài của khoá
  // khác — thậm chí của cơ sở khác — và ghi "đã hoàn thành" vào đúng bài đó. Không
  // gì báo: người học thấy bài mình vừa thi vẫn chưa xong, còn một người lạ ở khoá
  // khác bỗng có một bài xong mà họ chưa từng mở.
  const bai = await db.trnLesson.findFirst({
    where: {
      examId: i.examId,
      deletedAt: null,
      module: { courseId: i.courseId },
    },
    select: { id: true },
  });
  if (!bai) return;

  // Phần ghi + guard `REVOKED` + luật "đặt mốc một lần" nằm ở `lesson-done.ts` —
  // một chỗ cho mọi loại bài. Trước đây luật đó bị chép ba lần và đã trôi khỏi nhau.
  await ghiXongBai(db, {
    enrollmentId: i.enrollmentId,
    lessonId: bai.id,
    userId: i.userId,
    now: i.now,
  });
}
