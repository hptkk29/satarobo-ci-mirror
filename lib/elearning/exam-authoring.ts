import { z } from "zod";
import type { ActionConfig, ScopedDb } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import type { Actor } from "@/lib/auth/actor";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { dungHaiPhaGhiThuTu } from "@/lib/elearning/course-outline";
import { coSoCuaCauHoi } from "@/lib/elearning/question-bank";
import { chamMayDuoc } from "@/lib/elearning/exam-grading";
import { cueInlineSchema, laCauChamDuoc } from "@/lib/elearning/lesson-cue";
import { chanGhiBanGhiChung } from "@/lib/elearning/global-write-guard";

/**
 * EL-14c — DỰNG ĐỀ THI.
 *
 * ⚠️ Đề có hai đời sống, và ranh giới giữa chúng là thứ phải giữ chặt nhất:
 *
 *  · **nháp** (`isActive = false`) — sửa gì cũng được;
 *  · **đã kích hoạt** — bộ câu và tổng điểm ĐÓNG BĂNG.
 *
 * Sửa bộ câu hay điểm của một đề đã có người thi làm LỆCH ĐIỂM của mọi lượt đã
 * chấm, im lặng — và điểm đó nằm trong hồ sơ nhân sự. `TrnExamAnswer` trỏ
 * `examQuestionId`, nên gỡ một câu ra khỏi đề là cắt luôn đường về của những câu
 * trả lời đã chấm.
 */

const deBaseSchema = z
  .object({
    title: z.string().trim().min(3, "Tên đề quá ngắn").max(200),
    /**
     * ĐÚNG MỘT trong hai. Hai cột cùng có giá trị = hai đường tìm đề, và báo cáo
     * sẽ đếm đôi.
     */
    courseId: z.union([z.null(), z.string().min(1)]).optional(),
    lessonId: z.union([z.null(), z.string().min(1)]).optional(),
    durationMin: z.number().int().min(1).max(600),
    passScore: z.number().int().min(1).max(10_000),
    maxAttempts: z.number().int().min(1).max(20),
    cooldownHours: z.number().int().min(0).max(720),
    showAnswerPolicy: z
      .enum(["NEVER", "AFTER_EACH_ATTEMPT", "AFTER_LAST_ATTEMPT"])
      .optional(),
    shuffleQuestions: z.boolean().optional(),
    shuffleChoices: z.boolean().optional(),
  })
  .strict();

function kiemNeoDe(
  d: { courseId?: string | null; lessonId?: string | null },
  ctx: z.RefinementCtx,
): void {
  const co = [d.courseId, d.lessonId].filter(Boolean).length;
  if (co !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["courseId"],
      message: "Đề phải gắn ĐÚNG MỘT chỗ: một khoá học, hoặc một bài học",
    });
  }
}

export const taoDeSchema = deBaseSchema.superRefine(kiemNeoDe);
export type TaoDeInput = z.infer<typeof taoDeSchema>;

export const cauHinhTaoDe: ActionConfig<TaoDeInput, { examId: string }> = {
  name: "taoDe",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnExam",
  auditAction: "CREATE",
  schema: taoDeSchema,
  handler: async ({ db, actor, input }) => {
    const centerId = coSoCuaCauHoi(actor);
    const orgUnitId = await orgUnitIdForCenter(centerId);

    const de = await db.trnExam.create({
      data: {
        title: input.title,
        courseId: input.courseId ?? null,
        lessonId: input.lessonId ?? null,
        durationMin: input.durationMin,
        passScore: input.passScore,
        // `maxScore` = 0 cho tới lúc kích hoạt. Đặt sẵn một con số ở đây là dựng
        // một tổng điểm không khớp bộ câu nào, và không gì báo cho tới khi có
        // người thi.
        maxScore: 0,
        maxAttempts: input.maxAttempts,
        cooldownHours: input.cooldownHours,
        showAnswerPolicy: input.showAnswerPolicy ?? "AFTER_LAST_ATTEMPT",
        shuffleQuestions: input.shuffleQuestions ?? true,
        shuffleChoices: input.shuffleChoices ?? true,
        isActive: false,
        centerId,
        orgUnitId,
        createdByUserId: actor.userId,
      },
      select: { id: true },
    });

    return {
      entityId: de.id,
      data: { examId: de.id },
      newValues: {
        title: input.title,
        durationMin: input.durationMin,
        passScore: input.passScore,
      },
    };
  },
};

