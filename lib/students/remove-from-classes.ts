// lib/students/remove-from-classes.ts — gỡ học viên khỏi MỌI lớp còn đang theo học.
//
// SỰ CỐ 07/08/2026: `deleteStudent` chỉ soft-delete bảng `Student` mà không đụng
// `Enrollment`. Mọi màn "học viên của lớp" đọc TỪ Enrollment → student, nên HV đã xoá
// vẫn nằm nguyên trong lớp (admin lẫn site GV), vẫn bị điểm danh, vẫn gửi thông báo cho
// phụ huynh. `/admin/students` thì lại lọc `deletedAt: null` ⇒ nhìn 2 màn thấy 2 sự thật.
//
// ⚠️ ĐỔI `status`, KHÔNG set `Enrollment.deletedAt`. `deletedAt` là "soft-delete TÀI
// CHÍNH" (schema.prisma) và bị lọc bởi soft-delete extension ⇒ set nó sẽ rút khoản phải
// thu khỏi công nợ (`lib/finance/debt.ts` lọc `deletedAt: null`, KHÔNG lọc status) và
// làm lệch phân bổ thanh toán. Đổi status giữ nguyên sổ sách, chỉ gỡ khỏi danh sách lớp.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN D [21/09/2026] — phần ĐỔI TRẠNG THÁI MỘT GHI DANH dời sang
// `lib/students/ket-thuc-ghi-danh.ts`, và hàm này nay GỌI nó trong vòng lặp.
//
// Vì sao: PHIÊN D dừng học ĐÚNG MỘT bé trên đúng một dòng đơn, nên nó cần cửa vào cấp
// ghi-danh; hàm này thì quét mọi lớp của học viên. Chép tay một bản thứ hai của phép đổi
// trạng thái + hai dòng nhật ký là hai bản sẵn sàng lệch nhau — và lệch ở đây nghĩa là
// một đường gỡ bé khỏi lớp mà KHÔNG có `EnrollmentAuditLog`.
//
// ⚠️ Hành vi của hàm này KHÔNG ĐỔI một li: nó không truyền `endedAt`, nên cột đó vẫn
// nguyên như trước (báo cáo churn vẫn rơi về `updatedAt`). Ca `[KTGD-03]` ghim điều đó.
import type { EnrollmentStatus, Prisma } from "@prisma/client";
import { syncConversationMembership } from "@/lib/chat/sync-membership";
import {
  ketThucMotGhiDanh,
  removalTargetStatus,
  type GhiDanhDaKetThuc,
} from "@/lib/students/ket-thuc-ghi-danh";

/**
 * Ghi danh còn "sống" — học viên vẫn thuộc lớp. Rộng hơn `ENROLLMENT_ACTIVE_STATUS_LIST`
 * vì có thêm `PENDING` (chờ xếp lớp): chưa hiện ở roster nhưng vẫn phải dọn.
 */
export const REMOVABLE_ENROLLMENT_STATUSES: EnrollmentStatus[] = [
  "PENDING",
  "CONFIRMED",
  "STUDYING",
  "ACTIVE",
  "PAUSED",
];

// Tái xuất để mọi chỗ đang `import { removalTargetStatus } from ".../remove-from-classes"`
// không phải đổi — luật sống ở `ket-thuc-ghi-danh.ts`, đây chỉ là cửa cũ.
export { removalTargetStatus };

/** Giữ tên cũ cho mọi nơi đang dùng; kiểu thật nằm ở `ket-thuc-ghi-danh.ts`. */
export type RemovedEnrollment = GhiDanhDaKetThuc;

/**
 * Chuyển mọi ghi danh còn sống của học viên sang trạng thái kết thúc, kèm
 * `EnrollmentAuditLog` + `AuditLog` hợp nhất cho từng dòng.
 *
 * Gọi BÊN TRONG transaction đã đụng `Student` — gỡ lớp và xoá HV phải cùng sống cùng chết.
 * Idempotent: HV đã đi qua "Nghỉ học" (`withdrawStudentAction`) thì không còn dòng nào
 * khớp, hàm trả mảng rỗng.
 *
 * Cách ly cơ sở: hàm lọc theo `studentId` — caller PHẢI kiểm quyền trên học viên trước
 * (scopedDb KHÔNG che write).
 */
export async function removeStudentFromClasses(params: {
  tx: Prisma.TransactionClient;
  studentId: string;
  actorId: string | null;
  actorName: string;
  /** Lý do ghi vào audit — hiện trong lịch sử ghi danh. */
  reason: string;
  /** Cơ sở của học viên, để gắn vào AuditLog hợp nhất. */
  orgUnitId?: string | null;
}): Promise<RemovedEnrollment[]> {
  const { tx, studentId } = params;

  const live = await tx.enrollment.findMany({
    where: {
      studentId,
      status: { in: REMOVABLE_ENROLLMENT_STATUSES },
      deletedAt: null,
    },
    select: { id: true, status: true, classId: true },
  });
  if (live.length === 0) return [];

  const removed: RemovedEnrollment[] = [];
  for (const enr of live) {
    removed.push(
      await ketThucMotGhiDanh({
        tx,
        ghiDanh: enr,
        actorId: params.actorId,
        actorName: params.actorName,
        reason: params.reason,
        orgUnitId: params.orgUnitId ?? null,
        // ⚠️ KHÔNG truyền `endedAt` — xem khối chú thích đầu tệp. Truyền vào là đổi hành
        // vi của đường "Nghỉ học hẳn" đang chạy, trong một lượt tách vốn phải im lặng.
      }),
    );
  }

  // US-03 chat — HV rời các lớp → sync nhóm lớp từng lớp (PH rời nếu hết con trong
  // lớp), cùng transaction của caller.
  for (const classId of new Set(live.map((e) => e.classId))) {
    await syncConversationMembership(tx, classId);
  }

  return removed;
}
