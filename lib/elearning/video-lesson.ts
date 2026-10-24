import { z } from "zod";
import type { ActionConfig } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { VIDEO_MAX_SEC, VIDEO_MIN_SEC } from "@/lib/elearning/media-rules";
import { kiemCodec, THONG_BAO_CODEC } from "@/lib/elearning/mp4-probe";

/**
 * EL-10 — LƯU SIÊU DỮ LIỆU BÀI VIDEO.
 *
 * Mảnh cuối làm cả chuỗi EL-10 dùng được: không có đường này thì bucket, presign,
 * bộ đọc mp4 và route phát đều đã sẵn mà KHÔNG bài học nào mang được một
 * `videoKey`.
 *
 * ⚠️ `trnLessonCreateSchema` (`lib/validators/elearning.ts:328`) đã có đủ 7 cột
 * video và đúng luật từ lâu, nhưng trước PR này nó CHỈ được gọi trong test — tức
 * luật viết ra mà không đường nào thi hành. Action này là call-site thật đầu tiên
 * của các luật đó.
 *
 * ⚠️ Thời lượng lưu vào DB là con số ĐỌC TỪ TỆP (`mp4-probe`), không phải con số
 * trình duyệt khai. Con số client chỉ dùng chặn sớm ở bước mở lượt tải.
 */

export const luuBaiVideoSchema = z
  .object({
    lessonId: z.string().min(1),
    title: z.string().trim().min(1, "Tên bài không được trống"),
    videoKey: z.string().min(1, "Bài video phải có tệp video"),
    /** Thời lượng ĐỌC TỪ TỆP, tính bằng giây. */
    durationSec: z.number().int().min(VIDEO_MIN_SEC).max(VIDEO_MAX_SEC),
    captionKey: z.union([z.null(), z.string().min(1)]).optional(),
    audioKey: z.union([z.null(), z.string().min(1)]).optional(),
    transcriptMd: z.union([z.null(), z.string()]).optional(),
    /** Kết quả đọc header mp4 — dùng để chốt codec, không lưu thô. */
    codec: z
      .object({
        videoCodec: z.union([z.null(), z.enum(["avc1", "hev1", "khac"])]),
        audioCodec: z.union([z.null(), z.enum(["mp4a", "khac"])]),
        brand: z.string(),
      })
      .optional(),
  })
  .strict();

export type LuuBaiVideoInput = z.infer<typeof luuBaiVideoSchema>;

export const cauHinhLuuBaiVideo: ActionConfig<LuuBaiVideoInput, { durationSec: number }> = {
  name: "luuBaiVideo",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnLesson",
  auditAction: "UPDATE",
  schema: luuBaiVideoSchema,
  handler: async ({ db, input }) => {
    const cu = await db.trnLesson.findFirst({
      where: { id: input.lessonId, deletedAt: null },
      select: {
        id: true,
        kind: true,
        title: true,
        videoKey: true,
        durationSec: true,
        captionKey: true,
        module: { select: { courseId: true } },
      },
    });
    if (!cu) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");
    if (cu.kind !== "VIDEO") {
      throw new ActionError(
        "WRONG_KIND",
        `Bài này là dạng ${cu.kind}, không phải bài video`,
        "lessonId",
      );
    }

    // ⚠️ Chốt codec ở ĐÂY, không chỉ ở bước tải lên. Bước tải lên có thể bị gọi
    // lại, bị bỏ giữa chừng, hay bị thay tệp; đây là chỗ duy nhất mà tệp và bản
    // ghi bài học gắn với nhau.
    if (input.codec) {
      const k = kiemCodec({
        xong: true,
        brand: input.codec.brand,
        durationSec: input.durationSec,
        videoCodec: input.codec.videoCodec,
        audioCodec: input.codec.audioCodec,
        // `kiemCodec` chỉ đọc hai trường codec; độ phân giải đã được chặn ở
        // bước xác minh, không kiểm lại ở đây.
        rong: null,
        cao: null,
      });
      if (!k.ok) throw new ActionError(k.code, THONG_BAO_CODEC[k.code], "videoKey");
    }

    // Khoá phải thuộc đúng bài này. Không kiểm thì một bài có thể trỏ vào tệp của
    // bài khác, và xoá bài kia là làm bài này mất video mà không ai nối được
    // nguyên nhân.
    for (const [ten, khoa] of [
      ["videoKey", input.videoKey],
      ["captionKey", input.captionKey],
      ["audioKey", input.audioKey],
    ] as const) {
      if (!khoa) continue;
      if (!khoa.includes(`/${cu.id}/`)) {
        throw new ActionError(
          "KEY_NGOAI_BAI",
          "Tệp không thuộc bài học này — tải lại tệp cho đúng bài",
          ten,
        );
      }
    }

    await db.trnLesson.update({
      where: { id: cu.id },
      data: {
        title: input.title,
        videoKey: input.videoKey,
        durationSec: input.durationSec,
        captionKey: input.captionKey ?? null,
        audioKey: input.audioKey ?? null,
        // Bản chép lời sinh TỪ phụ đề, không nhập tay lần thứ hai: hai nguồn cho
        // cùng một nội dung thì sớm muộn chúng lệch nhau, và không ai biết bên
        // nào đúng.
        transcriptMd: input.transcriptMd ?? null,
      },
    });

    return {
      entityId: cu.id,
      data: { durationSec: input.durationSec },
      oldValues: {
        title: cu.title,
        coVideo: Boolean(cu.videoKey),
        durationSec: cu.durationSec,
        coPhuDe: Boolean(cu.captionKey),
      },
      newValues: {
        title: input.title,
        durationSec: input.durationSec,
        coPhuDe: Boolean(input.captionKey),
        videoCodec: input.codec?.videoCodec ?? null,
      },
    };
  },
};
