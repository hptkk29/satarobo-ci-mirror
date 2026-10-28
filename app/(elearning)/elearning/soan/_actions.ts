"use server";

import { z } from "zod";
import { defineAction } from "@/lib/actions/define";
import { cauHinhDiemDanhBuoi } from "@/lib/elearning/equivalence";
import { cauHinhGanKhungVaoBai } from "@/lib/elearning/rubric-authoring";
import {
  cauHinhThemCue,
  cauHinhXoaCue,
} from "@/lib/elearning/lesson-cue-authoring";
import { cauHinhGanDeVaoBai } from "@/lib/elearning/exam-authoring";
import { ActionError } from "@/lib/actions/factory";
import { computeMinReadSeconds } from "@/lib/elearning/reading";
import { cauHinhLuuBaiVideo } from "@/lib/elearning/video-lesson";

/**
 * EL-04 — SOẠN BÀI ĐỌC.
 *
 * Trình soạn bài là tính năng HẠNG NHẤT, không phải màn phụ: phòng Đào tạo phải
 * soạn được một bài hoàn chỉnh mà không hỏi lập trình viên. Dự án không còn chốt
 * danh mục khoá, nên nếu soạn bài khó thì danh mục sẽ trống vào ngày mở — và đó
 * đúng là rủi ro số 1 của module.
 */

const luuBaiSchema = z.object({
  lessonId: z.string().min(1),
  title: z.string().trim().min(1, "Tên bài không được trống"),
  contentMd: z.string().min(1, "Nội dung không được trống"),
});

export const luuBaiDocAction = defineAction({
  name: "luuBaiDoc",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnLesson",
  auditAction: "UPDATE",
  schema: luuBaiSchema,
  handler: async ({ db, input }) => {
    const cu = await db.trnLesson.findFirst({
      where: { id: input.lessonId, deletedAt: null },
      select: { id: true, kind: true, title: true, contentMd: true, minReadSeconds: true },
    });
    if (!cu) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");
    if (cu.kind !== "READ") {
      throw new ActionError(
        "WRONG_KIND",
        "Trình soạn này chỉ dùng cho bài dạng đọc",
      );
    }

    // ⚠️ `minReadSeconds` tính LÚC LƯU và lưu CỨNG. Trang đọc chỉ đọc lại, không
    // tính lại theo từng lượt xem — tính lại nghĩa là sửa một chữ trong bài cũng
    // đổi ngưỡng của người đang đọc dở, và họ đang ở giữa chừng thì đột nhiên
    // "chưa đủ".
    const minReadSeconds = computeMinReadSeconds(input.contentMd);

    await db.trnLesson.update({
      where: { id: cu.id },
      data: {
        title: input.title,
        contentMd: input.contentMd,
        minReadSeconds,
      },
    });

    return {
      entityId: cu.id,
      oldValues: {
        title: cu.title,
        minReadSeconds: cu.minReadSeconds,
        soKyTu: cu.contentMd?.length ?? 0,
      },
      newValues: {
        title: input.title,
        minReadSeconds,
        soKyTu: input.contentMd.length,
      },
      data: { minReadSeconds },
    };
  },
});

/**
 * EL-10 — lưu siêu dữ liệu bài VIDEO.
 *
 * Cấu hình ở lib (quy ước 10) nên test chạy đúng cái máy chủ chạy.
 */
export const luuBaiVideoAction = defineAction(cauHinhLuuBaiVideo);

/**
 * EL-12c — câu hỏi chèn giữa video.
 *
 * Cấu hình nằm ở `lib/elearning/lesson-cue-authoring.ts` (quy ước 10): tệp
 * `"use server"` không nạp được trong vitest, nên để logic ở đây là buộc test phải
 * chép lại cấu hình — và hai bản chép tay sớm muộn trôi khỏi nhau, với bản được
 * kiểm không phải bản đang chạy.
 */
export const themCueAction = defineAction(cauHinhThemCue);
export const xoaCueAction = defineAction(cauHinhXoaCue);

/**
 * EL-14d — gắn đề vào bài kiểm tra.
 *
 * Không có đường này thì mở loại bài `QUIZ` là dựng lại bẫy cũ ở hình dạng mới:
 * người soạn tạo được bài, cổng xuất bản đòi `examId`, và không màn nào đặt được nó.
 */
export const ganDeVaoBaiAction = defineAction(cauHinhGanDeVaoBai);

/**
 * EL-15c — gắn khung chấm vào bài tập.
 *
 * ⚠️ Nối vào ĐÂY cùng PR mở loại bài `TASK`: mở loại bài mà người soạn không có
 * chỗ gắn khung chỉ đổi người bị kẹt, từ người học sang người soạn.
 */
export const ganKhungVaoBaiAction = defineAction(cauHinhGanKhungVaoBai);

/**
 * EL-09 — tick "đã dự" cho bài `LIVE_SESSION`.
 *
 * ⚠️ Nối vào ĐÂY vì trước đó `cauHinhDiemDanhBuoi` là action MỒ CÔI: khai từ EL-09
 * nhưng 0 màn nào gọi, nên bài buổi trực tiếp không bao giờ lên xong và mọi khoá
 * kết hợp đứng mãi dở dang.
 */
export const diemDanhBuoiAction = defineAction(cauHinhDiemDanhBuoi);
