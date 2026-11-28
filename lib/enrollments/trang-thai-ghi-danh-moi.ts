// lib/enrollments/trang-thai-ghi-danh-moi.ts — ghi danh MỚI vào một lớp mang trạng thái gì.
//
// [11/10/2026 — chủ dự án chốt] Lớp ĐANG CHẠY (`Class.status = ACTIVE`, đã khai giảng) ⇒ ghi danh vào
// thẳng "Đang học" (STUDYING). Lớp chưa khai giảng (PLANNED / RECRUITING / PENDING_APPROVAL) ⇒ giữ
// trạng thái riêng của từng đường như cũ (`khiLopChuaChay`):
//   · /enrollments/new (`enrollStudent`)          ⇒ PENDING   "Chờ xếp lớp"
//   · ghi danh theo nhóm lớp (`enrollGroupIntoClass`) ⇒ CONFIRMED "Đã xếp lớp"
//   · chuyển lớp / đổi khoá (`chuyenLopTrongTx`)   ⇒ CONFIRMED "Đã xếp lớp"
//
// Vì sao: state machine (lib/enrollments/status.ts) chỉ cho PENDING → CONFIRMED → STUDYING, và cả
// "Chờ xếp" lẫn "Đã xếp" đều in nhãn "Chờ xếp lớp" ở /admin/students. Ca prod CS2-26-57AWRE: thêm em
// vào lớp đang học ⇒ giáo viên không thấy, nhãn "Chờ xếp lớp", giáo vụ "gỡ ra add lại" ba lần.
//
// `khiLopChuaChay` KHÔNG có mặc định (luật 7): mỗi đường phải nói rõ, tsc liệt kê chỗ gọi.
// Lớp COMPLETED/CANCELLED bị cả ba đường chặn trước khi tới đây; nếu lọt thì cũng KHÔNG bao giờ ra
// "Đang học". Thuần, không import `@/lib/db`. Ca [TGM-*].
import type { ClassStatus } from "@prisma/client";

export type KhiLopChuaChay = "PENDING" | "CONFIRMED";
export type TrangThaiGhiDanhMoi = "STUDYING" | KhiLopChuaChay;

export function trangThaiGhiDanhMoi(trangThaiLop: ClassStatus, khiLopChuaChay: KhiLopChuaChay): TrangThaiGhiDanhMoi {
  return trangThaiLop === "ACTIVE" ? "STUDYING" : khiLopChuaChay;
}

/** Mốc thời gian đi kèm — y như đường đổi trạng thái `changeEnrollmentStatus` đặt khi qua CONFIRMED rồi STUDYING. */
export function mocThoiGianGhiDanhMoi(trangThai: TrangThaiGhiDanhMoi, luc: Date): { confirmedAt?: Date; startedAt?: Date } {
  if (trangThai === "STUDYING") return { confirmedAt: luc, startedAt: luc };
  if (trangThai === "CONFIRMED") return { confirmedAt: luc };
  return {};
}
