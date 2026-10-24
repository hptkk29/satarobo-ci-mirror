// lib/portal/trang-thai-ghi-danh.ts — MỘT định nghĩa duy nhất cho câu
// "ghi danh nào được coi là con đang theo học".
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao có file này (06/09/2026)
//
// Riêng trong `lib/portal/` đã có BẢY bản chép tay của cùng một danh sách, và chúng
// KHÔNG khớp nhau:
//
//   learning.ts · notifications.ts · photos.ts · dashboard.ts (×2) · report-card-v2.ts
//       → ["CONFIRMED", "STUDYING", "ACTIVE"]
//   child-switcher-data.ts · parent-profile.ts · student-assignments.ts
//       → ["CONFIRMED", "STUDYING", "ACTIVE", "PAUSED"]
//
// Hệ quả đo được trên DB làm việc 06/09: **7 học viên chỉ có ghi danh `PAUSED`**. Bộ
// chuyển-con và trang hồ sơ thấy các em; còn lịch học, buổi học, ảnh lớp, thông báo lớp
// thì KHÔNG. Phụ huynh đăng nhập, chọn đúng tên con, rồi nhìn một cổng trống trơn —
// không có dòng nào nói vì sao.
//
// `PAUSED` là TẠM NGHỈ, không phải nghỉ hẳn: em vẫn thuộc lớp, vẫn có lịch, vẫn có ảnh
// và nhận xét của những buổi đã học. Nên bản hợp nhất lấy tập RỘNG HƠN — thêm quyền
// nhìn cho 7 em đó, không lấy bớt của ai.
//
// ⚠️ `WITHDREW` / `CANCELLED` KHÔNG nằm trong đây (đã nghỉ hẳn), và `PENDING` cũng không
// (chưa chốt ghi danh). `COMPLETED` tách riêng bên dưới.
//
// ⚠️ ĐỪNG chép tay danh sách này ở nơi khác. Có bộ test canh: `trang-thai-ghi-danh.test.ts`
// quét `lib/portal/**` và bắt mọi mảng status viết tay mới.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ghi danh còn đang phục vụ — dùng cho mọi đường đọc "con đang học gì" của cổng
 * phụ huynh/học viên: lịch, buổi học, bài tập, ảnh, thông báo lớp, tiến độ.
 */
export const GHI_DANH_DANG_HOC = [
  "CONFIRMED",
  "STUDYING",
  "ACTIVE",
  "PAUSED",
] as const;

/**
 * Thêm lớp ĐÃ HOÀN THÀNH — cho các màn LỊCH SỬ, nơi con số không bị gộp chung với
 * khoá đang học (ảnh lớp, nhận xét cũ).
 *
 * ⚠️ ĐỪNG dùng danh sách này cho các chỉ số tiến độ/chuyên cần: cộng dồn khoá đã xong
 * với khoá đang học ra một phân số vô nghĩa ("23/24"). Chỉ số đi theo
 * `GHI_DANH_DANG_HOC`.
 */
export const GHI_DANH_CO_LICH_SU = [
  ...GHI_DANH_DANG_HOC,
  "COMPLETED",
] as const;

export type TrangThaiDangHoc = (typeof GHI_DANH_DANG_HOC)[number];
