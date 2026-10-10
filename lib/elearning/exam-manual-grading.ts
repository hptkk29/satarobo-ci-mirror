import { z } from "zod";
import type { ActionConfig } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { tinhDiemLuot } from "@/lib/elearning/exam-grading";
import { ghiXongBaiThi } from "@/lib/elearning/exam-taking";

/**
 * EL-14e — CHẤM TAY.
 *
 * ⚠️ Đây là LỐI RA của trạng thái `PENDING_GRADE`. Không có nó thì mọi lượt thi có
 * câu chờ người treo vĩnh viễn: điểm mãi `null`, bài không bao giờ xong, và người
 * học đứng nguyên tại một bài nghĩa vụ có hạn chót cứng cho tới lúc bị khoá vì quá
 * hạn — không làm gì sai và không có đường nào tự thoát.
 *
 * ⚠️ "CẦN NGƯỜI CHẤM" = **CÂU CHƯA CÓ ĐIỂM**, không phải "câu thuộc loại tự luận".
 * Hai thứ đó KHÔNG trùng nhau, và lần đầu viết tệp này tôi đã lẫn chúng:
 *
 *   `chamMotCau` CỐ Ý trả `{cham:"TAY"}` cho một câu trắc nghiệm mà `contentJson`
 *   không đọc được — "một bản ghi bẩn không được biến thành điểm 0 của người học".
 *   Nếu ở đây lọc theo LOẠI thì đúng câu ấy không bao giờ được hỏi điểm, người chấm
 *   bị chặn nếu cố cho điểm, rồi phép tính lại biến `null` thành 0 và chốt lượt.
 *   Tệ hơn: đề TOÀN trắc nghiệm mà có một câu hỏng thì KHÔNG có ô nào để nhập, và
 *   `PENDING_GRADE` vẫn không có lối ra — đúng thứ tệp này sinh ra để gỡ.
 *
 * Vì vậy: lọc theo ĐIỂM (`score == null`), và chỉ từ chối khi câu ĐÃ CÓ điểm.
 *
 * ⚠️ Chấm TRỌN một lượt trong MỘT lần, không chấm dở dang. Chấm từng câu rồi để đó
 * là đẻ ra một trạng thái thứ ba ("đã chấm một nửa") mà không cột nào mô tả được,
 * và không ai biết lượt đó còn chờ ai.
 */

export const chamLuotThiSchema = z
  .object({
    attemptId: z.string().min(1),
    /** Điểm cho từng câu chưa có điểm. Phải phủ ĐỦ các câu đó. */
    diem: z
      .array(
        z.object({
          examQuestionId: z.string().min(1),
          score: z.number().int().min(0).max(1000),
          note: z.union([z.null(), z.string().trim().max(2000)]).optional(),
        }),
      )
      .min(1)
      .max(200)
      // ⚠️ KHỬ TRÙNG. Cùng một câu gửi lên hai lần với hai điểm khác nhau thì vòng
      // `upsert` chạy tuần tự và điểm SAU đè điểm TRƯỚC — im lặng, không ai biết
      // con số nào đã thắng. Chặn ở cổng vào thay vì để nó thành xổ số.
      .superRefine((ds, ctx) => {
        const thay = new Set<string>();
        for (const d of ds) {
          if (thay.has(d.examQuestionId)) {
            ctx.addIssue({
              code: "custom",
              message: "Một câu chỉ được cho điểm một lần trong cùng lượt chấm",
            });
            return;
          }
          thay.add(d.examQuestionId);
        }
      }),
    /** Nhận xét chung cho cả lượt. */
    feedback: z.union([z.null(), z.string().trim().max(4000)]).optional(),
  })
  .strict();

export type ChamLuotThiInput = z.infer<typeof chamLuotThiSchema>;

export type KetQuaCham = {
  totalScore: number;
  passed: boolean;
  /** `true` = điểm đã chốt nhưng chưa đánh dấu được bài học là xong. */
  ghiTienDoLoi: boolean;
};

