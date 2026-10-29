"use server";

import { defineAction } from "@/lib/actions/define";
import { cauHinhNopBaiTap } from "@/lib/elearning/task-submit";
import {
  cauHinhBatDauThi,
  cauHinhLuuCauTraLoi,
  cauHinhNopBai,
} from "@/lib/elearning/exam-taking";

/**
 * EL-14d — làm bài thi.
 *
 * ⚠️ Tệp CỐ Ý mỏng (quy ước 10): cấu hình nằm ở `lib/elearning/exam-taking.ts`.
 * Tệp `"use server"` không nạp được trong vitest, nên để logic ở đây là buộc test
 * chép lại cấu hình — và bản được kiểm sẽ không phải bản đang chạy.
 */
export const batDauThiAction = defineAction(cauHinhBatDauThi);
export const luuCauTraLoiAction = defineAction(cauHinhLuuCauTraLoi);
export const nopBaiAction = defineAction(cauHinhNopBai);

/**
 * EL-15c — nộp bài tập.
 *
 * ⚠️ Nối vào ĐÂY cùng PR mở loại bài `TASK`. Mở lựa chọn mà chưa có đường nộp là
 * đúng cái bẫy `lesson-kind.ts` sinh ra để gỡ.
 */
export const nopBaiTapAction = defineAction(cauHinhNopBaiTap);
