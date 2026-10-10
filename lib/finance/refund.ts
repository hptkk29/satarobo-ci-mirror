// lib/finance/refund.ts — W3-1 / LMS-9: hoàn tiền theo lifecycle (Doc 15 §4.9).
//
// computeRefund THUẦN (test được không cần DB). createRefundRequest snapshot số liệu
// tại thời điểm tạo (paidConfirmed/sessionsTotal/sessionsLearned/unitPrice) để minh bạch,
// không phụ thuộc thay đổi sau. approve/reject ghi AuditLog hợp nhất.
import type {
  Prisma,
  PrismaClient,
  RefundRequest,
  RefundTrigger,
} from "@prisma/client";
import { db } from "@/lib/db";
import { KHOAN_DA_DONG } from "@/lib/finance/debt";
import { writeAudit } from "@/lib/audit/audit-log";
import { canhBaoSoBuoi, soBuoiChuaChot } from "@/lib/finance/lop-chua-chot-buoi";
import type { ScopedDb } from "@/lib/actions/factory";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * THUẦN — đề xuất hoàn tiền theo lifecycle.
 *   unitPrice  = sessionsTotal>0 ? round(finalPrice / sessionsTotal) : 0  (đơn giá / buổi)
 *   proposed   = max(0, Σ đã đóng (confirmed) − số buổi ĐÃ HỌC × đơn giá)
 * (Công thức plan: Σ confirmed − buổi đã học × đơn giá; clamp ≥ 0.)
 */
export function computeRefund(input: {
  paidConfirmed: number;
  finalPrice: number;
  sessionsTotal: number;
  sessionsLearned: number;
}): { unitPrice: number; proposedAmount: number } {
  const { paidConfirmed, finalPrice, sessionsTotal, sessionsLearned } = input;
  const unitPrice =
    sessionsTotal > 0 ? Math.round(finalPrice / sessionsTotal) : 0;
  const proposedAmount = Math.max(
    0,
    paidConfirmed - sessionsLearned * unitPrice,
  );
  return { unitPrice, proposedAmount };
}

export class RefundError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RefundError";
    this.code = code;
  }
}

/**
 * Ghi danh này đã được QUYẾT TOÁN qua "Dừng học" (PHIÊN D) chưa.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NGUỒN SỰ THẬT DUY NHẤT cho câu hỏi "có được sinh đề xuất hoàn cho ghi danh này không".
 *
 * Dùng ở HAI chỗ, và đó là chủ đích — chép tay điều kiện ở chỗ thứ hai là hai cổng sẵn
 * sàng lệch nhau:
 *   · `withdrawStudentFromAllClasses` hỏi TRƯỚC để **bỏ qua** phần tiền của riêng ghi
 *     danh đó (chủ dự án chốt 21/09: *"không chặn cho bé nghỉ"*);
 *   · `createRefundRequest` hỏi lại làm **lưới cuối** và NÉM — cho mọi đường quên hỏi.
 *
 * Vì sao phải chặn: PHIÊN D quyết toán theo số buổi ĐÃ DÙNG (đếm theo NGÀY, người xác
 * nhận) rồi phân HẾT phần dư. `createRefundRequest` thì tính LẠI bằng số buổi `COMPLETED`
 * — một con số KHÁC cho cùng một khoản tiền. Hai đề xuất chồng nhau trên một ghi danh là
 * đường ngắn nhất tới chi tiền hai lần.
 */
export async function dongDonDaQuyetToan(
  client: DbClient,
  enrollmentId: string,
): Promise<{ id: string; orderCode: string | null } | null> {
  const dong = await client.orderItem.findFirst({
    where: { enrollmentId, status: "STOPPED" },
    select: { id: true, order: { select: { code: true } } },
  });
  return dong ? { id: dong.id, orderCode: dong.order?.code ?? null } : null;
}

/** Câu lỗi dùng chung cho lưới cuối — một chỗ, để nó không nói hai kiểu. */
export function loiDaQuyetToan(dong: { id: string; orderCode: string | null }): RefundError {
  return new RefundError(
    "ALREADY_SETTLED",
    `Ghi danh này đã được quyết toán qua "Dừng học" trên đơn ${dong.orderCode ?? dong.id} — ` +
      `không tạo đề xuất hoàn thứ hai. Phần dư (nếu còn) xử ở màn đơn hàng.`,
  );
}