/**
 * Máy khách trong một transaction — lấy TỪ kiểu của `$transaction` thay vì khai
 * tay. Khai tay một hình dạng hẹp hơn thì Prisma từ chối, và cách chữa cẩu thả là
 * ép `as never` — tức mất luôn phần kiểm kiểu ở đúng chỗ đang ghi DB.
 */
type TxDb = Parameters<Parameters<ScopedDb["$transaction"]>[0]>[0];

/**
 * Nạp đề QUA `scopedDb`.
 *
 * ⚠️ Lượt đọc này là cổng cách ly cho đề CÓ CƠ SỞ, và CHỈ cho đề có cơ sở. `TrnExam`
 * nằm trong `NULL_IS_GLOBAL_MODELS` nên đề dùng chung (`centerId = null`) lọt qua nó
 * với MỌI actor — cố ý, để kho chung không tàng hình với người cấp cơ sở. Mượn nó
 * làm cổng GHI là biến "ai cũng đọc được" thành "ai cũng sửa được: đo trên Postgres
 * thật, một actor cấp cơ sở hạ `passScore` của đề dùng chung từ 80 xuống 1 và nâng
 * `maxAttempts` lên 99, không lỗi, không cảnh báo.
 *
 * Vì vậy mọi đường ghi còn phải gọi `chanGhiBanGhiChung`.
 */
async function napDe(db: ScopedDb, examId: string) {
  const de = await db.trnExam.findFirst({
    where: { id: examId, deletedAt: null },
    select: {
      id: true,
      title: true,
      isActive: true,
      passScore: true,
      maxScore: true,
      durationMin: true,
      maxAttempts: true,
      // ⚠️ PHẢI đọc `centerId`: lượt đọc này KHÔNG phải cổng ghi cho đề dùng chung.
      centerId: true,
      _count: { select: { attempts: true } },
    },
  });
  if (!de) throw new ActionError("NOT_FOUND", "Không tìm thấy đề thi");
  return de;
}

/**
 * Đề đã KHOÁ chưa.
 *
 * ⚠️ Khoá theo `isActive`, KHÔNG theo "đã có người thi chưa". Đợi tới lúc có lượt
 * thi đầu tiên mới khoá nghĩa là người soạn sửa được đề trong khoảng giữa lúc phát
 * cho người học và lúc người đầu tiên bấm bắt đầu — và hai người cùng khoá làm hai
 * đề khác nhau mà bảng điểm coi như một.
 */
function chanKhiDaKichHoat(de: { isActive: boolean }, viec: string): void {
  if (de.isActive) {
    throw new ActionError(
      "DE_DA_KICH_HOAT",
      `Đề đã kích hoạt — không ${viec} được nữa. Tạo đề mới nếu cần thay đổi.`,
    );
  }
}

export const themCauVaoDeSchema = z
  .object({
    examId: z.string().min(1),
    questionId: z.string().min(1),
    /** Điểm của câu TRONG đề này. Bỏ trống thì lấy điểm mặc định của câu. */
    points: z.union([z.null(), z.number().int().min(1).max(100)]).optional(),
  })
  .strict();

export type ThemCauVaoDeInput = z.infer<typeof themCauVaoDeSchema>;

export const cauHinhThemCauVaoDe: ActionConfig<
  ThemCauVaoDeInput,
  { examQuestionId: string }
