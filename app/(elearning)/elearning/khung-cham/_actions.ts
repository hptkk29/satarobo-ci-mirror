"use server";

import { defineAction } from "@/lib/actions/define";
import {
  cauHinhTaoKhung,
  cauHinhSuaKhung,
  cauHinhThemTieuChi,
  cauHinhSuaTieuChi,
  cauHinhXoaTieuChi,
  cauHinhSapXepTieuChi,
  cauHinhKichHoatKhung,
} from "@/lib/elearning/rubric-authoring";

/**
 * EL-15b — dựng khung chấm.
 *
 * ⚠️ Tệp CỐ Ý mỏng (quy ước 10): cấu hình nằm ở `lib/elearning/rubric-authoring.ts`,
 * vì tệp `"use server"` không nạp được trong vitest — để logic ở đây là buộc test
 * chép lại cấu hình, và bản được kiểm sẽ không phải bản đang chạy.
 */
export const taoKhungAction = defineAction(cauHinhTaoKhung);
export const suaKhungAction = defineAction(cauHinhSuaKhung);
export const themTieuChiAction = defineAction(cauHinhThemTieuChi);
export const suaTieuChiAction = defineAction(cauHinhSuaTieuChi);
export const xoaTieuChiAction = defineAction(cauHinhXoaTieuChi);
export const sapXepTieuChiAction = defineAction(cauHinhSapXepTieuChi);
export const kichHoatKhungAction = defineAction(cauHinhKichHoatKhung);
