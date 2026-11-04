import { z } from "zod";
import type { ActionConfig } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";

/**
 * EL-14d — MỞ KHOÁ THÊM MỘT LƯỢT THI (BR-006).
 *
 * ⚠️ Mỗi bản ghi cho THÊM ĐÚNG MỘT lượt. Không reset về 0, không nhân đôi
 * `maxAttempts`. Reset thì mất lịch sử — không ai biết người này đã thi mấy lần;
 * nhân đôi thì mỗi lần mở khoá nới theo cấp số nhân, và `previousAttemptCount` mất
 * ý nghĩa.
 *
 * ⚠️ LÝ DO BẮT BUỘC. Đây là một ngoại lệ có người chịu trách nhiệm; mở khoá không
 * lý do thì lần sau không ai biết vì sao ngoại lệ đó từng được cho, và nó thành
 * tiền lệ không ai kiểm được.
 */

export const moKhoaThiSchema = z
  .object({
    examId: z.string().min(1),
    /** Người ĐƯỢC mở khoá — không phải người bấm. */
    userId: z.string().min(1),
    reason: z
      .string()
      .trim()
      .min(10, "Ghi rõ vì sao mở thêm lượt (ít nhất 10 ký tự)")
      .max(1000),
  })
  .strict();

export type MoKhoaThiInput = z.infer<typeof moKhoaThiSchema>;

export const cauHinhMoKhoaThi: ActionConfig<
  MoKhoaThiInput,
  { unlockId: string; soLuotDaThi: number }
> = {
  name: "moKhoaThi",
  permission: "elearning:exam:unlock",
  module: "elearning",
  entityType: "TrnExamUnlock",
  auditAction: "CREATE",
  schema: moKhoaThiSchema,
  handler: async ({ db, actor, input }) => {
    // Đề đọc QUA `scopedDb` — chính lượt đọc đó là cổng cách ly. Mở khoá cho một đề
    // của cơ sở khác là can thiệp vào việc của họ, và không ai ở đó biết.
    const de = await db.trnExam.findFirst({
      where: { id: input.examId, deletedAt: null },
      select: { id: true, title: true, maxAttempts: true },
    });
    if (!de) throw new ActionError("NOT_FOUND", "Không tìm thấy đề thi");

    const soLuotDaThi = await db.trnExamAttempt.count({
      where: { examId: de.id, userId: input.userId },
    });

    // ⚠️ Mở khoá cho người CHƯA dùng hết lượt là vô nghĩa — họ vẫn thi được. Chặn
    // để bản ghi mở khoá không trở thành một dòng nhiễu trong hồ sơ của họ.
    if (soLuotDaThi < de.maxAttempts) {
      throw new ActionError(
        "CHUA_HET_LUOT",
        `Người này mới thi ${soLuotDaThi}/${de.maxAttempts} lượt — chưa cần mở thêm`,
        "userId",
      );
    }

    const mo = await db.trnExamUnlock.create({
      data: {
        examId: de.id,
        userId: input.userId,
        unlockedByUserId: actor.userId,
        reason: input.reason,
        // Chụp lại số lượt TẠI THỜI ĐIỂM mở khoá. Đọc lại sau này ra con số khác,
        // và bản ghi mất khả năng giải thích chính nó.
        previousAttemptCount: soLuotDaThi,
      },
      select: { id: true },
    });

    return {
      entityId: mo.id,
      data: { unlockId: mo.id, soLuotDaThi },
      newValues: {
        examId: de.id,
        // KHÔNG ghi `reason` vào `newValues`: nó đã nằm trong cột của bảng, và
        // nhật ký audit đọc được rộng hơn — lý do mở khoá thường nhắc tình huống
        // cá nhân của người học.
        previousAttemptCount: soLuotDaThi,
      },
    };
  },
};