> = {
  name: "themCauVaoDe",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnExamQuestion",
  auditAction: "CREATE",
  schema: themCauVaoDeSchema,
  handler: async ({ db, actor, input }) => {
    const de = await napDe(db, input.examId);
    chanGhiBanGhiChung({
      actor,
      centerId: de.centerId,
      permission: "elearning:content:author",
      viec: "thêm câu vào đề này",
    });
    chanKhiDaKichHoat(de, "thêm câu");

    // Câu hỏi cũng phải qua `scopedDb`: thêm được câu của cơ sở khác vào đề của
    // mình là mượn đường vòng để đọc kho của họ.
    const cau = await db.trnQuestion.findFirst({
      where: { id: input.questionId, deletedAt: null },
      select: { id: true, defaultPoints: true, stem: true, type: true },
    });
    if (!cau) throw new ActionError("NOT_FOUND", "Không tìm thấy câu hỏi");

    // ⚠️ Câu CHẤM TAY nay vào đề được — vì `PENDING_GRADE` đã có LỐI RA
    // (`lib/elearning/exam-manual-grading.ts` + màn hàng chờ chấm). Ở PR trước nó
    // bị chặn, đúng: mở một cửa mà chưa có lối ra là để lượt thi treo vĩnh viễn và
    // người học kẹt ở một bài nghĩa vụ có hạn chót cứng.
    //
    // Nếu ngày nào đó màn chấm bị gỡ, chỗ này phải khoá lại cùng lúc.

    const soCauHienCo = await db.trnExamQuestion.count({ where: { examId: de.id } });

    try {
      const eq = await db.trnExamQuestion.create({
        data: {
          examId: de.id,
          questionId: cau.id,
          orderIndex: soCauHienCo,
          points: input.points ?? cau.defaultPoints,
        },
        select: { id: true },
      });
      return {
        entityId: eq.id,
        data: { examQuestionId: eq.id },
        newValues: { examId: de.id, points: input.points ?? cau.defaultPoints },
      };
    } catch (e) {
      // ⚠️ Đọc `e.code`, không dò chuỗi: lời nhắn của Prisma KHÔNG chứa "P2002",
      // và một nhánh dò chuỗi là nhánh không bao giờ chạy.
      const ma =
        typeof e === "object" && e !== null && "code" in e
          ? (e as { code?: unknown }).code
          : undefined;
      if (ma === "P2002") {
        throw new ActionError(
          "CAU_DA_CO_TRONG_DE",
          "Câu này đã có trong đề rồi",
          "questionId",
        );
      }
      throw e;
    }
  },
};

export const goCauKhoiDeSchema = z
  .object({ examId: z.string().min(1), examQuestionId: z.string().min(1) })
  .strict();
export type GoCauKhoiDeInput = z.infer<typeof goCauKhoiDeSchema>;

export const cauHinhGoCauKhoiDe: ActionConfig<GoCauKhoiDeInput, { daGo: boolean }> = {
  name: "goCauKhoiDe",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnExamQuestion",
  auditAction: "DELETE",
  schema: goCauKhoiDeSchema,
  handler: async ({ db, actor, input }) => {
    const de = await napDe(db, input.examId);
    chanGhiBanGhiChung({
      actor,
      centerId: de.centerId,
      permission: "elearning:content:author",
      viec: "gỡ câu khỏi đề này",
    });
    chanKhiDaKichHoat(de, "gỡ câu");

    // Câu phải thuộc ĐÚNG đề vừa qua cổng cách ly. Xoá thẳng theo `examQuestionId`
    // là gỡ được câu khỏi đề bất kỳ, và cổng ở trên thành trang trí.
    const eq = await db.trnExamQuestion.findFirst({
      where: { id: input.examQuestionId, examId: de.id },
      select: { id: true, orderIndex: true },
    });
    if (!eq) throw new ActionError("NOT_FOUND", "Không tìm thấy câu trong đề này");

    await db.$transaction(async (t) => {
      await t.trnExamQuestion.delete({ where: { id: eq.id } });
      // Dồn lại thứ tự cho liền mạch. Không dồn thì lần thêm câu sau tính
      // `orderIndex` bằng SỐ LƯỢNG và va khoá duy nhất với một chỗ trống ở giữa.
      const conLai = await t.trnExamQuestion.findMany({
        where: { examId: de.id },
        select: { id: true },
        orderBy: { orderIndex: "asc" },
      });
      await ghiLaiThuTu(t, conLai.map((x) => x.id));
    });

    return { entityId: eq.id, data: { daGo: true }, oldValues: { orderIndex: eq.orderIndex } };
  },
};

export const sapXepDeSchema = z
  .object({
    examId: z.string().min(1),
    /** Danh sách `TrnExamQuestion.id` theo thứ tự MỚI. */
    thuTu: z.array(z.string().min(1)).min(1).max(200),
  })
  .strict();
export type SapXepDeInput = z.infer<typeof sapXepDeSchema>;

