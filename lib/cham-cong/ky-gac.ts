// lib/cham-cong/ky-gac.ts — HAI CỔNG quanh kỳ công. THUẦN, test không cần DB.
//
// Cả hai đều là "chặn cứng + đường vượt cấp Hội sở", và cố ý nằm cùng một file vì chúng
// bảo vệ hai đầu của CÙNG một bất biến: số liệu của một kỳ đã chốt phải đứng yên.
//
//   · `chanChotKyThieuBuoi` — chặn CHỐT một kỳ mà chưa buổi nào được đóng;
//   · `chanSuaKyDaChot`     — chặn GHI ĐÈ vào kỳ đã chốt (xếp lại khung ca).
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao cổng thứ nhất
//
// `AttendancePeriod` chốt xong là đóng băng `StaffAttendanceDay` và ghi `summaryJson`.
// Nếu chốt lúc `ClassSession.status` chưa phản ánh thực tế thì con số đóng băng là con
// số sai, và mở lại kỳ là thao tác cấp Hội sở.
//
// Prod 07/09/2026 đo được **2 buổi COMPLETED / 287 SCHEDULED** — chốt kỳ ở trạng thái
// đó là niêm phong một tháng công gần như trống.
//
// ⚠️ Ngưỡng là `duKien > 0 && xong === 0`, KHÔNG phải `xong === 0`. Hội sở (`hoi-so`)
// không có lớp nào trỏ tới nên `duKien = 0` — dùng `xong === 0` là KHOÁ VĨNH VIỄN Hội
// sở, không bao giờ chốt được kỳ.
//
// ⚠️ Đếm THẲNG `ClassSession`, KHÔNG dùng `summary.totals.teachingSessions`: số đó cộng
// theo HÀNG nên rụng buổi của giáo viên không có ca trong kỳ, và truy vấn sinh ra nó bị
// bỏ hẳn khi danh sách người rỗng.
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao cổng thứ hai
//
// `generateMonthAssignments` xếp lại `ShiftAssignment` cho cả tháng và KHÔNG hề hỏi
// trạng thái kỳ (đo 08/09/2026). Kỳ đã chốt vẫn ghi đè được — cùng lớp lỗ với chuyện
// chốt kỳ. Prod hiện 1 kỳ OPEN / 0 LOCKED nên chưa ai khai thác được; lỗ này đang mở
// sẵn cho lần chốt kỳ ĐẦU TIÊN, nên phải bịt cùng lúc với cổng thứ nhất.

/** Câu chặn khi chốt kỳ mà chưa buổi nào được đóng. `null` = cho qua. */
export function chanChotKyThieuBuoi(input: {
  /** Buổi trong kỳ, trạng thái KHÁC CANCELLED. */
  duKien: number;
  /** Buổi trong kỳ đã COMPLETED. */
  xong: number;
}): string | null {
  if (input.duKien > 0 && input.xong === 0) {
    return (
      `Kỳ có ${input.duKien} buổi học nhưng CHƯA buổi nào được chốt — chốt kỳ bây giờ là ` +
      "niêm phong một tháng công gần như trống. Giáo viên chốt buổi xong rồi chốt kỳ; " +
      "nếu thực sự cần chốt ngay, cấp Hội sở dùng đường vượt kèm lý do."
    );
  }
  return null;
}

/** Câu chặn khi ghi đè vào kỳ đã chốt. `null` = cho qua. */
export function chanSuaKyDaChot(input: {
  /** `AttendancePeriod.status`, hoặc null khi kỳ chưa tồn tại. */
  status: string | null;
  periodKey: string;
}): string | null {
  if (input.status === "LOCKED") {
    return (
      `Kỳ ${input.periodKey} đã CHỐT SỔ — không xếp lại khung ca cho kỳ này. ` +
      "Ngày công đã đóng băng theo số cũ, ghi đè là làm lệch bảng công đã ký. " +
      "Cần sửa thật thì cấp Hội sở mở lại kỳ trước."
    );
  }
  return null;
}
