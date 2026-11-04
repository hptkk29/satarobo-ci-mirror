// app/(admin)/admin/lop-trial/_lib/che-do-gv.ts — 17/09/2026.
//
// Quy BA KHOÁ QUYỀN ra BA TẦNG chọn giáo viên cho buổi trải nghiệm (chốt V1-d).
//
// File này THUẦN và cố ý chỉ nhận hai `boolean`: nó KHÔNG gọi `checkPermission`, KHÔNG
// đọc vai, KHÔNG đọc `centerId`. Người gọi hỏi quyền ở tầng trên rồi truyền kết quả
// xuống. Hai lý do:
//
//  1. Luật cứng #1 — mọi kiểm quyền đi qua `can()`/`checkPermission`. Nếu hàm này tự
//     hỏi vai thì nó thành cổng quyền thứ hai, và cổng thứ hai là cổng sẽ lệch.
//  2. Phép QUY RA TẦNG là thứ duy nhất đáng test riêng ở đây (thứ tự ưu tiên), mà nó
//     thì test được bằng vitest không cần Postgres, không cần Auth.js.
//
// ⚠️ THỨ TỰ LÀ MỘT PHẦN CỦA HỢP ĐỒNG, không phải chi tiết cài đặt:
//   Đào tạo (`trials:assign-teacher`)         → TAT_CA      — thấy mọi giáo viên
//   Quản lý cơ sở (`trials:assign-teacher-center`) → THEO_CO_SO  — giáo viên cơ sở mình
//   còn lại (Sale — vẫn có `trials:manage`)   → LOC_THEO_CA — lọc theo ca làm
//
// ALLOW-wins: ai giữ CẢ HAI khoá (vd SUPER_ADMIN) phải ra TAT_CA, tức tầng RỘNG nhất.
// Viết ngược lại (hỏi `theoCoSo` trước) thì SUPER_ADMIN rơi xuống tầng hẹp hơn và mất
// người trong ô chọn — một lời nói dối im lặng: không lỗi, không cảnh báo, chỉ thiếu tên.
//
// Hai khoá CỐ Ý không giao nhau trong seed vai (TRAINING chỉ có khoá đầu, CENTER_MANAGER
// chỉ có khoá sau — xem `lib/auth/permissions.test.ts`), nên trên dữ liệu thật hôm nay
// nhánh "có cả hai" chỉ xảy ra với SUPER_ADMIN. Vẫn phải viết đúng: seed đổi được, và
// một `UserPermissionGrant` ALLOW cũng đủ để ai đó cầm cả hai.

/** Ba tầng người dùng. Trùng CHÍNH XÁC kiểu cùng tên ở `@/lib/trial/gv-kha-dung`. */
export type CheDoChonGv = "TAT_CA" | "THEO_CO_SO" | "LOC_THEO_CA";

/**
 * Hai câu trả lời quyền → một tầng.
 *
 * @param toanHe   kết quả `checkPermission("trials:assign-teacher")` — tầng Đào tạo.
 * @param theoCoSo kết quả `checkPermission("trials:assign-teacher-center", { centerId })`
 *   — tầng Quản lý cơ sở.
 *
 * ⚠️ Không có mặc định cho tham số nào (luật 7): đây là hàm MỞ RỘNG PHẠM VI NHÌN, và
 * mặc định của phạm vi không bao giờ được là tầng rộng. Bỏ trống thì `tsc` phải kêu,
 * chứ không được tự hiểu thành "thấy tất".
 */
export function quyRaCheDo(input: { toanHe: boolean; theoCoSo: boolean }): CheDoChonGv {
  if (input.toanHe) return "TAT_CA";
  if (input.theoCoSo) return "THEO_CO_SO";
  return "LOC_THEO_CA";
}
