import "server-only";
import { cache } from "react";
import { getSetting } from "@/lib/settings/service";

/**
 * Website đang ẩn học phí khoá offline không (`public.anHocPhi`, Cấu hình vận hành → Công ty & website).
 *
 * MỘT chỗ đọc cờ: các loader giá (`khoa-hoc-loader.ts`, `home-loader.ts`) hỏi hàm này rồi trả
 * "không có giá", nên mọi khối hiển thị, JSON-LD `offers` và mô tả meta cùng rơi vào nhánh
 * "liên hệ trung tâm" mà không cần `if` ở từng component.
 *
 * Lỗi đọc cấu hình ⇒ coi là ĐANG ẨN: BLĐ đã chốt ẩn, nên lỡ tay in giá mới là hướng sai.
 */
export const dangAnHocPhi = cache(async (): Promise<boolean> => {
  try {
    return await getSetting("public.anHocPhi");
  } catch {
    return true;
  }
});