export const cauHinhSapXepDe: ActionConfig<SapXepDeInput, { soCau: number }> = {
  name: "sapXepDe",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnExam",
  auditAction: "UPDATE",
  schema: sapXepDeSchema,
  handler: async ({ db, actor, input }) => {
    const de = await napDe(db, input.examId);
    chanGhiBanGhiChung({
      actor,
      centerId: de.centerId,
      permission: "elearning:content:author",
      viec: "sắp xếp đề này",
    });
    chanKhiDaKichHoat(de, "sắp xếp lại");

    const hienCo = await db.trnExamQuestion.findMany({
      where: { examId: de.id },
      select: { id: true },
    });
    const idCo = new Set(hienCo.map((x) => x.id));

    // ⚠️ Danh sách gửi lên phải phủ ĐÚNG bộ câu hiện có. Thiếu một id thì câu đó
    // giữ `orderIndex` cũ và va khoá với một câu vừa được dời tới đúng chỗ đó;
    // thừa một id thì đang dời câu của đề khác.
    if (input.thuTu.length !== hienCo.length || input.thuTu.some((id) => !idCo.has(id))) {
      throw new ActionError(
        "THU_TU_KHONG_KHOP",
        "Danh sách thứ tự không khớp bộ câu của đề — tải lại trang rồi thử lại",
        "thuTu",
      );
    }

    await db.$transaction(async (t) => {
      await ghiLaiThuTu(t, input.thuTu);
    });

    return { entityId: de.id, data: { soCau: input.thuTu.length } };
  },
};

/**
 * Ghi lại thứ tự bằng HAI PHA.
 *
 * ⚠️ `@@unique([examId, orderIndex])` làm mọi lượt hoán vị va khoá nếu ghi thẳng:
 * dời câu A về chỗ 0 trong khi câu B còn đang giữ chỗ 0. Pha 1 đẩy tất cả sang dải
 * ÂM (không ai dùng), pha 2 mới ghi số thật. Cùng khuôn `dungHaiPhaGhiThuTu` của
 * dàn bài khoá học — quy ước 16.
 *
 * ⚠️ Pha 1 phải phủ MỌI câu, kể cả câu không đổi chỗ. Bỏ qua câu đứng yên là để nó
 * giữ số cũ và va với một câu vừa được dời tới đúng số đó.
 */
async function ghiLaiThuTu(t: TxDb, ids: string[]): Promise<void> {
  const { pha1, pha2 } = dungHaiPhaGhiThuTu(ids);
  for (const b of pha1) {
    await t.trnExamQuestion.update({ where: { id: b.id }, data: { orderIndex: b.orderIndex } });
  }
  for (const b of pha2) {
    await t.trnExamQuestion.update({ where: { id: b.id }, data: { orderIndex: b.orderIndex } });
  }
}

export const kichHoatDeSchema = z.object({ examId: z.string().min(1) }).strict();
export type KichHoatDeInput = z.infer<typeof kichHoatDeSchema>;

export const cauHinhKichHoatDe: ActionConfig<
  KichHoatDeInput,
  { maxScore: number; soCau: number }
