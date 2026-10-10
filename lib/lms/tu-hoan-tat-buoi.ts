// lib/lms/tu-hoan-tat-buoi.ts — điểm danh đủ sĩ số thì buổi TỰ hoàn tất.
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao (chủ dự án 04/09: "mở khoá hoàn thành buổi: chỉ cần điểm danh")
//
// "Hoàn tất buổi" là một nút RIÊNG mà giáo viên phải nhớ bấm sau khi đã điểm danh.
// Không ai bấm ⇒ `ClassSession.status` kẹt ở SCHEDULED, và mọi màn đếm theo status
// (`lib/lms/report-card-editor-data.ts`) đọc hụt so với màn đếm theo ngày. Đo 04/09
// trên DB test: 524 buổi đã qua ngày nhưng chỉ 486 buổi COMPLETED.
//
// Cổng của `completeSession` VỐN đã không chặn — thiếu điểm danh chỉ cảnh báo. Nên
// việc cần làm không phải nới cổng mà là BỎ HẲN thao tác thừa: điểm danh xong là xong.
//
import { attendanceCoversRoster } from "@/lib/lms/session-order";
import { vnDateOnly } from "@/lib/time/vn";

// THUẦN để test được; nơi gọi (`app/(teacher)/teacher/lop/_actions.ts`) lo phần DB.
// ─────────────────────────────────────────────────────────────────────────────

export type QuyetDinhHoanTat =
  | { tuHoanTat: true }
  | {
      tuHoanTat: false;
      lyDo:
        | "DA_XONG" // đã COMPLETED / CANCELLED — không đụng
        | "CHUA_TOI_NGAY" // buổi tương lai
        | "SI_SO_RONG" // lớp không có ai để điểm danh
        | "DIEM_DANH_THIEU"; // còn học viên chưa được đánh dấu
    };

export interface HoanTatInput {
  /** Trạng thái buổi hiện tại. */
  trangThaiBuoi: string;
  /**
   * Thời điểm buổi học — `ClassSession.date`, kiểu `@db.Timestamptz(6)`.
   *
   * ⚠️ NÓ MANG GIỜ THẬT, không phải nửa đêm. Chú thích cũ ở đây khai "`@db.Date` —
   * nửa đêm UTC" và ĐÓ LÀ GỐC CỦA BUG 07/09/2026 (xem `quyetDinhTuHoanTat`). Đo trên
   * dữ liệu thật: 609/609 buổi mang giờ 08:00–18:00, KHÔNG buổi nào nửa đêm.
   */
  ngayBuoi: Date;
  /** Mốc nửa đêm UTC của NGÀY hôm nay theo giờ VN. */
  homNayUtcMs: number;
  /**
   * `studentId` của những em ĐANG trong sĩ số lớp (`rosterWhere("dang-hoc")`).
   *
   * ⚠️ DANH SÁCH ID, không phải số đếm — xem `quyetDinhTuHoanTat` để biết vì sao.
   */
  siSoStudentIds: readonly string[];
  /**
   * `studentId` đã có bản ghi điểm danh cho buổi này.
   *
   * ⚠️ CÓ THỂ chứa em HỌC BÙ từ lớp khác — các em đó cũng sinh dòng `Attendance` cho
   * buổi này. Đó chính là lý do không được so bằng số lượng.
   */
  daDanhDauStudentIds: readonly string[];
}

/**
 * Buổi có được tự đóng sau lượt lưu điểm danh này không.
 *
 * Ba điều KHÔNG được bỏ:
 *
 * 1. **Phải PHỦ ĐỦ SĨ SỐ theo DANH SÁCH studentId**, không phải "có ≥1 dòng" và cũng
 *    không phải `đã đánh dấu >= sĩ số`. Cùng định nghĩa với `sessionsMissingAttendance`
 *    (BUG-029) — nơi một bản ghi lẻ do duyệt phiếu xin nghỉ của phụ huynh từng làm buổi
 *    biến mất khỏi mọi ô "chưa điểm danh".
 *
 *    ⚠️ 08/09/2026 — TRƯỚC ĐÂY SO BẰNG SỐ ĐẾM, và đó là lỗ hổng thật:
 *    học viên HỌC BÙ từ lớp khác cũng sinh dòng `Attendance` cho buổi này, nên tử số
 *    phồng lên và BÙ CHỖ cho một em trong sĩ số chưa hề được đánh dấu ⇒ buổi đóng khi
 *    điểm danh còn thiếu người. `attendanceCoversRoster` đã ghi cấm cách so đó từ đầu;
 *    ở đây chỉ là dùng lại nó thay vì chép một luật thứ hai.
 *    Lỗ này vốn NGỦ vì cổng ngày sai làm cả cơ chế không bao giờ nổ (vá 4df347b4) —
 *    vá cổng ngày mà không vá chỗ này là biến lỗ ngủ thành lỗ nổ mỗi ngày.
 * 2. **Không đóng buổi TƯƠNG LAI.** Giáo viên mở buổi tuần sau ra đánh sẵn cả lớp là
 *    chuyện có thật; đóng nó lại là phát `session.taught` cho buổi chưa dạy ⇒ giao bài
 *    và bắn thông báo cho phụ huynh sớm cả tuần.
 * 3. **Sĩ số rỗng không tính là "đủ".** 0 ≥ 0 đúng về số học nhưng sai về nghĩa: lớp
 *    chưa có học viên nào thì chẳng có buổi nào để mà dạy xong.
 */
export function quyetDinhTuHoanTat(input: HoanTatInput): QuyetDinhHoanTat {
  if (
    input.trangThaiBuoi !== "SCHEDULED" &&
    input.trangThaiBuoi !== "IN_PROGRESS"
  ) {
    return { tuHoanTat: false, lyDo: "DA_XONG" };
  }
  // So NGÀY với NGÀY. `homNayUtcMs` là NỬA ĐÊM, còn `ngayBuoi` mang giờ thật, nên so
  // thẳng hai mốc là buổi của CHÍNH HÔM NAY luôn "lớn hơn nửa đêm hôm nay" ⇒ rơi vào
  // CHUA_TOI_NGAY. Mà giáo viên điểm danh trong/ngay sau giờ dạy — tức LUÔN rơi vào
  // nhánh chết. Đó là lý do cơ chế tự đóng buổi live từ 04/09 mà prod 07/09 chỉ có
  // 2 buổi COMPLETED / 287 SCHEDULED.
  if (vnDateOnly(input.ngayBuoi).getTime() > input.homNayUtcMs) {
    return { tuHoanTat: false, lyDo: "CHUA_TOI_NGAY" };
  }
  // Tách SI_SO_RONG khỏi DIEM_DANH_THIEU trước khi hỏi `attendanceCoversRoster`: hàm
  // đó trả false cho CẢ HAI ca (sĩ số rỗng ⇒ false theo thiết kế), mà hai ca này cần
  // hai lý do khác nhau — "lớp chưa có ai" không phải "giáo viên còn nợ việc".
  if (input.siSoStudentIds.length === 0)
    return { tuHoanTat: false, lyDo: "SI_SO_RONG" };
  if (
    !attendanceCoversRoster(input.daDanhDauStudentIds, input.siSoStudentIds)
  ) {
    return { tuHoanTat: false, lyDo: "DIEM_DANH_THIEU" };
  }
  return { tuHoanTat: true };
}
