// lib/lms/remove-from-class.ts — gỡ MỘT học viên khỏi MỘT lớp (khác
// `lib/students/remove-from-classes.ts`: bên đó gỡ khỏi MỌI lớp khi xoá/nghỉ học).
//
// Yêu cầu 21/08/2026 — nút "Xoá khỏi lớp" ở /admin/classes/<id>/students:
//   • gỡ ra mà học viên VẪN ĐANG HỌC  → em về "chờ xếp lớp lại" (tab Chờ xếp lớp ở
//     /admin/students; xem `lib/students/lifecycle.ts` nhánh `waiting`);
//   • gỡ ra mà học viên ĐÃ NGHỈ HỌC   → mở thêm nút "Nghỉ hẳn" (xoá khỏi hệ thống);
//   • cả hai kết luận chỉ đúng khi em KHÔNG còn lớp nào khác — nên phải ĐẾM lại
//     sau khi gỡ, không suy từ trạng thái trước đó.
//
// ⚠️ KHÔNG có trạng thái "ghi danh không thuộc lớp nào": `Enrollment.classId` là cột
// BẮT BUỘC (schema.prisma:1820). Vì vậy gỡ khỏi lớp = kết thúc ghi danh đó
// (WITHDREW / CANCELLED — xem `removalTargetStatus`), rồi học viên được xếp lớp mới
// bằng ghi danh mới. Muốn giữ nguyên ghi danh + tiền thì dùng "Chuyển lớp".
import type { StudentStatus } from "@prisma/client";

export type RemovalOutcome =
  /** Đã sạch lớp, học viên vẫn đang học ⇒ chờ giáo vụ xếp lớp lại. */
  | "AWAITING_PLACEMENT"
  /** Đã sạch lớp, học viên đã nghỉ học ⇒ được phép xoá khỏi hệ thống. */
  | "CAN_LEAVE_SYSTEM"
  /** Vẫn còn lớp khác ⇒ chưa phải chuyện vòng đời, chỉ là rời một lớp. */
  | "STILL_IN_OTHER_CLASSES";

/** THUẦN — kết cục sau khi đã gỡ khỏi lớp. `otherLiveClassCount` đếm SAU khi gỡ. */
export function decideRemovalOutcome(params: {
  studentStatus: StudentStatus;
  otherLiveClassCount: number;
}): RemovalOutcome {
  const remaining = Math.max(0, params.otherLiveClassCount);
  if (remaining > 0) return "STILL_IN_OTHER_CLASSES";
  return params.studentStatus === "INACTIVE"
    ? "CAN_LEAVE_SYSTEM"
    : "AWAITING_PLACEMENT";
}

/**
 * Chỉ kết cục CAN_LEAVE_SYSTEM mới được mở nút "Nghỉ hẳn". Khớp đúng guard của
 * `deleteStudent` (chỉ xoá được học viên đã INACTIVE) — UI không hứa thứ server từ chối.
 */
export function canLeaveSystemAfterRemoval(outcome: RemovalOutcome): boolean {
  return outcome === "CAN_LEAVE_SYSTEM";
}

/** THUẦN — câu báo cho người dùng, nói rõ em đó giờ đang ở đâu. */
export function describeRemovalOutcome(
  outcome: RemovalOutcome,
  studentName: string,
  otherLiveClassCount: number,
): string {
  switch (outcome) {
    case "STILL_IN_OTHER_CLASSES":
      return `Đã gỡ ${studentName} khỏi lớp này. Em vẫn còn ${Math.max(
        0,
        otherLiveClassCount,
      )} lớp khác nên hồ sơ không đổi trạng thái.`;
    case "AWAITING_PLACEMENT":
      // 09/10/2026 — câu cũ hứa "chờ xếp lớp lại" mà không chỉ LỐI nào xếp được (và xếp lại
      // CHÍNH lớp này từng bị chặn vì dòng "Đã huỷ"). Nay nói đúng nút cần bấm.
      return `Đã gỡ ${studentName} khỏi lớp. Em không còn lớp nào — hồ sơ nằm ở tab "Chờ xếp lớp" trong Học viên; mở hồ sơ em, bấm "Ghi danh vào lớp" để xếp lớp mới hoặc xếp lại chính lớp này.`;
    case "CAN_LEAVE_SYSTEM":
      return `Đã gỡ ${studentName} khỏi lớp. Em đang ở trạng thái Nghỉ học và không còn lớp nào — có thể cho nghỉ hẳn (xoá khỏi hệ thống).`;
  }
}
