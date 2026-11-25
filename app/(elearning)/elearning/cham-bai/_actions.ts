"use server";

import { defineAction } from "@/lib/actions/define";
import { cauHinhChamLuotThi } from "@/lib/elearning/exam-manual-grading";

/**
 * EL-14e — chấm tay.
 *
 * ⚠️ Tệp CỐ Ý mỏng (quy ước 10): cấu hình nằm ở `lib/elearning/exam-manual-grading.ts`,
 * vì tệp `"use server"` không nạp được trong vitest — để logic ở đây là buộc test
 * chép lại cấu hình, và bản được kiểm sẽ không phải bản đang chạy.
 */
export const chamLuotThiAction = defineAction(cauHinhChamLuotThi);
