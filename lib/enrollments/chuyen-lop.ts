// lib/enrollments/chuyen-lop.ts — CHUYỂN GHI DANH SANG LỚP KHÁC, phần chạy TRONG transaction.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TÁCH RA [PHIÊN F4 · 22/09/2026]
//
// Phép chuyển lớp vốn nằm trọn trong `transferEnrollment` (`app/(admin)/admin/enrollments/
// _actions.ts`) — một Server Action tự mở transaction Serializable của nó. F4 ("đổi khoá /
// đổi lớp") cần ĐÚNG phép ấy, nhưng phải chạy **trong cùng transaction tiền** (`ghiTienChoDon`,
// khoá advisory theo đơn), vì:
//
//   · `confirmPayment` TỪ CHỐI khoản chưa gắn ghi danh — *"Khoản chưa gắn ghi danh, không thể
//     sinh phiếu thu"* (`lib/finance/payment.ts:631`). Nên khoản tiền chuyển sang dòng MỚI mà
//     dòng ấy chưa có ghi danh là một khoản **không bao giờ xuất được phiếu thu**. Tức phép
//     chuyển lớp không phải "việc học vụ làm sau" — nó là điều kiện để phép ghi tiền đúng.
//   · Hai transaction rời thì hỏng ở giữa để lại: ghi danh đã chuyển mà tiền chưa theo, hoặc
//     ngược lại.
//
// ⚠️ Và vì sao TÁCH chứ không chép: ba bản chép tay của cùng một luật thì vá được hai bản là
// chuyện thường — bài học `lib/payments/don-nhan-tien.ts` sau khi ba nhánh tra đơn lệch nhau.
// Nên `transferEnrollment` NAY GỌI hàm này; luật chuyển lớp chỉ còn một chỗ.
//
// ⚠️ Hàm này KHÔNG kiểm quyền và KHÔNG kiểm cách ly cơ sở. Đó là việc của người gọi, và cố ý:
// nó chạy trong transaction của người gọi, nơi `scopedDb` không còn ở giữa. Hai người gọi hiện
// có đều gác đủ trước khi mở transaction.
import "server-only";
import type { Prisma } from "@prisma/client";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { syncConversationMembership } from "@/lib/chat/sync-membership";
import { CAPACITY_COUNT_STATUSES } from "@/lib/lms/assign";

type Tx = Prisma.TransactionClient;

/** Lỗi nghiệp vụ của phép chuyển lớp — người gọi bắt và dịch sang câu cho người dùng. */
export class ChuyenLopError extends Error {}

export type KetQuaChuyenLop = {
  newEnrollmentId: string;
  /** Khoá học của lớp đích — người gọi cần nó để dựng dòng hàng mới. */
  courseId: string;
  targetClassName: string;
  targetCenterId: string | null;
};

/**
 * Chuyển một ghi danh sang lớp khác, TRONG transaction của người gọi.
 *
 * Người gọi PHẢI đã kiểm: quyền, cách ly cơ sở của lớp nguồn lẫn lớp đích, và ghi danh cũ
 * không ở trạng thái kết thúc.
 *
 * ⚠️ Kiểm sĩ số lớp đích LẠI ở đây, trong transaction — không tin con số đã đọc ngoài
 * transaction (chống TOCTOU, đúng FIX-C4 của bản cũ). Hai người bấm chuyển vào lớp cuối cùng
 * còn một chỗ thì người thứ hai phải bị từ chối, chứ không phải cả hai cùng vào.
 */
