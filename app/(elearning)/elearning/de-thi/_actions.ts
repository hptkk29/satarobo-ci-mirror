"use server";

import { defineAction } from "@/lib/actions/define";
import {
  cauHinhTaoDe,
  cauHinhThemCauVaoDe,
  cauHinhGoCauKhoiDe,
  cauHinhSapXepDe,
  cauHinhKichHoatDe,
  cauHinhSuaDe,
} from "@/lib/elearning/exam-authoring";
import { cauHinhMoKhoaThi } from "@/lib/elearning/exam-unlock";

/**
 * EL-14c — dựng đề thi.
 *
 * ⚠️ Tệp CỐ Ý mỏng (quy ước 10): cấu hình nằm ở `lib/elearning/exam-authoring.ts`,
 * vì tệp `"use server"` không nạp được trong vitest — để logic ở đây là buộc test
 * chép lại cấu hình, và bản được kiểm sẽ không phải bản đang chạy.
 */
export const taoDeAction = defineAction(cauHinhTaoDe);
export const themCauVaoDeAction = defineAction(cauHinhThemCauVaoDe);
export const goCauKhoiDeAction = defineAction(cauHinhGoCauKhoiDe);
export const sapXepDeAction = defineAction(cauHinhSapXepDe);
export const kichHoatDeAction = defineAction(cauHinhKichHoatDe);

/**
 * Sửa thông số đề còn NHÁP.
 *
 * ⚠️ Nối vào ĐÂY cùng PR mở nó. Màn dựng đề vốn bảo người soạn "sửa điểm đạt" mà
 * không có nút nào để bấm — bày ra một lựa chọn không có lối đi.
 */
export const suaDeAction = defineAction(cauHinhSuaDe);

/**
 * EL-14d — mở thêm một lượt thi.
 *
 * ⚠️ Nối vào ĐÂY, không để `exam-unlock.ts` nằm không đường gọi. Trình phát nói với
 * người học "liên hệ Đào tạo nếu cần mở thêm lượt" — mà Đào tạo không có nút nào
 * để bấm thì câu đó là lời hứa suông, và người học chờ mãi.
 */
export const moKhoaThiAction = defineAction(cauHinhMoKhoaThi);