/**
 * Tạo yêu cầu hoàn tiền (PENDING) cho 1 ghi danh. Snapshot:
 *   - paidConfirmed = Σ amount(Payment accountantStatus=CONFIRMED, chưa xóa) của ghi danh.
 *   - sessionsTotal  = số ClassSession của lớp (loại CANCELLED).
 *   - sessionsLearned = số ClassSession COMPLETED.
 *   - finalPrice = Enrollment.finalPrice (fallback tuition khi chưa chốt giá).
 * IDEMPOTENT: đã có RefundRequest PENDING cùng (enrollment, trigger) → trả cái cũ.
 * Không có khoản đã thu (paidConfirmed ≤ 0) → KHÔNG tạo (trả null) — tránh yêu cầu rỗng.
 * Truyền `tx` để chạy trong transaction của caller (tiền đi qua tx).
 */
export async function createRefundRequest(input: {
  enrollmentId: string;
  trigger: RefundTrigger;
  reason: string;
  requestedById?: string | null;
  actorName?: string;
  tx?: DbClient;
  /**
   * Mốc "hôm nay" để đếm buổi đã qua ngày. Bỏ trống ⇒ đồng hồ thật.
   *
   * Có mặt để test TRUYỀN VÀO được: luật 19 (docs/luat-doc-so-va-ket-luan.md) — ca dựa
   * vào `new Date()` là ca hẹn giờ nổ, và ở đây nó quyết định có chi tiền hoàn hay không.
   */
  now?: Date;
}): Promise<RefundRequest | null> {
  const {
    enrollmentId,
    trigger,
    reason,
    requestedById = null,
    actorName = "Hệ thống",
    tx,
    now,
  } = input;

  // ── CẦU DAO TÍNH NĂNG ĐÃ GỠ (14/09/2026) ───────────────────────────────────
  //
  // Cầu dao `REFUND_REQUEST_DISABLED` tắt HẲN tính năng từ 08/09 vì MỘT ca cụ thể:
  // `sessionsLearned` đếm `ClassSession.status = COMPLETED`, mà `status` không phản ánh
  // thực tế đã dạy (đo prod 07/09: 2 COMPLETED / 287 SCHEDULED, 209 buổi đã qua ngày chưa
  // ai chốt) ⇒ lớp đã dạy gần hết vẫn đọc ra 0 buổi học ⇒ đề xuất hoàn 100% học phí.
  //
  // Nay ca đó bị chặn TẠI GỐC bởi lưới `canhBaoSoBuoi` bên dưới — đúng "điều kiện gỡ số
  // 2" mà chính file cầu dao đã viết ra. Và đề xuất sinh ra vẫn ở `PENDING`: phải qua
  // `approveRefund` mới thành tiền, nên còn một lớp người nữa.
  //
  // ⚠️ Điều kiện 1 và 4 của cầu dao (backlog buổi chưa chốt trên prod về ~0) KHÔNG còn là
  // điều kiện chặn — chốt lại có chủ đích 14/09/2026: backlog nay chỉ làm hệ thống TỪ
  // CHỐI đề xuất (hướng AN TOÀN), không còn đề xuất sai. Cái giá phải nói rõ với người
  // vận hành: lớp còn buổi chưa chốt mà sổ đọc ra 0 buổi học thì KHÔNG hoàn được — phải
  // đi chốt sổ buổi trước.

  const client: DbClient = tx ?? db;

  const enrollment = await client.enrollment.findFirst({
    where: { id: enrollmentId, deletedAt: null },
    select: {
      id: true,
      finalPrice: true,
      tuition: true,
      classId: true,
      class: { select: { centerId: true } },
    },
  });
  if (!enrollment) return null;

  // ── LƯỚI CUỐI CHỐNG HOÀN TIỀN HAI LẦN  [PHIÊN D · 21/09/2026] ──────────────
  //
  // Đường gọi ĐÚNG phải hỏi `dongDonDaQuyetToan` TRƯỚC rồi bỏ qua phần tiền (xem
  // `withdrawStudentFromAllClasses`). Cổng ở đây là lưới CUỐI cho đường nào quên hỏi.
  const dongDaQuyetToan = await dongDonDaQuyetToan(client, enrollmentId);
  if (dongDaQuyetToan) throw loiDaQuyetToan(dongDaQuyetToan);

  // Idempotent: 1 PENDING / (enrollment, trigger).
  const existing = await client.refundRequest.findFirst({
    where: { enrollmentId, trigger, status: "PENDING" },
  });
  if (existing) return existing;

  // Σ Payment đã xác nhận (CONFIRMED) — loại soft-deleted.
  const agg = await client.payment.aggregate({
    // Câu A: hoàn được bao nhiêu thì đo bằng tiền PH ĐANG ĐỂ LẠI, tức đã trừ những
    // lần hoàn trước. Dùng bộ lọc gross ở đây là đề xuất hoàn lần hai trên số gộp.
    where: { enrollmentId, ...KHOAN_DA_DONG },
    _sum: { amount: true },
  });
  const paidConfirmed = agg._sum.amount ?? 0;
  // Chưa thu đồng nào → không cần hoàn (tránh tạo yêu cầu 0đ rác).
  if (paidConfirmed <= 0) return null;

  // Số buổi: tổng (loại huỷ) + đã học (COMPLETED). Tuần tự (an toàn trong tx).
  const sessionsTotal = await client.classSession.count({
    where: { classId: enrollment.classId, status: { not: "CANCELLED" } },
  });
  const sessionsLearned = await client.classSession.count({
    where: { classId: enrollment.classId, status: "COMPLETED" },
  });

  // ── LƯỚI CHẶN ĐỀ XUẤT HOÀN 100% DO SỔ BUỔI CHƯA CHỐT ───────────────────────
  //
  // Đây là ĐIỀU KIỆN GỠ SỐ 2 mà file cầu dao (nay đã xoá) viết nguyên văn:
  // "`createRefundRequest` TỪ CHỐI đề xuất khi lớp có buổi đã qua ngày mà
  //  `sessionsLearned = 0` — ném lỗi rõ ràng, KHÔNG lặng lẽ đề xuất 100%."
  //
  // `sessionsLearned` đếm `status = COMPLETED`, mà `status` không phản ánh thực tế đã dạy
  // (đo prod 07/09: 2 COMPLETED / 287 SCHEDULED, 209 buổi đã qua ngày chưa ai chốt). Với
  // một lớp đã dạy gần hết khoá, con số đó vẫn là 0 ⇒ đề xuất hoàn TOÀN BỘ học phí.
  //
  // ⚠️ TỪ CHỐI, KHÔNG TỰ ĐOÁN: đếm buổi "đã qua ngày" thay cho COMPLETED là chi tiền theo
  // một con số không ai xác nhận — buổi qua ngày chưa chắc đã dạy. Việc đúng là dừng và
  // bắt người chốt sổ buổi. Chi tiết + lý do chỉ chặn ĐÚNG ca này: `lop-chua-chot-buoi.ts`.
  //
  // Trả `null` chứ không ném, cùng lý do với cầu dao ở trên: hàm chạy TRONG transaction gỡ
  // học viên / huỷ lớp, ném là cuộn ngược cả việc gỡ.
  const buoiCuaLop = await client.classSession.findMany({
    where: { classId: enrollment.classId },
    select: { date: true, status: true },
  });
  const canhBao = canhBaoSoBuoi({
    soBuoiChuaChot: soBuoiChuaChot(buoiCuaLop, now ?? new Date()),
    sessionsLearned,
    sessionsTotal,
  });
  if (!canhBao.choDeXuat) {
    await writeAudit({
      actor: { id: requestedById, name: actorName },
      module: "finance",
      entityType: "Enrollment",
      entityId: enrollmentId,
      // Tên hành động RIÊNG, không phải "UPDATE": lượt gỡ học viên cũng ghi UPDATE lên
      // chính `Enrollment` này, nên lọc theo "UPDATE" là trộn hai việc khác hẳn nhau.
      // Giữ đúng tên cầu dao cũ dùng — dòng cũ và dòng mới nói cùng một câu ("một đề
      // xuất hoàn tiền đã bị từ chối"), và chính chúng là câu trả lời cho "có ai thực sự
      // cần hoàn tiền không" khi `RefundRequest` còn 0 dòng.
      action: "REFUND_REQUEST_BLOCKED",
      newValues: {
        tuChoiDeXuatHoanTien: true,
        lyDo: canhBao.lyDo,
        muc: canhBao.muc,
        sessionsLearned,
        sessionsTotal,
        trigger: String(trigger),
      },
      reason: "Từ chối sinh đề xuất hoàn tiền: sổ buổi của lớp chưa chốt",
      orgUnitId: enrollment.class?.centerId ?? null,
      ...(tx ? { tx } : {}),
    });
    return null;
  }

  const finalPrice = enrollment.finalPrice ?? enrollment.tuition ?? 0;
  const { unitPrice, proposedAmount } = computeRefund({
    paidConfirmed,
    finalPrice,
    sessionsTotal,
    sessionsLearned,
  });

  const centerId = enrollment.class?.centerId ?? null;
  const created = await client.refundRequest.create({
    data: {
      enrollmentId,
      centerId,
      trigger,
      reason,
      paidConfirmed,
      sessionsTotal,
      sessionsLearned,
      unitPrice,
      proposedAmount,
      status: "PENDING",
      requestedById,
    },
  });

  await writeAudit({
    actor: { id: requestedById, name: actorName },
    module: "finance",
    entityType: "RefundRequest",
    entityId: created.id,
    action: "CREATE",
    newValues: {
      enrollmentId,
      trigger,
      paidConfirmed,
      sessionsTotal,
      sessionsLearned,
      unitPrice,
      proposedAmount,
      status: "PENDING",
    },
    reason,
    orgUnitId: centerId,
    tx,
  });

  return created;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN D · YÊU CẦU HOÀN SINH TỪ LƯỢT DỪNG HỌC  [21/09/2026]
//
// ⚠️ KHÁC `createRefundRequest` ở trên về BẢN CHẤT, không chỉ về tham số:
//
//   · `createRefundRequest` TỰ TÍNH số tiền (`computeRefund` theo buổi `COMPLETED`) và
//     tự từ chối khi sổ buổi chưa chốt. Nó đoán hộ, nên nó phải thận trọng.
//   · Hàm này KHÔNG tính gì cả. Số tiền đến từ phép quyết toán mà NGƯỜI VẬN HÀNH vừa xác
//     nhận trên màn xem trước (`lib/finance/dung-hoc.ts`), và phần dư đã được phân hết
//     ngay tại đó. Việc của nó là ghi lại đúng con số ấy.
//
// ⚠️ **KHÔNG chi tiền.** Chốt của chủ dự án 21/09: lượt dừng học chỉ ĐẶT một yêu cầu. Đừng
// viết đường ghi thứ hai cho việc chi.
//
// ⚠️ BƯỚC CHI [nối 29/09/2026 — thay khối "HIỆN TRẠNG (đo 28/09/2026)" cũ, khối đó nói bước chi
// CHƯA được nối và tab "Đã chi" luôn rỗng; nay SAI]:
//   · `/admin/hoan-tien` có nút "Đánh dấu đã chi" cho dòng APPROVED → `chiHoanTienAction` →
//     `chiHoanTien` (`lib/finance/chi-hoan-tien.ts`): MỘT transaction, khoá đơn, chuyển
//     `APPROVED → PAID` có điều kiện, ghi dòng `Payment` ÂM (`REFUNDED`, `adjustmentOfId` = khoản
//     nguồn, mang `orderItemId`/`enrollmentId`/`refundRequestId`) rót LIFO trên khoản đã xác nhận.
//   ⇒ Tiền hoàn đã chi VÀO sổ `Payment`: công nợ, số ròng của khoản (hoá đơn điện tử — "Cần điều
//     chỉnh") và thực thu hoa hồng thấy nó.
//   · `refundPaymentAction` (hoàn theo MỘT khoản, không qua `RefundRequest`) vẫn không nút nào gọi —
//     đừng dựng thêm đường chi thứ hai bằng nó.
//
// ⚠️ BA CỘT SNAPSHOT MANG NGHĨA KHÁC ở dòng do hàm này sinh ra, và bảng
// `/admin/hoan-tien` in chúng chung một cột với dòng cũ:
//     `sessionsTotal`   = số buổi **CAM KẾT của khoá** (`Course.totalSessions`),
//                         KHÔNG phải số buổi đã xếp lịch như dòng của `createRefundRequest`;
//     `sessionsLearned` = số buổi **đã dùng theo NGÀY**, không phải số buổi `COMPLETED`;
//     `unitPrice`       = đơn giá đã làm tròn xuống tới 1.000đ.
// Đây là cố ý: thêm ba cột nữa chỉ để phân biệt nguồn là làm bảng kế toán rộng gấp đôi cho
// một khác biệt mà `orderCode` đã nói rồi. Nhưng ai đi CỘNG hai nhóm dòng lại để ra một
// con số thì phải biết điều này trước.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Đặt một yêu cầu hoàn (PENDING) cho phần dư của một dòng đơn vừa dừng học.
 *
 * Gọi BÊN TRONG transaction của lượt dừng học — yêu cầu hoàn và phép quyết toán phải cùng
 * sống cùng chết.
 */
export async function taoYeuCauHoanTuDungHoc(input: {
  tx: Prisma.TransactionClient;
  orderItemId: string;
  /** `null` là HỢP LỆ — dòng đơn chưa gắn ghi danh. Xem model `RefundRequest`. */
  enrollmentId: string | null;
  centerId: string | null;
  trigger: RefundTrigger;
  /** Số tiền hoàn — người vận hành đã chốt ở màn xem trước. */
  soTien: number;
  reason: string;
  /** Σ `Payment` CONFIRMED của dòng đơn, chụp lại để bảng kế toán giải thích được số. */
  paidConfirmed: number;
  soBuoiCamKet: number;
  soBuoiDaDung: number;
  donGiaBuoi: number;
  requestedById: string | null;
  actorName: string;
}): Promise<RefundRequest> {
  const soTien = Math.round(input.soTien);
  if (!Number.isFinite(input.soTien) || soTien <= 0) {
    throw new RefundError("VALIDATION", "Số tiền hoàn phải lớn hơn 0");
  }

  // "Mỗi dòng đơn tối đa 1 RefundRequest PENDING từ dừng học" — chủ dự án chốt 21/09.
  // Cổng `OrderItem.status = STOPPED` ở tầng trên đã chặn lượt dừng thứ hai, nhưng kiểm
  // bằng DỮ LIỆU thay vì tin vào suy luận: cột này rẻ, và nó còn gác cả đường script.
  const dangCho = await input.tx.refundRequest.findFirst({
    where: { orderItemId: input.orderItemId, status: "PENDING" },
    select: { id: true },
  });
  if (dangCho) {
    throw new RefundError(
      "DUPLICATE",
      "Dòng đơn này đã có một yêu cầu hoàn đang chờ kế toán — xử nó trước",
    );
  }

  const created = await input.tx.refundRequest.create({
    data: {
      enrollmentId: input.enrollmentId,
      orderItemId: input.orderItemId,
      centerId: input.centerId,
      trigger: input.trigger,
      reason: input.reason,
      paidConfirmed: Math.round(input.paidConfirmed),
      sessionsTotal: Math.max(0, Math.trunc(input.soBuoiCamKet)),
      sessionsLearned: Math.max(0, Math.trunc(input.soBuoiDaDung)),
      unitPrice: Math.max(0, Math.round(input.donGiaBuoi)),
      proposedAmount: soTien,
      status: "PENDING",
      requestedById: input.requestedById,
    },
  });

  await writeAudit({
    tx: input.tx,
    actor: { id: input.requestedById, name: input.actorName },
    module: "finance",
    entityType: "RefundRequest",
    entityId: created.id,
    action: "CREATE",
    newValues: {
      nguon: "DUNG_HOC",
      orderItemId: input.orderItemId,
      enrollmentId: input.enrollmentId,
      trigger: input.trigger,
      proposedAmount: soTien,
      soBuoiCamKet: input.soBuoiCamKet,
      soBuoiDaDung: input.soBuoiDaDung,
      donGiaBuoi: input.donGiaBuoi,
    },
    reason: input.reason,
    orgUnitId: input.centerId,
  });

  return created;
}

/** Duyệt yêu cầu hoàn tiền → APPROVED. approvedAmount mặc định = proposedAmount. */
export async function approveRefund(
  id: string,
  approvedById: string,
  approvedAmount?: number | null,
  actorName = "Quản lý",
): Promise<RefundRequest> {
  const rr = await db.refundRequest.findUnique({ where: { id } });
  if (!rr)
    throw new RefundError("NOT_FOUND", "Không tìm thấy yêu cầu hoàn tiền");
  if (rr.status !== "PENDING") {
    throw new RefundError(
      "INVALID_STATE",
      `Yêu cầu đang ${rr.status} — không thể duyệt`,
    );
  }
  const finalAmount =
    approvedAmount != null && approvedAmount >= 0
      ? Math.round(approvedAmount)
      : rr.proposedAmount;

  const updated = await db.refundRequest.update({
    where: { id },
    data: {
      status: "APPROVED",
      approvedAmount: finalAmount,
      approvedById,
      approvedAt: new Date(),
    },
  });

  await writeAudit({
    actor: { id: approvedById, name: actorName },
    module: "finance",
    entityType: "RefundRequest",
    entityId: id,
    action: "STATUS_CHANGE",
    oldValues: { status: rr.status, approvedAmount: rr.approvedAmount },
    newValues: { status: "APPROVED", approvedAmount: finalAmount },
    changedFields: ["status", "approvedAmount"],
    reason: rr.reason,
    orgUnitId: rr.centerId,
  });

  return updated;
}

/** Từ chối yêu cầu hoàn tiền → REJECTED (note bắt buộc). */
export async function rejectRefund(
  id: string,
  approvedById: string,
  note: string,
  actorName = "Quản lý",
): Promise<RefundRequest> {
  const trimmed = note.trim();
  if (trimmed.length < 5) {
    throw new RefundError("VALIDATION", "Nhập lý do từ chối (≥5 ký tự)");
  }
  const rr = await db.refundRequest.findUnique({ where: { id } });
  if (!rr)
    throw new RefundError("NOT_FOUND", "Không tìm thấy yêu cầu hoàn tiền");
  if (rr.status !== "PENDING") {
    throw new RefundError(
      "INVALID_STATE",
      `Yêu cầu đang ${rr.status} — không thể từ chối`,
    );
  }

  const updated = await db.refundRequest.update({
    where: { id },
    data: {
      status: "REJECTED",
      approvedById,
      approvedAt: new Date(),
      note: trimmed,
    },
  });

  await writeAudit({
    actor: { id: approvedById, name: actorName },
    module: "finance",
    entityType: "RefundRequest",
    entityId: id,
    action: "STATUS_CHANGE",
    oldValues: { status: rr.status },
    newValues: { status: "REJECTED", note: trimmed },
    changedFields: ["status", "note"],
    reason: trimmed,
    orgUnitId: rr.centerId,
  });

  return updated;
}

export type RefundRow = {
  id: string;
  /**
   * ⚠️ NULLABLE từ 21/09/2026 (PHIÊN D). Yêu cầu hoàn sinh từ lượt DỪNG HỌC của một dòng
   * đơn chưa gắn ghi danh không có `Enrollment` nào — xem khối chú thích ở
   * `prisma/schema.prisma` model `RefundRequest`.
   */
  enrollmentId: string | null;
  /** PHIÊN D — dòng đơn (một CON) mà khoản hoàn này thuộc về. */
  orderItemId: string | null;
  /** Mã đơn, chỉ có khi khoản hoàn đi đường dòng-đơn. Để kế toán tra được nó ở đâu ra. */
  orderCode: string | null;
  studentName: string | null;
  className: string | null;
  centerId: string | null;
  trigger: RefundTrigger;
  reason: string;
  paidConfirmed: number;
  sessionsTotal: number;
  sessionsLearned: number;
  unitPrice: number;
  proposedAmount: number;
  approvedAmount: number | null;
  status: RefundRequest["status"];
  note: string | null;
  createdAt: Date;
  /** Bước ĐÃ CHI (`chiHoanTien`) — null khi chưa chi. */
  paidAt: Date | null;
  paidByName: string | null;
  paidMethod: string | null;
  /**
   * Cơ sở dùng để LỌC danh sách phương thức chi trong hộp thoại "Đánh dấu đã chi": cơ sở của
   * đơn (nhánh dòng đơn) → cơ sở của lớp (nhánh ghi danh) → snapshot. Chỉ là gợi ý hiển thị —
   * `chiHoanTienAction` kiểm lại trên ĐƠN thật.
   */
  coSoPhuongThuc: string | null;
};

/**
 * Liệt kê yêu cầu hoàn tiền cho admin — cách ly cơ sở qua scopedDb (lọc theo lớp
 * NẰM TRONG scope của actor; RefundRequest không tự-scope nên lái theo Class scoped).
 */
/**
 * Một yêu cầu hoàn có nằm trong tầm nhìn của actor không — CÙNG luật với `listRefundRequests`
 * (ghi danh → lớp trong phạm vi, HOẶC dòng đơn → đơn trong phạm vi). Mọi đường GHI theo id
 * (Duyệt / Từ chối) phải hỏi hàm này: `scopedDb` không che write, và trước 29/09 hai action ấy
 * chỉ hỏi `payments:confirm` ⇒ kế toán CS2 biết id là duyệt được yêu cầu của CS1.
 * Không thấy ⇒ `false` (fail-closed); nơi gọi báo "không tìm thấy", không phân biệt khác cơ sở.
 */
export async function yeuCauHoanTrongPhamVi(scopedDbClient: ScopedDb, id: string): Promise<boolean> {
  const rr = await db.refundRequest.findUnique({
    where: { id },
    select: { enrollment: { select: { classId: true } }, orderItem: { select: { orderId: true } } },
  });
  if (!rr) return false;
  const classId = rr.enrollment?.classId ?? null;
  const orderId = rr.orderItem?.orderId ?? null;
  const [lop, don] = await Promise.all([
    classId ? scopedDbClient.class.findFirst({ where: { id: classId }, select: { id: true } }) : null,
    orderId ? scopedDbClient.order.findFirst({ where: { id: orderId }, select: { id: true } }) : null,
  ]);
  return !!lop || !!don;
}

/**
 * Danh sách yêu cầu hoàn tiền trong tầm nhìn của người đang xem.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ HAI NHÁNH TẦM NHÌN, VÀ NHÁNH THỨ HAI LÀ THỨ GIỮ CHO TIỀN KHÔNG BIẾN MẤT
 *
 * `RefundRequest` nằm trong danh sách **KHÔNG auto-scope** của `lib/db-scope.ts`, lý do ghi
 * nguyên văn ở đó: *"scope qua quan hệ enrollment→class"*. Đúng chừng nào mọi dòng đều có
 * ghi danh — mà từ PHIÊN D (21/09/2026) thì không còn đúng nữa.
 *
 * Bộ lọc quan hệ `enrollment: { classId: { in } }` **không bao giờ khớp** dòng
 * `enrollmentId IS NULL`. Giữ nguyên một nhánh nghĩa là: lượt dừng học sinh ra một yêu cầu
 * hoàn đúng số tiền, ghi vào DB thành công, **và kế toán không bao giờ nhìn thấy nó**. Không
 * lỗi nào báo, không ca test nào đỏ — đúng kiểu chết câm mà chủ dự án cấm
 * (*"không được im lặng mất dấu"*).
 *
 * Nhánh hai đi qua `orderItem.order.centerId`. Dùng `Order` chứ không dùng
 * `RefundRequest.centerId` trần vì `centerId` ở đây là **snapshot nullable** (HO tạo đơn thì
 * null), mà `centerId IN (...)` trần sẽ ẩn mất đúng nhóm đó — cùng cái bẫy đã viết trong
 * `db-scope.ts` cho `LeadTarget`/`AdsBudgetTarget`.
 */
export async function listRefundRequests(
  scopedDbClient: ScopedDb,
  filter?: { status?: RefundRequest["status"] },
): Promise<RefundRow[]> {
  // Class là SCOPED_MODEL → findMany tự inject centerId của actor.
  const scopedClasses = await scopedDbClient.class.findMany({
    select: { id: true },
  });
  const classIds = scopedClasses.map((c) => c.id);

  // Đơn trong tầm nhìn — `Order` cũng là SCOPED_MODEL, nên cùng một phép inject.
  const scopedOrders = await scopedDbClient.order.findMany({ select: { id: true } });
  const orderIds = scopedOrders.map((o) => o.id);

  if (classIds.length === 0 && orderIds.length === 0) return [];

  const rows = await db.refundRequest.findMany({
    where: {
      ...(filter?.status ? { status: filter.status } : {}),
      OR: [
        ...(classIds.length > 0 ? [{ enrollment: { classId: { in: classIds } } }] : []),
        ...(orderIds.length > 0 ? [{ orderItem: { orderId: { in: orderIds } } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      enrollmentId: true,
      orderItemId: true,
      centerId: true,
      trigger: true,
      reason: true,
      paidConfirmed: true,
      sessionsTotal: true,
      sessionsLearned: true,
      unitPrice: true,
      proposedAmount: true,
      approvedAmount: true,
      status: true,
      note: true,
      createdAt: true,
      paidAt: true,
      paidById: true,
      paidMethod: true,
      enrollment: {
        select: {
          student: { select: { name: true } },
          class: { select: { name: true, centerId: true } },
        },
      },
      // Dòng đơn là đầu mối DỰ PHÒNG khi không có ghi danh: `itemName` chính là tên bé mà
      // sale gõ lúc bán, và mã đơn cho kế toán chỗ để tra ngược.
      orderItem: {
        select: {
          itemName: true,
          order: { select: { code: true, centerId: true } },
        },
      },
    },
  });

  // `paidById` là cột trần (không quan hệ) — tra tên một lượt.
  const nguoiChiIds = [...new Set(rows.map((r) => r.paidById).filter((x): x is string => !!x))];
  const nguoiChi =
    nguoiChiIds.length === 0
      ? new Map<string, string | null>()
      : new Map(
          (
            await db.user.findMany({
              where: { id: { in: nguoiChiIds } },
              select: { id: true, name: true, email: true },
            })
          ).map((u) => [u.id, u.name ?? u.email ?? null]),
        );

  return rows.map((r) => ({
    id: r.id,
    enrollmentId: r.enrollmentId,
    orderItemId: r.orderItemId,
    orderCode: r.orderItem?.order?.code ?? null,
    // Ưu tiên tên học viên THẬT; rơi về tên trên dòng đơn khi chưa có ghi danh.
    studentName: r.enrollment?.student?.name ?? r.orderItem?.itemName ?? null,
    className: r.enrollment?.class?.name ?? null,
    centerId: r.centerId,
    trigger: r.trigger,
    reason: r.reason,
    paidConfirmed: r.paidConfirmed,
    sessionsTotal: r.sessionsTotal,
    sessionsLearned: r.sessionsLearned,
    unitPrice: r.unitPrice,
    proposedAmount: r.proposedAmount,
    approvedAmount: r.approvedAmount,
    status: r.status,
    note: r.note,
    createdAt: r.createdAt,
    paidAt: r.paidAt,
    paidByName: r.paidById ? (nguoiChi.get(r.paidById) ?? null) : null,
    paidMethod: r.paidMethod,
    coSoPhuongThuc: r.orderItem?.order?.centerId ?? r.enrollment?.class?.centerId ?? r.centerId,
  }));
}
