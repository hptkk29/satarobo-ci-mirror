"use server";

import { defineAction } from "@/lib/actions/define";
import { cauHinhTaoPhieuNhuCau } from "@/lib/elearning/training-need";

/**
 * Gửi đề nghị đào tạo từ khu người học. Cùng cấu hình với màn Chương trình (`quyền elearning:portal:access`, schema + audit
 * y hệt) — KHÔNG có đường rút/từ chối ở đây vì mô hình hiện chỉ có NEW/APPROVED (Q14 chưa chốt).
 */
export const guiDeNghiAction = defineAction(cauHinhTaoPhieuNhuCau);
