import { z } from "zod";
import type { ActionConfig } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { dsMucSchema, tinhDiemBaiNop } from "@/lib/elearning/rubric-shape";
import { ghiXongBai } from "@/lib/elearning/lesson-done";
import { tinhBuSla, hanSauKhiBu } from "@/lib/elearning/sla-bu";

/**
 * EL-15c — CHẤM BÀI TẬP theo khung.
 *
 * ⚠️ Chấm TRỌN một lượt trong MỘT lần, không lưu nháp — cùng luật với chấm bài thi
 * (EL-14e) và cùng lý do: chấm dở dang đẻ ra một trạng thái thứ ba mà không cột nào
 * mô tả được, và không ai biết lượt đó còn chờ ai.
 *
 * ⚠️ Khung đọc TỪ LƯỢT NỘP (`TrnSubmission.rubricId`), KHÔNG từ `TrnLesson.rubricId`.
 * Cột trên bài sửa được bất cứ lúc nào; đọc nó lúc chấm là chấm bài cũ bằng thước
 * mới, `TrnRubricScore.criterionId` trỏ tiêu chí của khung khác, và bảng điểm in lại
 * ra số khác mà không ai giải thích được.
 *
 * ⚠️ KHÔNG có khoá quyền thứ 18. Dùng `elearning:exam:grade` — mô tả của khoá đó
 * trong registry ghi nguyên văn "Chấm tay bài thi/BÀI TẬP theo rubric", có từ EL-02.
 */

export const chamBaiTapSchema = z
  .object({
    submissionId: z.string().min(1),
    /** Mức đã chọn cho từng tiêu chí. Phải phủ ĐỦ mọi tiêu chí của khung. */
    diem: z
      .array(
        z.object({
          criterionId: z.string().min(1),
          levelIndex: z.number().int().min(0).max(9),
          note: z.union([z.null(), z.string().trim().max(2000)]).optional(),
        }),
      )
      .min(1)
      .max(50)
      .superRefine((ds, ctx) => {
        // Cùng một tiêu chí gửi hai lần với hai mức khác nhau thì vòng `upsert`
        // chạy tuần tự và mức SAU đè mức TRƯỚC — im lặng, không ai biết mức nào
        // đã thắng.
        const thay = new Set<string>();
        for (const d of ds) {
          if (thay.has(d.criterionId)) {
            ctx.addIssue({
              code: "custom",
              message: "Một tiêu chí chỉ được chấm một lần trong cùng lượt",
            });
            return;
          }
          thay.add(d.criterionId);
        }
      }),
    /** `true` = trả bài về cho người học sửa, không chốt điểm. */
    traVeSua: z.boolean().optional(),
    feedback: z.union([z.null(), z.string().trim().max(4000)]).optional(),
  })
  .strict();

export type ChamBaiTapInput = z.infer<typeof chamBaiTapSchema>;

export type KetQuaChamBaiTap = {
  totalScore: number;
  passed: boolean;
  traVeSua: boolean;
  /** `true` = điểm đã chốt nhưng chưa đánh dấu được bài học là xong. */
  ghiTienDoLoi: boolean;
};

