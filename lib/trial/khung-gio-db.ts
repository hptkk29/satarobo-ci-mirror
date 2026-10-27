// lib/trial/khung-gio-db.ts — đọc BẢY khoá `trial.khungGio.<thu>` từ cấu hình vận hành.
//
// ⚠️ Vì sao KHÔNG để hàm này trong `_actions.ts`: tệp đó mang `"use server"`, nên mọi hàm
// export ra từ đó là một ENDPOINT gọi được từ trình duyệt — và bộ test cổng quyền của màn
// Lớp Trial bắt đúng điều đó ("bảng khai phủ ĐÚNG danh sách action đang có"). Một lượt đọc
// cấu hình thì không cần endpoint riêng; để đây là nó chỉ chạy trong tiến trình server.
import { getSetting } from "@/lib/settings/service";
import { THU_KHOA, type CauHinhKhung } from "@/lib/trial/khung-gio-mo-lop";

/**
 * KHÔNG truyền `orgUnitId`: bảy khoá này khai `centerOverridable: false` có chủ đích
 * (lý do đầy đủ ở `lib/settings/registry.ts`) — khung mở lớp giống nhau toàn hệ, và form
 * tạo lớp dựng ô chọn từ chính bảy khoá này nên client/server không thể lệch nhau.
 */
export async function layCauHinhKhung(): Promise<CauHinhKhung> {
  const cap = await Promise.all(
    THU_KHOA.map(async (thu) => [thu, await getSetting(`trial.khungGio.${thu}`)] as const),
  );
  return Object.fromEntries(cap) as CauHinhKhung;
}
