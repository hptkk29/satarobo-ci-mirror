import "server-only";

// lib/students/withdraw.ts — phần CASCADE của "Nghỉ học hẳn": gỡ học viên khỏi mọi lớp
// còn sống + tạo yêu cầu hoàn tiền cho từng ghi danh vừa gỡ.
//
// TÁCH RA THÀNH LIB VÌ ĐÃ TỪNG HỎNG Ở ĐÂY (bug 21/08/2026): `withdrawStudentAction`
// tự chép tay danh sách trạng thái ghi danh cần dọn —
// `["PENDING","CONFIRMED","STUDYING","PAUSED"]` — và BỎ SÓT `ACTIVE`. Mà `ACTIVE` là
// giá trị MẶC ĐỊNH của `Enrollment.status` (prisma/schema.prisma:1822) và là thứ hai
// đường convert lead sinh ra (`lib/crm/convert-lead.ts:136`,
// `lib/crm/convert-lead-v2.ts:286`, kể cả bulk-convert) ⇒ phần lớn học viên THẬT mang
// ghi danh `ACTIVE`. Roster lớp lại CÓ lọc `ACTIVE`, nên bấm đúng nút "❌ Nghỉ học hẳn"
// mà em đó vẫn nằm nguyên trong lớp, vẫn bị điểm danh — và cũng không có yêu cầu hoàn
// tiền nào được tạo (vòng lặp tạo hoàn tiền nằm trong chính vòng lặp bỏ sót).
//
// Nay chỉ còn MỘT nguồn sự thật: `REMOVABLE_ENROLLMENT_STATUSES`, dùng chung với
// `deleteStudent`. Có test hồi quy ở `tests/e2e/r7/withdraw-student-legacy-active.spec.ts`.
//
// ─────────────────────────────────────────────────────────────────────────────
// GHI DANH ĐÃ QUYẾT TOÁN QUA "DỪNG HỌC" — BỎ QUA PHẦN TIỀN, KHÔNG CHẶN CẢ THAO TÁC
//
// Chủ dự án chốt 21/09/2026 (sửa lại bản đầu của PHIÊN D):
//
//   *"'Nghỉ học hẳn' KHÔNG được throw cả thao tác. Mục đích là chặn hoàn tiền KÉP, không
//   chặn cho bé nghỉ (bé có thể còn ghi danh khoá khác)."*
//
// Bản đầu để `createRefundRequest` ném và không ai bắt ⇒ một học viên có MỘT dòng đơn đã
// STOPPED thì **không bao giờ** cho nghỉ hẳn được nữa, kể cả khi em còn ba ghi danh khác
// chưa ai đụng tới. Cổng đúng chỗ, sai tầm: nó chặn một việc KHÁC với việc nó muốn chặn.
//
// Nay:
//   · phần KHÔNG-TIỀN chạy cho **mọi** ghi danh (gỡ lớp, đổi trạng thái, sync nhóm chat);
//   · phần TIỀN **bỏ qua** đúng những ghi danh đã quyết toán, và NÓI RA (trả về danh sách
//     + ghi `AuditLog`) thay vì im lặng;
//   · `createRefundRequest` **vẫn ném** — nó là lưới CUỐI cho đường nào quên hỏi.
//
// ⚠️ Điều kiện "đã quyết toán" hỏi ở MỘT chỗ: `dongDonDaQuyetToan` (`lib/finance/refund.ts`).
// Chép tay `status: "STOPPED"` về đây là hai cổng cho cùng một luật, và hai cổng thì có
// ngày lệch — đúng lớp lỗi mà chính tệp này ra đời để chấm dứt.
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { createRefundRequest, dongDonDaQuyetToan } from "@/lib/finance/refund";
import {
  removeStudentFromClasses,
  type RemovedEnrollment,
} from "@/lib/students/remove-from-classes";

/** Một ghi danh đã rời lớp nhưng KHÔNG sinh đề xuất hoàn — kèm lý do người đọc hiểu được. */
export type GhiDanhBoQuaHoanTien = {
  enrollmentId: string;
  classId: string;
  orderItemId: string;
  orderCode: string | null;
  /** Câu hiển thị thẳng lên màn, không phải mã lỗi. */
  lyDo: string;
};

export type KetQuaNghiHocHan = {
  daGo: RemovedEnrollment[];
  /** Rỗng là bình thường. Có dòng ⇒ màn hình PHẢI in ra, đừng nuốt. */
  boQuaHoanTien: GhiDanhBoQuaHoanTien[];
};