> = {
  name: "kichHoatDe",
  // Kích hoạt là đưa đề ra dùng thật ⇒ quyền XUẤT BẢN, không phải quyền soạn.
  permission: "elearning:content:publish",
  module: "elearning",
  entityType: "TrnExam",
  auditAction: "UPDATE",
  schema: kichHoatDeSchema,
  handler: async ({ db, actor, input }) => {
    const de = await napDe(db, input.examId);
    chanGhiBanGhiChung({
      actor,
      centerId: de.centerId,
      permission: "elearning:content:publish",
      viec: "kích hoạt đề này",
    });
    if (de.isActive) {
      throw new ActionError("DE_DA_KICH_HOAT", "Đề này đã kích hoạt rồi");
    }

    const cacCau = await db.trnExamQuestion.findMany({
      where: { examId: de.id },
      select: {
        points: true,
        orderIndex: true,
        question: { select: { type: true, contentJson: true } },
      },
      orderBy: { orderIndex: "asc" },
    });
    if (cacCau.length === 0) {
      throw new ActionError(
        "DE_RONG",
        "Đề chưa có câu hỏi nào — thêm câu trước khi kích hoạt",
      );
    }

    // ⚠️ CỔNG CHẶN CÂU TRẮC NGHIỆM MÀ MÁY KHÔNG ĐỌC ĐƯỢC — đặt ở ĐÂY vì đây là
    // lần cuối còn sửa được.
    //
    // `contentJson` khai kiểu `Json`, nên TypeScript không nối bên GHI với bên
    // ĐỌC và không có gì đỏ khi hai bên lệch nhau. Một câu không parse được rơi
    // vào nhánh "chờ người chấm" của `chamMotCau` — cố ý, để không biến bản ghi
    // bẩn thành điểm 0 của người học. Nhưng hệ quả dây chuyền thì nặng: MỌI lượt
    // của MỌI người trên đề đó đóng ở `PENDING_GRADE`, bài học không bao giờ lên
    // xong, và sau khi kích hoạt thì bộ câu bị đóng băng nên không gỡ câu hỏng ra
    // được nữa.
    //
    // Bắt tại cổng thì người soạn sửa câu trong kho rồi kích hoạt lại — mất một
    // phút. Để lọt thì phải chấm tay từng lượt của cả trăm người.
    const hong = cacCau
      .map((c, i) => ({ c, so: i + 1 }))
      .filter(({ c }) => chamMayDuoc(c.question.type))
      .filter(({ c }) => {
        const r = cueInlineSchema.safeParse(c.question.contentJson);
        return !r.success || !laCauChamDuoc(r.data);
      })
      .map(({ so }) => so);
    if (hong.length > 0) {
      throw new ActionError(
        "CAU_MAY_KHONG_DOC_DUOC",
        `Hệ thống không đọc được nội dung câu ${hong.join(", ")} nên không tự chấm được. Mở câu đó trong kho, lưu lại, rồi kích hoạt lại.`,
      );
    }

    const maxScore = cacCau.reduce((s, c) => s + c.points, 0);
    // ⚠️ Điểm đạt phải nằm TRONG thang điểm. `passScore > maxScore` là một đề không
    // ai qua nổi, và người soạn không có cách nào biết trước khi có người trượt.
    if (de.passScore > maxScore) {
      throw new ActionError(
        "DIEM_DAT_VUOT_THANG",
        `Điểm đạt (${de.passScore}) lớn hơn tổng điểm của đề (${maxScore}) — không ai qua được`,
        "passScore",
      );
    }

    await db.trnExam.update({
      where: { id: de.id },
      // Đóng băng tổng điểm TẠI ĐÂY. Tính lại lúc chấm là để một câu bị sửa điểm
      // sau đó làm lệch thang của những lượt đã chấm.
      data: { isActive: true, maxScore },
    });

    return {
      entityId: de.id,
      data: { maxScore, soCau: cacCau.length },
      oldValues: { isActive: false, maxScore: de.maxScore },
      newValues: { isActive: true, maxScore, soCau: cacCau.length },
    };
  },
};

/** Cơ sở của đề — cùng luật với câu hỏi, tái dùng để hai bên không trôi khỏi nhau. */
export { coSoCuaCauHoi as coSoCuaDe };
export type { Actor };

export const ganDeVaoBaiSchema = z
  .object({
    lessonId: z.string().min(1),
    /** `null` = gỡ đề khỏi bài. */
    examId: z.union([z.null(), z.string().min(1)]),
  })
  .strict();
export type GanDeVaoBaiInput = z.infer<typeof ganDeVaoBaiSchema>;

/**
 * EL-14d — GẮN ĐỀ VÀO MỘT BÀI KIỂM TRA.
 *
 * ⚠️ Không có action này thì mở loại bài `QUIZ` là dựng lại đúng cái bẫy vừa gỡ,
 * chỉ đổi hình dạng: người soạn tạo được bài kiểm tra, cổng xuất bản đòi `examId`,
 * và KHÔNG màn nào đặt được nó — họ kẹt ở bước xuất bản thay vì người học kẹt ở
 * bước học.
 *
 * ⚠️ `TrnLesson.examId` là ĐƯỜNG NỐI DUY NHẤT giữa bài và đề (xem chú thích đầu
 * `exam-taking.ts`). `TrnExam.lessonId` để dành, không đường nào ghi.
 */