export const cauHinhChamBaiTap: ActionConfig<ChamBaiTapInput, KetQuaChamBaiTap> = {
  name: "chamBaiTap",
  permission: "elearning:exam:grade",
  module: "elearning",
  entityType: "TrnSubmission",
  auditAction: "UPDATE",
  schema: chamBaiTapSchema,
  handler: async ({ db, actor, input }) => {
    // Lượt nộp đọc QUA `scopedDb` — chính lượt đọc đó là cổng cách ly cơ sở.
    const lan = await db.trnSubmission.findFirst({
      where: { id: input.submissionId },
      select: {
        id: true,
        lessonId: true,
        enrollmentId: true,
        userId: true,
        attemptNo: true,
        status: true,
        rubricId: true,
        dueGradeAt: true,
        slaBuNgayLam: true,
      },
    });
    if (!lan) throw new ActionError("NOT_FOUND", "Không tìm thấy lượt nộp");

    // ⚠️ CHỈ chấm lượt đang chờ. Chấm lại một lượt đã đóng là đổi một con số đã nằm
    // trong hồ sơ nhân sự — việc đó cần một đường riêng có lý do và có dấu vết.
    if (lan.status !== "SUBMITTED") {
      throw new ActionError(
        "LUOT_KHONG_CHO_CHAM",
        lan.status === "GRADED"
          ? "Lượt này đã chấm rồi — sửa điểm đã chấm cần một đường riêng"
          : "Lượt này chưa nộp",
      );
    }
    if (!lan.rubricId) {
      throw new ActionError(
        "LUOT_KHONG_CO_KHUNG",
        "Lượt nộp này không gắn khung chấm nào — báo kỹ thuật, đừng chấm tay",
      );
    }

    const khung = await db.trnRubric.findFirst({
      where: { id: lan.rubricId },
      select: {
        id: true,
        passPoints: true,
        totalPoints: true,
        criteria: {
          select: { id: true, label: true, levelsJson: true },
          orderBy: { orderIndex: "asc" },
        },
      },
    });
    if (!khung) throw new ActionError("NOT_FOUND", "Không tìm thấy khung chấm");
    if (khung.criteria.length === 0) {
      throw new ActionError("KHUNG_RONG", "Khung chấm không có tiêu chí nào");
    }

    // ── Kiểm đầu vào TRƯỚC khi ghi ──────────────────────────────────────────
    const mucCua = new Map<string, { points: number }[]>();
    for (const tc of khung.criteria) {
      const r = dsMucSchema.safeParse(tc.levelsJson);
      if (!r.success) {
        // Cùng bài học với câu thi hỏng nội dung ở EL-14e: nói ra chỗ hỏng thay vì
        // để người chấm chọn một mức không tồn tại.
        throw new ActionError(
          "TIEU_CHI_HONG",
          `Không đọc được các mức của tiêu chí "${tc.label}" — báo Đào tạo sửa khung`,
        );
      }
      mucCua.set(tc.id, r.data);
    }

    const daNhap = new Set(input.diem.map((d) => d.criterionId));
    for (const d of input.diem) {
      const muc = mucCua.get(d.criterionId);
      if (!muc) {
        throw new ActionError(
          "TIEU_CHI_NGOAI_KHUNG",
          "Có tiêu chí không thuộc khung của lượt nộp này",
          "diem",
        );
      }
      if (d.levelIndex >= muc.length) {
        throw new ActionError(
          "MUC_KHONG_CO",
          `Tiêu chí này chỉ có ${muc.length} mức`,
          "diem",
        );
      }
    }

    // ⚠️ Phải phủ ĐỦ tiêu chí. Thiếu một tiêu chí là chốt điểm cho một phần bài mà
    // chưa ai đọc — và `tinhDiemBaiNop` cố ý trả `null` chứ không cộng tạm.
    const thieu = khung.criteria.filter((tc) => !daNhap.has(tc.id));
    if (thieu.length > 0) {
      throw new ActionError(
        "CHUA_CHAM_DU",
        `Còn ${thieu.length} tiêu chí chưa chọn mức — chấm đủ rồi mới chốt được`,
        "diem",
      );
    }

    const diemTheoTieuChi = khung.criteria.map((tc) => {
      const d = input.diem.find((x) => x.criterionId === tc.id)!;
      return {
        criterionId: tc.id,
        levelIndex: d.levelIndex,
        points: mucCua.get(tc.id)![d.levelIndex]!.points,
        note: d.note ?? null,
      };
    });

    const ket = tinhDiemBaiNop({
      diem: diemTheoTieuChi.map((x) => x.points),
      passPoints: khung.passPoints,
    });

    // ── TRẢ VỀ SỬA: ghi điểm từng tiêu chí nhưng KHÔNG chốt ────────────────
    // Người chấm đã đọc bài và đã cho điểm; giữ lại phần đó để lượt sau người học
    // biết mình yếu chỗ nào. Chỉ khác ở chỗ lượt này không thành kết quả cuối.
    const trangThaiMoi = input.traVeSua ? "NEEDS_REVISION" : "GRADED";
    const now = new Date();

    await db.$transaction(async (t) => {
      for (const d of diemTheoTieuChi) {
        await t.trnRubricScore.upsert({
          where: {
            submissionId_criterionId: {
              submissionId: lan.id,
              criterionId: d.criterionId,
            },
          },
          update: { levelIndex: d.levelIndex, points: d.points, note: d.note },
          create: {
            submissionId: lan.id,
            criterionId: d.criterionId,
            levelIndex: d.levelIndex,
            // ⚠️ CHÉP điểm của mức, không join sống `levelsJson`. Sửa khung sau đó
            // sẽ đổi HỒI TỐ điểm của mọi bài đã chấm nếu join sống.
            points: d.points,
            note: d.note,
          },
        });
      }

      // ⚠️ `updateMany` CÓ `status` trong `where`, không phải `update` theo id.
      // Hai người chấm cùng mở một bài trong hàng chờ là chuyện thường; `update`
      // theo id sẽ ghi đè lặng lẽ và bài được chấm hai lần bằng hai thang.
      const ghi = await t.trnSubmission.updateMany({
        where: { id: lan.id, status: "SUBMITTED" },
        data: {
          status: trangThaiMoi,
          gradedAt: now,
          gradedByUserId: actor.userId,
          // ⚠️ TRẢ VỀ SỬA thì `score`/`passed` để NULL.
          //
          // Lược đồ ghi rõ hai cột này là "null cho tới khi chấm xong", và `null`
          // KHÁC `false`: `false` nghĩa là "đã chấm, trượt". Ghi `passed: false`
          // cho một lượt được trả về để sửa là đóng sổ TRƯỢT cho một bài chưa có
          // kết quả cuối — con số đó rồi sẽ chạy vào báo cáo như một lần trượt thật.
          //
          // Điểm từng tiêu chí VẪN được ghi ở `TrnRubricScore` phía trên: người học
          // vẫn thấy mình yếu chỗ nào, chỉ là lượt này không thành kết quả.
          score: input.traVeSua ? null : ket.tong,
          passed: input.traVeSua ? null : ket.dat,
          feedback: input.feedback ?? null,
        },
      });
      if (ghi.count === 0) {
        throw new ActionError(
          "DA_CO_NGUOI_CHAM",
          "Vừa có người khác chấm xong bài này — mở lại hàng chờ để xem kết quả",
        );
      }
    });

    // ── CHỐT phần bù SLA — đây là lần cuối, `gradedAt` vừa được đặt ────────
    //
    // ⚠️ Làm ở ĐÂY chứ không để cron: sau lượt chấm này `gradedAt` cố định, nên tổng
    // nợ là con số CUỐI CÙNG. Để cron gánh thì nó phải quét mãi cả nhóm đã chấm —
    // một cửa sổ không bao giờ vơi, và nó sẽ chiếm chỗ của những lượt vừa trễ.
    //
    // ⚠️ Nằm NGOÀI giao dịch chấm, và nuốt lỗi: điểm đã chốt rồi. Bù thiếu một
    // ngày là chuyện sửa được; mất cả lượt chấm thì không.
    let buLoi = false;
    if (lan.enrollmentId) {
      try {
        const { themNgayLam, tongDangLe } = tinhBuSla({
          dueGradeAt: lan.dueGradeAt,
          gradedAt: now,
          now,
          so: { daBuNgayLam: lan.slaBuNgayLam },
        });
        if (themNgayLam > 0) {
          const gd = await db.trnEnrollment.findFirst({
            where: { id: lan.enrollmentId },
            select: { id: true, dueAt: true, slaGraceDays: true, status: true },
          });
          if (gd && gd.status !== "REVOKED") {
            await db.$transaction(async (t) => {
              await t.trnEnrollment.update({
                where: { id: gd.id },
                data: {
                  dueAt: hanSauKhiBu(gd.dueAt, themNgayLam),
                  slaGraceDays: gd.slaGraceDays + themNgayLam,
                  ...(gd.status === "OVERDUE" ? { status: "IN_PROGRESS" } : {}),
                },
              });
              await t.trnSubmission.update({
                where: { id: lan.id },
                data: { slaBuNgayLam: tongDangLe },
              });
            });
          }
        }
      } catch {
        buLoi = true;
      }
    }

    // ── ĐẠT thì bài học lên xong ───────────────────────────────────────────
    let ghiTienDoLoi = false;
    if (!input.traVeSua && ket.dat === true && lan.enrollmentId) {
      try {
        // Guard `REVOKED` + luật "đặt mốc một lần" nằm TRONG `ghiXongBai`.
        await ghiXongBai(db, {
          enrollmentId: lan.enrollmentId,
          lessonId: lan.lessonId,
          userId: lan.userId,
          now,
        });
      } catch {
        // Giao dịch trên ĐÃ commit — điểm đã nằm trong hồ sơ. Ném tiếp thì
        // `defineAction` trả lỗi và BỎ QUA bước ghi audit, nên con số đã chốt lại
        // không có dấu vết ai chốt.
        ghiTienDoLoi = true;
      }
    }

    return {
      entityId: lan.id,
      data: {
        totalScore: ket.tong ?? 0,
        passed: ket.dat ?? false,
        traVeSua: input.traVeSua === true,
        ghiTienDoLoi: ghiTienDoLoi || buLoi,
      },
      oldValues: { status: "SUBMITTED", score: null },
      newValues: {
        status: trangThaiMoi,
        attemptNo: lan.attemptNo,
        totalScore: ket.tong,
        passed: ket.dat,
        ghiTienDoLoi,
        // KHÔNG ghi `feedback` hay `note` vào audit: chúng là nhận xét về bài làm
        // của một người, và nhật ký audit đọc được rộng hơn màn chấm.
      },
    };
  },
};
