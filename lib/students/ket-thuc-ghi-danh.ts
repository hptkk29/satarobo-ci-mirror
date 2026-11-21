import "server-only";

// lib/students/ket-thuc-ghi-danh.ts — KẾT THÚC MỘT GHI DANH. Phần KHÔNG-TIỀN, một bé, một lớp.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TÁCH RA  [PHIÊN D · 21/09/2026]
//
// Chủ dự án chốt: *"Tách `removeStudentFromClasses` thành hai phần: phần KHÔNG-TIỀN (đổi
// `Enrollment.status`, rời roster/lịch buổi tương lai, sĩ số, thông báo…) và phần TIỀN
// (`createRefundRequest` theo buổi COMPLETED). PHIÊN D gọi phần KHÔNG-TIỀN, KHÔNG gọi phần
// tiền."*
//
// Phép tách ấy **đã tồn tại sẵn** ở ranh giới hai tệp — khảo sát 21/09 đếm đủ bốn tác dụng
// phụ của `removeStudentFromClasses` và không cái nào chạm tiền:
//
//   | tác dụng phụ                       | tiền? |
//   |------------------------------------|-------|
//   | `enrollment.update({ status })`    | không |
//   | `enrollmentAuditLog.create`        | không |
//   | `writeAudit` (module `students`)   | không |
//   | `syncConversationMembership`       | không |
//   | `createRefundRequest`              | **TIỀN** — nằm ở `lib/students/withdraw.ts:64`, NGOÀI |
//
// Thứ CHƯA có là **cửa vào cho MỘT ghi danh**: hàm cũ quét mọi lớp của học viên, mà PHIÊN D
// dừng đúng một bé trên đúng một dòng đơn. Tệp này là cửa đó, và `removeStudentFromClasses`
// nay gọi chính nó trong vòng lặp — nên hai đường KHÔNG THỂ lệch hành vi.
//
// ⚠️ ĐỪNG thêm bất cứ phép chạm tiền nào vào tệp này. Nó tồn tại để đảm bảo gọi nó KHÔNG
// sinh ra một đồng nào. Cần tiền thì gọi thêm ở tầng trên, như `withdraw.ts` đang làm.
import type { EnrollmentStatus, Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";

/**
 * Trạng thái đích khi gỡ HV khỏi lớp. `PENDING` chưa từng được xếp lớp nên đi `CANCELLED`;
 * các trạng thái còn lại đi `WITHDREW`. Khớp state machine `ENROLLMENT_TRANSITIONS`
 * (`lib/enrollments/status.ts`) — PENDING KHÔNG có đích WITHDREW.
 *
 * ⚠️ Chuyển từ `remove-from-classes.ts` sang đây NGUYÊN VẸN; tệp kia vẫn tái xuất nó để
 * mọi chỗ đang import không phải đổi.
 */
export function removalTargetStatus(from: EnrollmentStatus): EnrollmentStatus {
  return from === "PENDING" ? "CANCELLED" : "WITHDREW";
}

export type GhiDanhDaKetThuc = {
  id: string;
  /** Lớp mà ghi danh này vừa bị gỡ ra — caller dùng để revalidate màn roster lớp đó. */
  classId: string;
  fromStatus: EnrollmentStatus;
  toStatus: EnrollmentStatus;
};

/**
 * Kết thúc MỘT ghi danh: đổi trạng thái + hai dòng nhật ký. KHÔNG chạm tiền, KHÔNG đồng bộ
 * nhóm chat (việc đó gom theo LỚP ở tầng gọi, để n bé cùng lớp chỉ sync một lần).
 *
 * ⚠️ KHÔNG set `Enrollment.deletedAt`. `deletedAt` là "soft-delete TÀI CHÍNH"
 * (`prisma/schema.prisma`) và bị lọc bởi soft-delete extension ⇒ set nó sẽ rút khoản phải
 * thu khỏi công nợ (`lib/finance/debt.ts` lọc `deletedAt: null`, KHÔNG lọc `status`) và làm
 * lệch phân bổ thanh toán. Ghi chú gốc + sự cố 07/08/2026 ở `remove-from-classes.ts`.
 */
export async function ketThucMotGhiDanh(params: {
  tx: Prisma.TransactionClient;
  ghiDanh: { id: string; status: EnrollmentStatus; classId: string };
  actorId: string | null;
  actorName: string;
  /** Lý do ghi vào audit — hiện trong lịch sử ghi danh. */
  reason: string;
  /** Cơ sở, để gắn vào AuditLog hợp nhất. */
  orgUnitId?: string | null;
  /**
   * NGÀY HIỆU LỰC — ghi vào `Enrollment.endedAt`.
   *
   * ⚠️ `undefined` = **KHÔNG ĐỤNG** cột đó. Mặc định ấy là chủ đích: đường "Nghỉ học hẳn"
   * hiện tại chưa bao giờ set `endedAt` (báo cáo churn tự rơi về `updatedAt` —
   * `app/(admin)/admin/bao-cao/churn/page.tsx:109`), và lượt tách này KHÔNG được đổi hành vi
   * của nó. PHIÊN D thì truyền vào: ngày hiệu lực của nó là NGÀY BUỔI CUỐI sale xác nhận,
   * không phải lúc bấm nút.
   */
  endedAt?: Date;
}): Promise<GhiDanhDaKetThuc> {
  const { tx, ghiDanh } = params;
  const toStatus = removalTargetStatus(ghiDanh.status);

  await tx.enrollment.update({
    where: { id: ghiDanh.id },
    data: {
      status: toStatus,
      ...(params.endedAt ? { endedAt: params.endedAt } : {}),
    },
  });

  await tx.enrollmentAuditLog.create({
    data: {
      enrollmentId: ghiDanh.id,
      fromStatus: ghiDanh.status,
      toStatus,
      changedByUserId: params.actorId,
      changedByName: params.actorName,
      reason: params.reason,
    },
  });

  await writeAudit({
    actor: { id: params.actorId, name: params.actorName },
    module: "students",
    entityType: "Enrollment",
    entityId: ghiDanh.id,
    action: "STATUS_CHANGE",
    oldValues: { status: ghiDanh.status },
    newValues: {
      status: toStatus,
      ...(params.endedAt ? { endedAt: params.endedAt.toISOString() } : {}),
    },
    changedFields: params.endedAt ? ["status", "endedAt"] : ["status"],
    reason: params.reason,
    orgUnitId: params.orgUnitId ?? null,
    tx,
  });

  return {
    id: ghiDanh.id,
    classId: ghiDanh.classId,
    fromStatus: ghiDanh.status,
    toStatus,
  };
}
