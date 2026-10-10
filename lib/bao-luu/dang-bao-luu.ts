// lib/bao-luu/dang-bao-luu.ts — "ghi danh này ĐANG BẢO LƯU tại ngày X không". THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN 1 · MỘT CÂU HỎI, MỘT CHỖ TRẢ LỜI
//
// Trước bản này, "đang bảo lưu" được suy bằng BA cách khác nhau tuỳ chỗ:
//   · phía TIỀN (`locDotCuaConDangBaoLuu`) đọc `StudentReserve` còn hiệu lực;
//   · cron `renewal-reminder` đọc `Student.status !== "ACTIVE"`;
//   · phía lớp/điểm danh đọc `Enrollment.status === "PAUSED"` — và coi PAUSED là "vẫn thuộc lớp".
// Ba nguồn ấy KHÔNG đồng nghĩa nhau: `approveReserveRequest` chỉ chuyển ghi danh `STUDYING`
// (bỏ sót `ACTIVE`, mà `ACTIVE` mới là trạng thái mặc định của ghi danh thật), và có ba đường
// đặt `PAUSED` KHÔNG tạo `StudentReserve`. Nên **`status` không đủ để nhận ra bảo lưu**.
//
// ⚠️ NGUỒN SỰ THẬT = `StudentReserve` CÒN HIỆU LỰC. Hàm này bọc `dongNaoDangBaoLuu`
// (`lib/finance/bao-luu-con.ts`) — phép ghép hai vế `enrollmentId` — chứ KHÔNG viết lại điều
// kiện: bỏ vế `enrollmentId === null` là bỏ sót bảo lưu CẢ HỌC VIÊN, bỏ vế `=== X` là tha nhầm
// khoá còn đang học của bé học hai lớp (repo có 77/170 học viên học ≥2 lớp).
//
// ⚠️ `ngay` LÀ THAM SỐ BẮT BUỘC, không `new Date()` (luật 19): phép này quyết định có nhắc nợ
// phụ huynh hay không, nên một hàm rơi về đồng hồ thật là một ca test hẹn giờ nổ.
//
// ⚠️ Hết `expectedEndAt` mà chưa ai đóng lượt (quá hạn dự kiến) VẪN LÀ ĐANG BẢO LƯU — đúng như
// phía tiền đang làm từ F2, và đúng BR-19: quá hạn không tự chấm dứt, phải có thông báo chính
// thức. Đừng thêm điều kiện `ngay <= expectedEndAt` ở đây; làm vậy là nhắc nợ phụ huynh vừa
// quá ngày quay lại mà Trung tâm chưa kịp liên hệ.

import { dongNaoDangBaoLuu } from "@/lib/finance/bao-luu-con";

/** Một lượt `StudentReserve`, chỉ phần cần để trả lời câu hỏi. */
export type LuotBaoLuu = {
  id: string;
  studentId: string;
  /** `null` = bảo lưu CẢ HỌC VIÊN (dòng cũ trước khi hồ sơ mới bắt buộc `enrollmentId`). */
  enrollmentId: string | null;
  startedAt: Date;
  expectedEndAt: Date | null;
  endedAt: Date | null;
  isActive: boolean;
};

/** Một cặp (học viên × ghi danh) cần hỏi. `enrollmentId = null` = chỉ biết học viên. */
export type CapHocVien = { studentId: string; enrollmentId: string | null };

/**
 * Lượt này có hiệu lực tại `ngay` không.
 *
 *   · chưa bắt đầu (`startedAt > ngay`) ⇒ không;
 *   · chưa đóng (`endedAt = null`)       ⇒ theo `isActive`;
 *   · đã đóng (`endedAt` có giá trị)     ⇒ còn hiệu lực cho tới TRƯỚC `endedAt`.
 *
 * Nhánh "đã đóng" cho phép hỏi về quá khứ (điểm danh một buổi cũ nằm trong khoảng bảo lưu) mà
 * không cần bảng khác. Hỏi về "bây giờ" thì nó trùng đúng điều kiện phía tiền đang dùng
 * (`isActive: true, endedAt: null`).
 */
