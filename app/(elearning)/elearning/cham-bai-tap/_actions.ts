"use server";

import { defineAction } from "@/lib/actions/define";
import { cauHinhChamBaiTap } from "@/lib/elearning/task-grading";

/**
 * EL-15c — chấm bài tập theo khung.
 *
 * ⚠️ Tệp CỐ Ý mỏng (quy ước 10): cấu hình nằm ở `lib/elearning/task-grading.ts`,
 * vì tệp `"use server"` không nạp được trong vitest.
 */
export const chamBaiTapAction = defineAction(cauHinhChamBaiTap);