export const cauHinhGanDeVaoBai: ActionConfig<GanDeVaoBaiInput, { examId: string | null }> = {
  name: "ganDeVaoBai",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnLesson",
  auditAction: "UPDATE",
  schema: ganDeVaoBaiSchema,
  handler: async ({ db, input }) => {
    const bai = await db.trnLesson.findFirst({
      where: { id: input.lessonId, deletedAt: null },
      select: { id: true, kind: true, examId: true, module: { select: { courseId: true } } },
    });
    if (!bai) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");

    // Cách ly đi qua chuỗi cha — `TrnLesson` không nằm trong `SCOPED_MODELS`, và
    // `scopedDb` không che đường ghi.
    const khoa = await db.trnCourse.findFirst({
      where: { id: bai.module.courseId, deletedAt: null },
      select: { id: true },
    });
    if (!khoa) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");

    if (bai.kind !== "QUIZ") {
      throw new ActionError(
        "WRONG_KIND",
        `Chỉ bài dạng "Bài kiểm tra" mới gắn được đề. Bài này là ${bai.kind}.`,
        "lessonId",
      );
    }

    if (input.examId) {
      const de = await db.trnExam.findFirst({
        where: { id: input.examId, deletedAt: null },
        select: { id: true, isActive: true },
      });
      if (!de) throw new ActionError("NOT_FOUND", "Không tìm thấy đề thi");
      // ⚠️ Chỉ gắn đề ĐÃ KÍCH HOẠT. Gắn đề nháp là để bài đi ra với người học trên
      // một bộ câu còn sửa được — và đề sửa xong thì điểm của người thi trước lệch
      // khỏi thang của người thi sau.
      if (!de.isActive) {
        throw new ActionError(
          "DE_CHUA_KICH_HOAT",
          "Chỉ gắn được đề đã kích hoạt — kích hoạt đề trước",
          "examId",
        );
      }
    }

    await db.trnLesson.update({
      where: { id: bai.id },
      data: { examId: input.examId },
    });

    return {
      entityId: bai.id,
      data: { examId: input.examId },
      oldValues: { examId: bai.examId },
      newValues: { examId: input.examId },
    };
  },
};

/**
 * SỬA thông số một đề còn NHÁP.
 *
 * ⚠️ Màn dựng đề bảo người soạn "thêm câu, hoặc **sửa điểm đạt**" khi điểm đạt vượt
 * tổng điểm — nhưng trước hàm này không có đường nào sửa điểm đạt. Đó là quy ước 20
 * nhìn từ phía ngược lại: bày ra một lựa chọn không có lối đi. Người soạn đọc câu đó,
 * đi tìm nút, không thấy, và phải xoá đề làm lại từ đầu.
 *
 * ⚠️ CHỈ sửa được khi còn NHÁP. Đề đã kích hoạt là đề có người đang thi: đổi điểm đạt
 * lúc đó là chấm lại hồi tố những lượt đã xong bằng một thang khác, và không ai được
 * báo. `maxScore` KHÔNG sửa tay ở đây — nó là tổng điểm các câu, đóng băng lúc kích
 * hoạt.
 */
export const suaDeSchema = z
  .object({
    examId: z.string().min(1),
    title: z.string().trim().min(3, "Tên đề quá ngắn").max(200),
    passScore: z.number().int().min(0).max(10_000),
    durationMin: z.number().int().min(1).max(600),
    maxAttempts: z.number().int().min(1).max(20),
  })
  .strict();

export type SuaDeInput = z.infer<typeof suaDeSchema>;

export const cauHinhSuaDe: ActionConfig<SuaDeInput, { id: string }> = {
  name: "suaDe",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnExam",
  auditAction: "UPDATE",
  schema: suaDeSchema,
  handler: async ({ db, actor, input }) => {
    const de = await napDe(db, input.examId);
    chanGhiBanGhiChung({
      actor,
      centerId: de.centerId,
      permission: "elearning:content:author",
      viec: "sửa đề này",
    });
    if (de.isActive) {
      throw new ActionError(
        "DE_DA_KICH_HOAT",
        "Đề đã kích hoạt — sửa thông số lúc này là chấm lại hồi tố các lượt đã xong",
      );
    }

    await db.trnExam.update({
      where: { id: de.id },
      data: {
        title: input.title,
        passScore: input.passScore,
        durationMin: input.durationMin,
        maxAttempts: input.maxAttempts,
      },
    });

    return {
      entityId: de.id,
      data: { id: de.id },
      oldValues: {
        title: de.title,
        passScore: de.passScore,
        durationMin: de.durationMin,
        maxAttempts: de.maxAttempts,
      },
      newValues: {
        title: input.title,
        passScore: input.passScore,
        durationMin: input.durationMin,
        maxAttempts: input.maxAttempts,
      },
    };
  },
};