export function luotConHieuLuc(
  l: Pick<LuotBaoLuu, "startedAt" | "endedAt" | "isActive">,
  ngay: Date,
): boolean {
  if (l.startedAt.getTime() > ngay.getTime()) return false;
  if (l.endedAt === null) return l.isActive;
  return ngay.getTime() < l.endedAt.getTime();
}

/** Cặp (học viên × ghi danh) này có nằm trong một lượt bảo lưu còn hiệu lực tại `ngay` không. */
export function capDangBaoLuu(
  cap: CapHocVien,
  luot: readonly LuotBaoLuu[],
  ngay: Date,
): boolean {
  const conHieuLuc = luot.filter((l) => luotConHieuLuc(l, ngay));
  if (conHieuLuc.length === 0) return false;
  const KHOA = "cap";
  const ban = dongNaoDangBaoLuu({
    dong: [{ orderItemId: KHOA, enrollmentId: cap.enrollmentId, studentId: cap.studentId }],
    luot: conHieuLuc,
  });
  return ban.has(KHOA);
}

/** Một dòng của đơn, chỉ phần cần để suy "dòng này thuộc bé nào". */
export type DongDonDeSuyBe = {
  /** `OrderItemType` — chỉ cần biết dòng có phải khoá học không. */
  type: string;
  enrollmentId: string | null;
  /** `Enrollment.studentId` của ghi danh nối vào dòng (nếu có). */
  enrollmentStudentId: string | null;
  /** `OrderItem.studentId` — có ngay lúc tạo đơn, kể cả khi chưa có ghi danh. */
  studentId: string | null;
};

/**
 * Các bé mà một đơn thu tiền hộ.
 *
 * Trả `null` khi KHÔNG xác định được bé cho một dòng KHOÁ HỌC ⇒ người gọi phải coi đơn là
 * "không bảo lưu" (fail-closed theo chiều đúng: nhầm thành "đang bảo lưu" là tha nhắc nợ cho một
 * khoản không ai xin tha — đúng chiều mà `bao-luu-tien.ts:282-284` đã chọn cho phiếu `orderItemId = NULL`).
 *
 * Dòng KHÔNG phải khoá học (kit, sản phẩm…) không nói gì về bé nên bị bỏ qua — nếu đơn chỉ có
 * dòng như vậy thì rơi về `Order.studentId`.
 */
export function capHocVienCuaDon(input: {
  orderStudentId: string | null;
  items: readonly DongDonDeSuyBe[];
}): CapHocVien[] | null {
  const ra = new Map<string, CapHocVien>();
  const them = (c: CapHocVien) => ra.set(`${c.studentId}|${c.enrollmentId ?? ""}`, c);

  for (const it of input.items) {
    if (it.enrollmentId && it.enrollmentStudentId) {
      them({ studentId: it.enrollmentStudentId, enrollmentId: it.enrollmentId });
    } else if (it.studentId) {
      them({ studentId: it.studentId, enrollmentId: null });
    } else if (it.type === "COURSE_ENROLLMENT") {
      return null;
    }
  }
  if (ra.size === 0 && input.orderStudentId) {
    them({ studentId: input.orderStudentId, enrollmentId: null });
  }
  return [...ra.values()];
}

/**
 * Đơn có ĐANG BẢO LƯU toàn bộ không — tức MỌI bé mà đơn thu hộ đều đang bảo lưu.
 *
 * ⚠️ `every`, không `some`: đơn nhiều con mà chỉ một bé bảo lưu thì đợt thu của đơn VẪN còn
 * đúng hạn với bé kia. Tha cả đơn vì một bé là tha nhầm tiền của bé đang học. (Phía tiền
 * `PaymentRequest` hỏi theo TỪNG DÒNG nên không vướng chuyện này; `OrderInstallment` — sổ cũ —
 * chỉ có mức ĐƠN.)
 */
export function donDangBaoLuu(
  cap: readonly CapHocVien[] | null,
  luot: readonly LuotBaoLuu[],
  ngay: Date,
): boolean {
  if (!cap || cap.length === 0) return false;
  return cap.every((c) => capDangBaoLuu(c, luot, ngay));
}
