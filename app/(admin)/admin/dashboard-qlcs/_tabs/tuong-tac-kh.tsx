import { ChoDuLieu } from "../_components/cho-du-lieu";

/**
 * Tab Tương tác KH — khu vực E (E-01 buổi học & đánh giá còn thiếu · E-02 tỷ lệ PH đã
 * tương tác · E-03 bảng chi tiết · E-04 mở cửa sổ chat ngay tại màn hình).
 */
export function TabTuongTacKh() {
  return (
    <ChoDuLieu
      maSpec="E-01 → E-04"
      tieuDe="Tương tác KH: chưa nối số liệu vào màn"
      giaiThich={
        "Phần đếm buổi học còn thiếu điểm danh / đánh giá đã viết xong ở đợt trước và có " +
        "sẵn dạng gộp lẫn dạng tách theo cơ sở, nhưng chưa được gọi ở đây. Ba mục còn " +
        "lại (tỷ lệ phụ huynh đã tương tác, bảng chi tiết, cửa sổ chat tại chỗ) chưa có."
      }
      daCo={[
        "E-01 đếm buổi chưa điểm danh / chưa đánh giá theo khoảng ngày — lib/dashboard/tuong-tac/session-gaps.ts",
        "Suy giáo viên phụ trách một buổi (tôn trọng dạy thay) — lib/lms/session-teacher.ts",
      ]}
      chuaCo={[
        "Nối E-01 vào tab + đường bấm sang danh sách buổi tương ứng",
        "E-02 tỷ lệ phụ huynh đã tương tác trên tổng PH đang có con học",
        "E-03 bảng chi tiết phụ huynh đã tương tác (SĐT vẫn phải qua kiểm quyền xem liên lạc PH)",
        "E-04 mở cửa sổ chat ngay trên dashboard, dùng lại component chat sẵn có",
      ]}
    />
  );
}
