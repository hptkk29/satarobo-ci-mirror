import { z } from "zod";
import type { ActionConfig, ScopedDb } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { cueInlineSchema, CUE_TOI_DA } from "@/lib/elearning/lesson-cue";

/**
 * EL-12c — SOẠN CÂU HỎI CHÈN GIỮA VIDEO.
 *
 * ⚠️ CÁCH LY CƠ SỞ ĐI QUA CHUỖI CHA, không tự có.
 *
 * `TrnLesson` và `TrnModule` KHÔNG nằm trong `SCOPED_MODELS`, và `scopedDb` **chỉ
 * che đường ĐỌC** — mọi `create`/`update`/`delete` phải tự guard. Một action chỉ
 * nhận `lessonId` rồi gọi thẳng `db.trnLessonCue.create` có **đúng bằng không**
 * cách ly: người soạn ở CS1 chèn được câu hỏi vào bài của khoá riêng CS2, và không
 * gì báo.
 *
 * Đường đúng là bài → chương → KHOÁ, rồi đọc khoá qua `scopedDb` — `TrnCourse` có
 * trong `SCOPED_MODELS` nên chính lượt đọc đó là cổng cách ly.
 */

const atSecSchema = z.number().int().positive();

export const themCueSchema = z
  .object({
    lessonId: z.string().min(1),
    /** Giây trong video mà câu hỏi bung ra. */
    atSec: atSecSchema,
    /** Câu hỏi nhập tại chỗ — khuôn dùng chung, thu hẹp còn ba loại chấm được. */
    cauHoi: cueInlineSchema,
    /** `true` = video dừng cho tới khi trả lời. */
    blocking: z.boolean().optional(),
  })
  .strict();

export type ThemCueInput = z.infer<typeof themCueSchema>;

/**
 * Nạp bài + đi ngược chuỗi cha để lấy khoá, và ĐỌC KHOÁ QUA `scopedDb`.
 *
 * Lượt đọc khoá chính là cổng cách ly — bỏ nó đi thì hai câu kiểm còn lại (bài có
 * tồn tại không, có phải VIDEO không) vẫn xanh cho một người ở cơ sở khác.
 */
async function layBaiVideo(db: ScopedDb, lessonId: string) {
  const bai = await db.trnLesson.findFirst({
    where: { id: lessonId, deletedAt: null },
    select: {
      id: true,
      kind: true,
      durationSec: true,
      cueCount: true,
      module: { select: { courseId: true } },
      _count: { select: { progress: true } },
    },
  });
  if (!bai) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");

  const khoa = await db.trnCourse.findFirst({
    where: { id: bai.module.courseId, deletedAt: null },
    select: { id: true },
  });
  // Không tìm thấy khoá ở đây nghĩa là khoá thuộc cơ sở khác — `scopedDb` đã lọc.
  // Trả CÙNG một lỗi với "bài không tồn tại": phân biệt hai thứ là nói cho người
  // dò biết id nào có thật.
  if (!khoa) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");

  if (bai.kind !== "VIDEO") {
    throw new ActionError(
      "WRONG_KIND",
      `Câu hỏi chèn giữa video chỉ đặt được trên bài dạng video. Bài này là ${bai.kind}.`,
      "lessonId",
    );
  }
  // ⚠️ Không có thời lượng thì không có gì để neo `atSec` vào, và `atSec < null`
  // không chặn được gì — cue sẽ nằm ở một giây có thể không bao giờ tới.
  if (!bai.durationSec) {
    throw new ActionError(
      "THIEU_THOI_LUONG",
      "Bài chưa có tệp video — tải video lên trước rồi mới đặt câu hỏi",
      "lessonId",
    );
  }
  return bai;
}

