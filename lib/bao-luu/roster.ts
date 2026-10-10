import type { Prisma } from "@prisma/client";
import { luotConHieuLuc } from "@/lib/bao-luu/dang-bao-luu";

// lib/bao-luu/roster.ts — "học viên có ĐANG NGỒI TRONG LỚP không" khi có bảo lưu theo quy chế (SR.QD.236, BR-09/BR-13). PHIÊN 4.
//
// Nguồn chân lý cũ `ENROLLMENT_ACTIVE_STATUSES` (lib/enrollment-status.ts) cố ý gồm `PAUSED` — "bảo lưu nhưng vẫn thuộc lớp,
// giữ hiển thị" — và ~94 chỗ đọc đang dựa vào đó. Quy chế mới nói ngược: START rút học viên khỏi danh sách lớp, không vào điểm
// danh, không tính sĩ số. Hai điều đó chỉ dung hoà được nếu phân biệt HAI loại bảo lưu:
//
//   · hồ sơ ĐỜI MỚI (đã qua duyệt: `StudentReserve.approvedAt` ≠ NULL) → RỜI khỏi lớp trong KHOẢNG HIỆU LỰC của nó;
//   · mọi thứ còn lại (đường cũ chạy khi cờ TẮT, `PAUSED` dán tay, hồ sơ LEGACY chưa xử lý) → GIỮ NGUYÊN như hôm nay.
//
// Vì sao khoá theo DỮ LIỆU (`approvedAt`) mà không theo CỜ `pause.enabled`: cờ là tham số THEO CƠ SỞ và có thể tắt lại; hồ sơ đã
// duyệt vẫn là sự thật — tắt cờ không được kéo một em đang nghỉ trở lại điểm danh. Và hôm nay (cờ TẮT mọi nơi) không dòng nào có
// `approvedAt` ⇒ mọi truy vấn dưới đây cho kết quả Y HỆT trước khi sửa. Đó là bằng chứng "không đổi hành vi" của Phiên 4.
//
// Vì sao theo KHOẢNG HIỆU LỰC tại `ngay` mà không theo `Enrollment.status = PAUSED`: nguồn sự thật của "đang bảo lưu" là hồ sơ
// (chốt 07/10). Điều này cũng cho phép hỏi về QUÁ KHỨ — điểm danh một buổi cũ: buổi TRƯỚC khi bắt đầu bảo lưu vẫn hiện em ấy
// (không xoá lịch sử), buổi TRONG khoảng bảo lưu thì không, kể cả sau khi em đã phục học (BR-13, BR-09).
//
// `ngay` LÀ THAM SỐ BẮT BUỘC (luật 19, và luật "tham số mặc định nguy hiểm thì bỏ mặc định" — mặc định `new Date()` ở đây là
// một danh sách lớp lệch theo đồng hồ).
//
// ⚠️ ĐỪNG viết lại điều kiện này ở chỗ gọi. Hai bản chép là hai danh sách lớp lệch nhau (đúng bệnh 7 bộ status song song).

/**
 * Mảnh `where` của `StudentReserve`: hồ sơ ĐỜI MỚI có hiệu lực tại `ngay`. MỘT định nghĩa cho cả roster (`ghiDanhDangBaoLuuTai`),
 * `docKhoangBaoLuu` (lib/bao-luu/roster-db.ts) và các nơi lọc buổi vắng — đừng viết lại.
 */
export function hoSoBaoLuuHieuLucTai(ngay: Date): Prisma.StudentReserveWhereInput {
  return {
    approvedAt: { not: null },
    startedAt: { lte: ngay },
    // Cùng nghĩa `luotConHieuLuc`: chưa đóng ⇒ theo `isActive`; đã đóng ⇒ còn hiệu lực tới TRƯỚC `endedAt`.
    OR: [{ isActive: true, endedAt: null }, { endedAt: { gt: ngay } }],
  };
}

/** Mảnh `where` của `Enrollment`: ghi danh nằm trong khoảng bảo lưu (theo quy chế) đang hiệu lực tại `ngay`. */
export function ghiDanhDangBaoLuuTai(ngay: Date): Prisma.EnrollmentWhereInput {
  return { reserves: { some: hoSoBaoLuuHieuLucTai(ngay) } };
}

/**
 * Bọc một `where` của `Enrollment` để LOẠI ghi danh đang bảo lưu theo quy chế tại `ngay`. Dùng `AND` nên không đè `NOT`/`AND`
 * có sẵn của người gọi.
 *
 *   enrollment.findMany({ where: trongLop({ classId, status: { in: ENROLLMENT_ACTIVE_STATUS_LIST } }, now) })
 */
export function trongLop(where: Prisma.EnrollmentWhereInput, ngay: Date): Prisma.EnrollmentWhereInput {
  return { AND: [where, { NOT: ghiDanhDangBaoLuuTai(ngay) }] };
}

/** Mảnh `select` đủ cho `laDangBaoLuuTheoQuyChe` — gắn vào `select` của truy vấn nạp ghi danh rồi lọc trong bộ nhớ. */
export const CHON_HO_SO_BAO_LUU = {
  reserves: {
    where: { approvedAt: { not: null } },
    select: { startedAt: true, endedAt: true, isActive: true },
  },
} as const satisfies Prisma.EnrollmentSelect;

/** Phiên bản trong bộ nhớ của `ghiDanhDangBaoLuuTai`, cho chỗ đã nạp dữ liệu bằng `CHON_HO_SO_BAO_LUU`. */
export function laDangBaoLuuTheoQuyChe(
  e: { reserves: readonly { startedAt: Date; endedAt: Date | null; isActive: boolean }[] },
  ngay: Date,
): boolean {
  return e.reserves.some((l) => luotConHieuLuc(l, ngay));
}