export async function chuyenLopTrongTx(
  tx: Tx,
  input: {
    oldEnrollmentId: string;
    targetClassId: string;
    reason: string;
    actor: AuditActor;
  },
): Promise<KetQuaChuyenLop> {
  const cu = await tx.enrollment.findFirst({
    where: { id: input.oldEnrollmentId, deletedAt: null },
    select: {
      id: true,
      status: true,
      studentId: true,
      classId: true,
      class: { select: { centerId: true } },
    },
  });
  if (!cu) throw new ChuyenLopError("Không tìm thấy ghi danh cũ");
  if (cu.classId === input.targetClassId) {
    throw new ChuyenLopError("Lớp đích trùng lớp hiện tại");
  }

  const lop = await tx.class.findFirst({
    where: { id: input.targetClassId, deletedAt: null },
    select: { id: true, name: true, courseId: true, centerId: true, maxStudents: true, status: true },
  });
  if (!lop) throw new ChuyenLopError("Không tìm thấy lớp đích");
  if (lop.status === "CANCELLED" || lop.status === "COMPLETED") {
    throw new ChuyenLopError(`Lớp đích đang ${lop.status}`);
  }

  const dangCo = await tx.enrollment.count({
    where: {
      classId: input.targetClassId,
      status: { in: [...CAPACITY_COUNT_STATUSES] },
      deletedAt: null,
    },
  });
  if (dangCo >= lop.maxStudents) {
    throw new ChuyenLopError(`Lớp đích đã đủ học sinh (${lop.maxStudents} chỗ)`);
  }

  // Ghi danh CÒN SỐNG của chính bé ở lớp đích ⇒ chặn. Tầng nền của `lib/db.ts` không hook
  // được quan hệ lồng, nhưng đây là truy vấn cấp cao nhất nên `deletedAt: null` vẫn cần khai
  // tay trong transaction thô.
  const daCo = await tx.enrollment.findFirst({
    where: { studentId: cu.studentId, classId: input.targetClassId, deletedAt: null },
    select: { status: true },
  });
  if (daCo) {
    throw new ChuyenLopError(`Học sinh đã có ghi danh ở lớp đích (đang ${daCo.status})`);
  }

  const moi = await tx.enrollment.create({
    data: {
      student: { connect: { id: cu.studentId } },
      class: { connect: { id: input.targetClassId } },
      course: { connect: { id: lop.courseId } },
      // FL3-02 — phi chuẩn hoá từ lớp ĐÍCH cho `scopedDb`. Lấy từ lớp cũ là bé chuyển sang
      // cơ sở khác mà vẫn nằm trong tầm nhìn cơ sở cũ.
      centerId: lop.centerId,
      status: "CONFIRMED",
      confirmedAt: new Date(),
      notes: `Chuyển từ ghi danh ${cu.id}`,
    },
    select: { id: true },
  });

  await tx.enrollment.update({
    where: { id: cu.id },
    data: {
      status: "TRANSFERRED",
      transferredToId: moi.id,
      transferReason: input.reason,
      endedAt: new Date(),
    },
  });

  await tx.enrollmentAuditLog.create({
    data: {
      enrollmentId: cu.id,
      fromStatus: cu.status,
      toStatus: "TRANSFERRED",
      changedByUserId: input.actor.id || null,
      changedByName: input.actor.name,
      reason: input.reason,
      extraData: { transferredToId: moi.id, targetClassId: input.targetClassId },
    },
  });
  await tx.enrollmentAuditLog.create({
    data: {
      enrollmentId: moi.id,
      fromStatus: "—",
      toStatus: "CONFIRMED",
      changedByUserId: input.actor.id || null,
      changedByName: input.actor.name,
      reason: `Chuyển từ lớp cũ: ${input.reason}`,
      extraData: { transferredFromId: cu.id, sourceClassId: cu.classId },
    },
  });

  await writeAudit({
    tx,
    actor: input.actor,
    module: "enrollment",
    entityType: "Enrollment",
    entityId: cu.id,
    action: "STATUS_CHANGE",
    oldValues: { status: cu.status },
    newValues: { status: "TRANSFERRED", transferredToId: moi.id },
    reason: input.reason,
    orgUnitId: cu.class?.centerId ?? null,
  });
  await writeAudit({
    tx,
    actor: input.actor,
    module: "enrollment",
    entityType: "Enrollment",
    entityId: moi.id,
    action: "CREATE",
    newValues: {
      studentId: cu.studentId,
      classId: input.targetClassId,
      courseId: lop.courseId,
      status: "CONFIRMED",
      transferredFromId: cu.id,
    },
    reason: `Chuyển từ lớp cũ: ${input.reason}`,
    orgUnitId: lop.centerId,
  });

  // US-03 chat / TS-05 — PH rời nhóm cũ + vào nhóm mới, TRONG CÙNG transaction: rollback thì
  // không có chuyện đồng bộ nửa vời.
  await syncConversationMembership(tx, cu.classId);
  await syncConversationMembership(tx, input.targetClassId);

  return {
    newEnrollmentId: moi.id,
    courseId: lop.courseId,
    targetClassName: lop.name,
    targetCenterId: lop.centerId,
  };
}
