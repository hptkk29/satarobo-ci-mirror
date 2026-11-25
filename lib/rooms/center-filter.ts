// lib/rooms/center-filter.ts — quy tắc "phòng có thuộc cơ sở của buổi hẹn không".
//
// THUẦN (không đụng DB) để dùng chung ba nơi, y hệt `lib/teachers/center-filter.ts`:
//  - dropdown phòng ở màn buổi hẹn (client) lọc theo cơ sở của từng buổi,
//  - rào server-side ở `updateBookingLopTrialAction` (client lọc chỉ là tiện nghi —
//    `roomId` đi thẳng từ client nên POST tay gán được phòng cơ sở khác),
//  - unit test (chạy ở lane mặc định, không cần Postgres).
//
// ⚠️ ĐỪNG bắt chước `teacherCenterAssignmentError`, nơi ràng buộc cơ sở đã được chủ
// dự án GỠ 06/08. Giáo viên là nguồn lực chung, điều đi theo lịch; PHÒNG thì không —
// phòng nằm ở một địa chỉ vật lý, gán phòng CS1 cho buổi CS2 là mọc một buổi lạ trên
// lịch phòng của cơ sở kia mà không ai ở đó gây ra.

export type RoomCenterLite = { centerId: string | null };

/**
 * Phòng có gán được cho buổi hẹn ở `bookingCenterId` không.
 *
 * Ba trường hợp CHO QUA, khớp nguyên quy tắc lọc ở client (`roomOptions` trong
 * `booking-list.tsx`) — lệch nhau là đẩy người dùng vào cảnh chọn hợp lệ ở màn hình
 * rồi bị server từ chối:
 *  - phòng dùng chung (`centerId` null);
 *  - buổi chưa gán cơ sở (`bookingCenterId` null) → không có gì để so;
 *  - phòng ĐANG được gán sẵn cho chính buổi đó — lượt lưu không được đá văng dữ
 *    liệu cũ chỉ vì phòng đã đổi cơ sở sau ngày gán.
 *
 * Trả message lỗi (VI), hoặc null nếu hợp lệ. `room` là `undefined`/`null` khi tra
 * không ra → cũng là lỗi (bắt luôn `roomId` bịa/typo).
 */
export function roomCenterAssignmentError(
  bookingCenterId: string | null,
  room: RoomCenterLite | null | undefined,
): string | null {
  if (!room) return "Phòng không tồn tại";
  if (room.centerId === null) return null;
  if (bookingCenterId === null) return null;
  if (room.centerId === bookingCenterId) return null;
  return "Phòng thuộc cơ sở khác với buổi hẹn";
}