/**
 * Gọi BÊN TRONG transaction đã đổi `Student.status = INACTIVE` — gỡ lớp, hoàn tiền và
 * đổi trạng thái học viên phải cùng sống cùng chết.
 *
 * Idempotent: học viên đã sạch lớp thì trả mảng rỗng và không tạo yêu cầu hoàn tiền nào
 * (`createRefundRequest` cũng tự idempotent theo cặp enrollment × trigger, và bỏ qua khi
 * chưa thu được đồng nào).
 *
 * Cách ly cơ sở: lọc theo `studentId` — caller PHẢI kiểm quyền trên học viên trước
 * (scopedDb KHÔNG che write).
 */
export async function withdrawStudentFromAllClasses(params: {
  tx: Prisma.TransactionClient;
  studentId: string;
  actorId: string | null;
  actorName: string;
  /** Lý do đã kèm tiền tố, ví dụ `Học viên nghỉ học: <lý do admin nhập>`. */
  reason: string;
  orgUnitId?: string | null;
  /**
   * Mốc "bây giờ" dùng để hỏi sổ buổi của lớp đã chốt tới đâu (`createRefundRequest`).
   * Bỏ trống = đồng hồ thật. Có mặt để TEST đóng băng được mốc — luật 19: ca test đọc
   * đồng hồ thật là ca hẹn giờ nổ (fixture ghi ngày tuyệt đối, tờ lịch đổi thì kết quả
   * đổi trong khi mã không đổi dòng nào).
   */
  now?: Date;
}): Promise<RemovedEnrollment[]> {
  const kq = await nghiHocHan(params);
  return kq.daGo;
}

/**
 * Bản ĐẦY ĐỦ — trả cả danh sách ghi danh bị bỏ qua phần tiền.
 *
 * ⚠️ `withdrawStudentFromAllClasses` ở trên giữ nguyên chữ ký cũ (trả mảng ghi danh) để
 * ba chỗ gọi hiện có + hai spec R7 không phải đổi một dòng nào. Màn nào muốn NÓI cho người
 * dùng biết vì sao một ghi danh không có đề xuất hoàn thì gọi hàm này.
 */
export async function nghiHocHan(params: {
  tx: Prisma.TransactionClient;
  studentId: string;
  actorId: string | null;
  actorName: string;
  reason: string;
  orgUnitId?: string | null;
  now?: Date;
}): Promise<KetQuaNghiHocHan> {
  const removed = await removeStudentFromClasses({
    tx: params.tx,
    studentId: params.studentId,
    actorId: params.actorId,
    actorName: params.actorName,
    reason: params.reason,
    orgUnitId: params.orgUnitId ?? null,
  });

  const boQuaHoanTien: GhiDanhBoQuaHoanTien[] = [];

  for (const enr of removed) {
    // Hỏi TRƯỚC, bỏ qua phần tiền của riêng ghi danh này — không ném, không dừng vòng lặp.
    const daQuyetToan = await dongDonDaQuyetToan(params.tx, enr.id);
    if (daQuyetToan) {
      const lyDo = `Đã quyết toán khi dừng học trên đơn ${daQuyetToan.orderCode ?? daQuyetToan.id} — không hoàn lại`;
      boQuaHoanTien.push({
        enrollmentId: enr.id,
        classId: enr.classId,
        orderItemId: daQuyetToan.id,
        orderCode: daQuyetToan.orderCode,
        lyDo,
      });
      // Ghi vết: "không có đề xuất hoàn" phải có câu trả lời cho "vì sao", kẻo ba tháng sau
      // không ai phân biệt được nó với một lượt bỏ sót.
      await writeAudit({
        tx: params.tx,
        actor: { id: params.actorId, name: params.actorName },
        module: "finance",
        entityType: "Enrollment",
        entityId: enr.id,
        action: "REFUND_REQUEST_SKIPPED",
        newValues: {
          boQuaDeXuatHoanTien: true,
          orderItemId: daQuyetToan.id,
          orderCode: daQuyetToan.orderCode,
          lyDo,
        },
        reason: lyDo,
        orgUnitId: params.orgUnitId ?? null,
      });
      continue;
    }

    // W3-1 / LMS-9 — HS nghỉ học → yêu cầu hoàn tiền (PENDING) cho ghi danh còn sống,
    // trong cùng transaction. Idempotent + chỉ tạo khi đã có khoản thu xác nhận.
    await createRefundRequest({
      enrollmentId: enr.id,
      trigger: "WITHDRAW",
      reason: params.reason,
      requestedById: params.actorId,
      actorName: params.actorName,
      tx: params.tx,
      ...(params.now ? { now: params.now } : {}),
    });
  }

  return { daGo: removed, boQuaHoanTien };
}