export const cauHinhChamLuotThi: ActionConfig<ChamLuotThiInput, KetQuaCham> = {
  name: "chamLuotThi",
  permission: "elearning:exam:grade",
  module: "elearning",
  entityType: "TrnExamAttempt",
  auditAction: "UPDATE",
  schema: chamLuotThiSchema,
  handler: async ({ db, actor, input }) => {
    // Lượt thi đọc QUA `scopedDb` — chính lượt đọc đó là cổng cách ly. Chấm bài của
    // cơ sở khác là can thiệp vào hồ sơ nhân sự của họ, và không ai ở đó biết.
    //
    // ⚠️ Nói cho đúng hiện trạng: HÔM NAY cổng này chưa chắn ai, vì cả ba vai có
    // `elearning:exam:grade` đều được cấp ở phạm vi GLOBAL. Nó là chỗ dựa cho ngày
    // có vai chấm theo cơ sở — giữ nguyên, đừng bỏ vì "đang không chặn gì".
    const luot = await db.trnExamAttempt.findFirst({
      where: { id: input.attemptId },
      select: {
        id: true,
        examId: true,
        userId: true,
        enrollmentId: true,
        status: true,
        attemptNo: true,
        exam: { select: { passScore: true } },
      },
    });
    if (!luot) throw new ActionError("NOT_FOUND", "Không tìm thấy lượt thi");

    // ⚠️ CHỈ chấm lượt đang chờ. Chấm lại một lượt đã đóng là đổi một con số đã nằm
    // trong hồ sơ nhân sự — việc đó cần một đường riêng có lý do và có dấu vết,
    // không phải cùng nút với lần chấm đầu.
    if (luot.status !== "PENDING_GRADE") {
      throw new ActionError(
        "LUOT_KHONG_CHO_CHAM",
        luot.status === "GRADED"
          ? "Lượt này đã chấm rồi — sửa điểm đã chấm cần một đường riêng"
          : "Lượt này chưa nộp",
      );
    }

    const cacCau = await db.trnExamQuestion.findMany({
      where: { examId: luot.examId },
      select: { id: true, points: true },
    });
    const diemToiDa = new Map(cacCau.map((c) => [c.id, c.points]));

    const traLoi = await db.trnExamAnswer.findMany({
      where: { attemptId: luot.id },
      select: { examQuestionId: true, score: true },
    });
    const diemHienCo = new Map(traLoi.map((a) => [a.examQuestionId, a.score]));

    // ── Kiểm đầu vào TRƯỚC khi ghi ──────────────────────────────────────────
    for (const d of input.diem) {
      const toiDa = diemToiDa.get(d.examQuestionId);
      if (toiDa == null) {
        throw new ActionError(
          "CAU_NGOAI_DE",
          "Có câu không thuộc đề của lượt thi này",
          "diem",
        );
      }
      // ⚠️ Chặn điểm VƯỢT thang của câu. Không chặn thì một lỗi gõ phím đẩy tổng
      // điểm vượt `maxScore`, và người trượt thật bỗng "đạt" — trên một con số đi
      // vào hồ sơ nhân sự.
      if (d.score > toiDa) {
        throw new ActionError(
          "DIEM_VUOT_THANG",
          `Câu này tối đa ${toiDa} điểm`,
          "diem",
        );
      }
      // ⚠️ Chặn theo ĐIỂM ĐÃ CÓ, không theo LOẠI câu. Câu nào đã có điểm — máy chấm
      // hay người chấm lần trước — thì không sửa ở đây: mở đường ghi đè im lặng lên
      // một con số đã chốt là để hai lượt cùng đề được chấm bằng hai thang.
      //
      // Lọc theo LOẠI thì sai ở đúng ca `chamMotCau` cố ý để dành cho người: câu
      // trắc nghiệm mà nội dung không đọc được. Câu đó THUỘC loại chấm máy nhưng
      // KHÔNG có điểm, và nó phải chấm được.
      if (diemHienCo.get(d.examQuestionId) != null) {
        throw new ActionError(
          "CAU_DA_CO_DIEM",
          "Câu này đã có điểm — không sửa điểm đã chấm ở đây",
          "diem",
        );
      }
    }

    // ── Phải phủ ĐỦ câu còn thiếu điểm ──────────────────────────────────────
    // KHÔNG lọc theo loại: xem chú thích đầu tệp. Mọi câu chưa có điểm đều đang
    // chờ một con người, kể cả câu trắc nghiệm mà hệ thống không đọc nổi nội dung.
    const dangCho = cacCau
      .filter((c) => diemHienCo.get(c.id) == null)
      .map((c) => c.id);
    const daNhap = new Set(input.diem.map((d) => d.examQuestionId));
    const conThieu = dangCho.filter((id) => !daNhap.has(id));
    if (conThieu.length > 0) {
      // Chấm dở dang là đẻ một trạng thái thứ ba mà không cột nào mô tả được, và
      // không ai biết lượt đó còn chờ ai.
      throw new ActionError(
        "CHUA_CHAM_DU",
        `Còn ${conThieu.length} câu chưa cho điểm — chấm đủ rồi mới chốt được`,
        "diem",
      );
    }

    const tong = await db.$transaction(async (t) => {
      for (const d of input.diem) {
        await t.trnExamAnswer.upsert({
          where: {
            attemptId_examQuestionId: {
              attemptId: luot.id,
              examQuestionId: d.examQuestionId,
            },
          },
          update: {
            score: d.score,
            // `isCorrect` cho câu tự luận nghĩa là "đạt điểm tối đa" — không phải
            // một khái niệm đúng/sai thật. Ghi để báo cáo đọc được cùng một cột.
            isCorrect: d.score >= (diemToiDa.get(d.examQuestionId) ?? 0),
            graderNote: d.note ?? null,
          },
          create: {
            attemptId: luot.id,
            examQuestionId: d.examQuestionId,
            score: d.score,
            isCorrect: d.score >= (diemToiDa.get(d.examQuestionId) ?? 0),
            graderNote: d.note ?? null,
          },
        });
      }

      // Tính lại TRÊN TOÀN BỘ câu của đề, không chỉ phần vừa chấm.
      const sau = await t.trnExamAnswer.findMany({
        where: { attemptId: luot.id },
        select: { examQuestionId: true, score: true },
      });
      const diemSau = new Map(sau.map((a) => [a.examQuestionId, a.score]));
      const ket = tinhDiemLuot({
        // Câu KHÔNG có dòng trả lời nào (người học bỏ trống) tính 0, không tính là
        // chưa chấm — nếu không thì một câu bỏ trống giữ lượt ở `PENDING_GRADE`
        // mãi mãi.
        cacCau: cacCau.map((c) => ({ diem: diemSau.get(c.id) ?? 0 })),
        passScore: luot.exam.passScore,
      });

      // ⚠️ `updateMany` CÓ `status` TRONG `where`, không phải `update` theo id.
      //
      // Hai người chấm cùng mở một bài trong hàng chờ là chuyện thường ngày. Phép
      // kiểm `PENDING_GRADE` ở trên chạy NGOÀI giao dịch, nên tới lúc ghi thì lượt
      // có thể đã bị người kia chốt. `update` theo id sẽ ghi đè lặng lẽ: điểm của
      // người chấm sau đè điểm người chấm trước, `gradedByUserId` đổi tên, và không
      // ai biết bài đã được chấm hai lần bằng hai thang.
      //
      // Điều kiện đặt vào `where` để chính DB phân xử: ai tới trước thắng, người
      // sau nhận `count = 0` và được báo.
      const ghi = await t.trnExamAttempt.updateMany({
        where: { id: luot.id, status: "PENDING_GRADE" },
        data: {
          status: "GRADED",
          gradedAt: new Date(),
          gradedByUserId: actor.userId,
          totalScore: ket.totalScore,
          passed: ket.passed,
          feedback: input.feedback ?? null,
        },
      });
      if (ghi.count === 0) {
        throw new ActionError(
          "DA_CO_NGUOI_CHAM",
          "Vừa có người khác chấm xong bài này — mở lại hàng chờ để xem kết quả",
        );
      }
      return ket;
    });

    // Đạt thì bài học lên DONE — cùng đường với lượt chấm máy, không chép lại.
    let ghiTienDoLoi = false;
    if (tong.passed === true && luot.enrollmentId) {
      const gd = await db.trnEnrollment.findFirst({
        where: { id: luot.enrollmentId },
        select: { courseId: true, status: true },
      });
      // ⚠️ Guard `REVOKED` nay nằm TRONG `ghiXongBai` (`lesson-done.ts`) — một chỗ
      // cho mọi loại bài, thay vì mỗi call-site tự nhớ. Giữ lại một bản chép ở đây
      // là dựng lại đúng cái đã trôi khỏi nhau ba lần.
      //
      // Điểm thì VẪN ghi: họ đã làm bài thật, và xoá công đó đi là một sai lầm khác.
      if (gd) {
        try {
          await ghiXongBaiThi(db, {
            enrollmentId: luot.enrollmentId,
            userId: luot.userId,
            examId: luot.examId,
            courseId: gd.courseId,
            now: new Date(),
          });
        } catch {
          // ⚠️ KHÔNG để lỗi ở đây nuốt mất cả lượt chấm. Giao dịch trên ĐÃ commit —
          // điểm đã nằm trong hồ sơ. Ném tiếp thì `defineAction` trả lỗi và BỎ QUA
          // bước ghi audit, nên con số đã chốt lại không có dấu vết ai chốt; người
          // chấm thì tưởng chưa xong và chấm lại (lần sau nhận `DA_CO_NGUOI_CHAM`,
          // không hiểu vì sao).
          //
          // Nói thật với người chấm bằng cờ dưới đây thay vì im lặng.
          ghiTienDoLoi = true;
        }
      }
    }

    return {
      entityId: luot.id,
      data: {
        totalScore: tong.totalScore ?? 0,
        passed: tong.passed ?? false,
        ghiTienDoLoi,
      },
      oldValues: { status: "PENDING_GRADE", totalScore: null },
      newValues: {
        status: "GRADED",
        attemptNo: luot.attemptNo,
        totalScore: tong.totalScore,
        passed: tong.passed,
        ghiTienDoLoi,
        // KHÔNG ghi `feedback` hay `note` vào audit: chúng là nhận xét về bài làm
        // của một người, và nhật ký audit đọc được rộng hơn màn chấm.
      },
    };
  },
};