export const cauHinhThemCue: ActionConfig<ThemCueInput, { cueId: string }> = {
  name: "themCue",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnLessonCue",
  auditAction: "CREATE",
  schema: themCueSchema,
  handler: async ({ db, input }) => {
    const bai = await layBaiVideo(db, input.lessonId);
    const chan = input.blocking ?? true;

    if (input.atSec >= bai.durationSec!) {
      throw new ActionError(
        "NGOAI_THOI_LUONG",
        `Video dài ${bai.durationSec} giây — câu hỏi phải đặt trước mốc đó`,
        "atSec",
      );
    }
    if (bai.cueCount >= CUE_TOI_DA) {
      // Không có trần thì 30 câu hỏi trên một video 10 phút là hợp lệ về mặt máy;
      // cộng với chặn tua tới, người học không còn đường đi tiếp bình thường.
      throw new ActionError(
        "QUA_NHIEU_CUE",
        `Mỗi bài tối đa ${CUE_TOI_DA} câu hỏi chèn giữa video`,
        "atSec",
      );
    }

    // ⚠️ Thêm câu hỏi CHẶN vào bài đã có người học dở là đổi điều kiện hoàn thành
    // DƯỚI CHÂN họ: bài đang 100% bỗng thành chưa xong, và họ phải quay lại xem
    // một đoạn đã xem. Đúng thứ cơ chế phiên bản sinh ra để chặn.
    if (chan && bai._count.progress > 0) {
      throw new ActionError(
        "BAI_DANG_CO_NGUOI_HOC",
        `Bài này đã có ${bai._count.progress} người học. Thêm câu hỏi chặn bây giờ sẽ đổi điều kiện hoàn thành của họ — tạo phiên bản khoá mới thay vì sửa tại chỗ.`,
        "blocking",
      );
    }

    let cueId: string;
    try {
      cueId = await db.$transaction(async (t) => {
        const cue = await t.trnLessonCue.create({
          data: {
            lessonId: bai.id,
            atSec: input.atSec,
            inlineJson: input.cauHoi,
            blocking: chan,
            // `orderIndex` cố ý KHÔNG dùng: thứ tự đã do `atSec` quyết định, và
            // `@@unique([lessonId, atSec])` đã cấm trùng giây. Gán ý nghĩa cho nó
            // là tạo hai nguồn thứ tự có thể lệch nhau.
            orderIndex: 0,
          },
        });
        // `cueCount` cập nhật TRONG CÙNG transaction. Ngoài transaction thì một
        // lỗi ở giữa để lại con số lệch, và không gì phát hiện.
        await t.trnLesson.update({
          where: { id: bai.id },
          data: { cueCount: { increment: 1 } },
        });
        return cue.id;
      });
    } catch (e) {
      // ⚠️ Đọc `e.code`, KHÔNG dò chuỗi. `String(e)` của Prisma cho ra
      // "PrismaClientKnownRequestError: Unique constraint failed on the fields:
      // (`atSec`)" — KHÔNG chứa "P2002". Dò chuỗi là một nhánh không bao giờ chạy,
      // và người soạn nhận màn hình 500 thay vì câu tiếng Việt.
      const ma =
        typeof e === "object" && e !== null && "code" in e
          ? (e as { code?: unknown }).code
          : undefined;
      if (ma === "P2002") {
        throw new ActionError(
          "TRUNG_GIAY",
          "Đã có câu hỏi ở giây này — chọn một mốc khác",
          "atSec",
        );
      }
      throw e;
    }

    return {
      entityId: cueId,
      data: { cueId },
      newValues: { atSec: input.atSec, blocking: chan, loai: input.cauHoi.type },
    };
  },
};

export const xoaCueSchema = z
  .object({ lessonId: z.string().min(1), cueId: z.string().min(1) })
  .strict();

export type XoaCueInput = z.infer<typeof xoaCueSchema>;

export const cauHinhXoaCue: ActionConfig<XoaCueInput, { daXoa: boolean }> = {
  name: "xoaCue",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnLessonCue",
  auditAction: "DELETE",
  schema: xoaCueSchema,
  handler: async ({ db, input }) => {
    const bai = await layBaiVideo(db, input.lessonId);

    // ⚠️ Kiểm cue THUỘC ĐÚNG bài vừa qua cổng cách ly. Xoá thẳng theo `cueId` là
    // xoá được cue của bài bất kỳ, kể cả bài của cơ sở khác — cổng ở trên thành
    // trang trí.
    const cue = await db.trnLessonCue.findFirst({
      where: { id: input.cueId, lessonId: bai.id },
      select: { id: true, atSec: true },
    });
    if (!cue) throw new ActionError("NOT_FOUND", "Không tìm thấy câu hỏi này");

    await db.$transaction(async (t) => {
      await t.trnLessonCue.delete({ where: { id: cue.id } });
      await t.trnLesson.update({
        where: { id: bai.id },
        // `decrement` có sàn 0: `cueCount` âm là con số vô nghĩa hiện lên màn soạn.
        data: { cueCount: { decrement: 1 } },
      });
    });

    return {
      entityId: cue.id,
      data: { daXoa: true },
      oldValues: { atSec: cue.atSec },
    };
  },
};
