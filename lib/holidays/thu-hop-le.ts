// Thuần — không import DB/server-only. Tách khỏi `apply.ts` (27/09/2026) để `lib/classes/lui-lich.ts`
// dùng được mà không nhập vòng. `apply.ts` re-export để chỗ gọi cũ + test cũ không đổi.

/**
 * THỨ NÀO LỚP CÓ HỌC — dùng để tìm ngày dời khi buổi rơi vào ngày nghỉ.
 *
 * Tách thuần để test được: đây là chỗ lỗi prod 04/09/2026 nằm, và nó chỉ phụ
 * thuộc ba mẩu dữ liệu, không cần DB.
 *
 * Thứ tự ưu tiên:
 *   1. `scheduleDays` — bản sao phẳng trên `Class`, khi có thì tin.
 *   2. **Thứ của chính các buổi lớp đang có** — lớp học T3/T5 thì buổi của nó
 *      rơi vào T3/T5. Đây là vế MỚI, và là vế cứu cả tính năng: đo trên dữ liệu
 *      thật, 100/100 lớp không có `scheduleDays` lẫn `schedulePhases`, nên bản cũ
 *      `continue` im lặng ở mọi lớp và không buổi nào từng được dời.
 *   3. Cùng thứ với buổi đang dời — lớp mới tinh chỉ có đúng một buổi thì "tuần
 *      sau, cùng thứ" là phỏng đoán ít sai nhất, và vẫn hơn hẳn việc bỏ mặc buổi
 *      nằm trên ngày nghỉ.
 *
 * (Kế hoạch nhiều giai đoạn `schedulePhases` được xử RIÊNG ở nhánh `usePhases`
 * vì nó quyết định cả GIỜ, không chỉ thứ.)
 */
export function suyThuHopLe(
  scheduleDays: number[] | null | undefined,
  thuCuaCacBuoi: readonly number[],
  thuCuaBuoiDangDoi: number,
): number[] {
  if (scheduleDays && scheduleDays.length > 0) return scheduleDays;
  const tuBuoi = [...new Set(thuCuaCacBuoi)];
  if (tuBuoi.length > 0) return tuBuoi;
  return [thuCuaBuoiDangDoi];
}
