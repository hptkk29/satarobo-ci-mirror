"use server";

import { defineAction } from "@/lib/actions/define";
import {
  cauHinhTaoCauHoi,
  cauHinhSuaCauHoi,
  cauHinhXoaCauHoi,
} from "@/lib/elearning/question-bank";

/**
 * EL-14b — kho câu hỏi.
 *
 * ⚠️ Tệp CỐ Ý mỏng: cấu hình action nằm ở `lib/elearning/question-bank.ts` (quy ước
 * 10). Tệp `"use server"` không nạp được trong vitest, nên để logic ở đây là buộc
 * test phải chép lại cấu hình — và bản được kiểm sẽ không phải bản đang chạy.
 */
export const taoCauHoiAction = defineAction(cauHinhTaoCauHoi);
export const suaCauHoiAction = defineAction(cauHinhSuaCauHoi);
export const xoaCauHoiAction = defineAction(cauHinhXoaCauHoi);
