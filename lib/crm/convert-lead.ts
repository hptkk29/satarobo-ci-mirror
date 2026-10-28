// lib/crm/convert-lead.ts — R2-02 ⚠️ TRỌNG TÂM: chốt lead → học viên trong 1 TRANSACTION.
// Lead→ENROLLED + Parent(PENDING_ACTIVATION) + Student + Enrollment + Order(invoice) + Audit,
// tất cả atomic (lỗi 1 bước → rollback toàn bộ, C2.2). Event `lead.converted` phát SAU commit
// (C2.3/C2.5 — activation/notify đi qua handler, KHÔNG trong transaction).
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { publishEvent } from "@/lib/events/publish";
import { recordLeadStatusChange } from "@/lib/lead/status-trail-write";
import { nextInvoiceCode } from "@/lib/finance/invoice-code";
import { canonicalPhone, phoneVariants } from "@/lib/phone";
import { syncConversationMembership } from "@/lib/chat/sync-membership";

export class ConvertError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ConvertError";
    this.code = code;
  }
}

/**
 * C5.1 — kiểm tra trùng SĐT trước khi convert: trả lead/student cũ (90 ngày) để UI cảnh báo.
 * Không chặn — chỉ cung cấp dữ liệu để hiển thị (quyết định do người dùng).
 *
 * AUTH-SĐT P1 (gom tồn dư 31/07) — tra bằng `phoneVariants`, KHÔNG so khớp đúng-bằng.
 * Trước đây `phone.replace(/\D/g,"")` giữ nguyên `0905…` rồi so `=` với cột DB. Sau
 * backfill 29/07 prod lưu **canonical `84905…`** ⇒ gõ `0905…` là **không khớp gì cả**,
 * và hàm im lặng trả rỗng — cảnh báo trùng "chạy" mà không bao giờ cảnh báo.
 * `phoneVariants` khớp CẢ hai dạng nên đúng trong lẫn sau giai đoạn chuyển tiếp.
 */
export async function findConvertDuplicates(
  phone: string,
  now: Date = new Date(),
): Promise<{ leads: { id: string; status: string }[]; students: { id: string; name: string }[] }> {
  const variants = phoneVariants(phone);
  if (variants.length === 0) return { leads: [], students: [] };
  const cutoff = new Date(now.getTime() - 90 * 86_400_000);
  const [leads, students] = await Promise.all([
    db.lead.findMany({
      where: { phone: { in: variants }, deletedAt: null, createdAt: { gte: cutoff } },
      select: { id: true, status: true },
    }),
    db.student.findMany({
      where: { parentPhone: { in: variants } },
      select: { id: true, name: true },
    }),
  ]);
  return { leads, students };
}

export type ConvertLeadInput = {
  leadId: string;
  classId: string;
  courseId: string;
  /** AUTH-SĐT P5 — không còn bắt buộc; khoá định danh là SĐT của lead. */
  parentEmail?: string | null;
  childName?: string;
  amount: number;
  paidAmount?: number;
  reason?: string;
  now?: Date;
};

export async function convertLeadToEnrollment(actor: AuditActor, input: ConvertLeadInput) {
  const now = input.now ?? new Date();

  const result = await db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: input.leadId } });
    if (!lead || lead.deletedAt) throw new ConvertError("LEAD_NOT_FOUND", "Không tìm thấy lead.");
    // GĐ5 — CHẶN TRÙNG bám `convertedAt`, KHÔNG bám status nữa. Sau khi gộp ENROLLED
    // vào DA_DANG_KY, một lead mới chỉ "đã đăng ký" (đã ghi nhận tiền, chưa xếp lớp)
    // cũng mang giá trị đó — khoá theo status sẽ chặn đúng cái nó phải cho qua.
    // `convertedAt` chỉ do chính lượt convert ghi nên nó mới là dấu "đã chốt" thật.
    if (lead.convertedAt) throw new ConvertError("ALREADY_ENROLLED", "Lead đã được chốt.");
    if (!lead.centerId) throw new ConvertError("LEAD_NO_CENTER", "Lead chưa thuộc cơ sở nào — bàn giao trước.");

    // R6-G2 — CLAIM atomic chống race: 2 convert song song chỉ 1 bộ.
    // GĐ5 — bám `convertedAt IS NULL` thay vì bám status, cùng lý do như bản v2:
    // sau khi gộp ENROLLED + REGISTERED thì khoá theo status sẽ chặn nhầm lead mới
    // chỉ "đã đăng ký". Xem ghi chú đầy đủ ở lib/crm/convert-lead-v2.ts.
    const claim = await tx.lead.updateMany({
      where: { id: lead.id, convertedAt: null, deletedAt: null },
      data: { status: "DA_DANG_KY", convertedById: actor.id, convertedAt: now },
    });
    if (claim.count === 0) throw new ConvertError("ALREADY_ENROLLED", "Lead đã được chốt.");

    const center = await tx.center.findUnique({ where: { id: lead.centerId }, select: { code: true } });
    const centerCode = center?.code ?? "CS";

    // Parent: KHÔNG mật khẩu mặc định (C4.1) — PENDING_ACTIVATION.
    //
    // AUTH-SĐT P5 — khoá định danh là SĐT canonical; email tuỳ chọn. Khoá theo
    // email như trước sẽ ném lỗi runtime ngay khi `parentEmail` null
    // (`where: { email: undefined }` không trả null, nó throw).
    const parentEmail = input.parentEmail?.trim().toLowerCase() || null;
    const parentPhone = canonicalPhone(lead.phone);
    if (!parentPhone && !parentEmail) {
      throw new ConvertError(
        "NO_PARENT_IDENTITY",
        "Lead không có SĐT di động hợp lệ lẫn email — không tạo được tài khoản phụ huynh.",
      );
    }
    const parent = parentPhone
      ? await tx.user.upsert({
          where: { phone: parentPhone },
          update: { centerId: lead.centerId },
          create: {
            phone: parentPhone,
            email: parentEmail,
            name: lead.parentName,
            role: "PARENT",
            roles: ["PARENT"],
            accountStatus: "PENDING_ACTIVATION",
            centerId: lead.centerId,
          },
        })
      : await tx.user.upsert({
          where: { email: parentEmail! },
          update: { centerId: lead.centerId },
          create: {
            email: parentEmail,
            name: lead.parentName,
            role: "PARENT",
            roles: ["PARENT"],
            accountStatus: "PENDING_ACTIVATION",
            centerId: lead.centerId,
          },
        });

    const student = await tx.student.create({
      data: {
        name: input.childName ?? lead.childName ?? lead.parentName,
        parentUserId: parent.id,
        centerId: lead.centerId,
        parentName: lead.parentName,
        // Đường GHI phải ra canonical — xem ghi chú cùng nội dung ở convert-lead-v2.
        parentPhone: parentPhone ?? lead.phone,
        parentEmail,
      },
    });

    const enrollment = await tx.enrollment.create({
      data: {
        studentId: student.id,
        classId: input.classId,
        courseId: input.courseId,
        centerId: lead.centerId,
        saleId: lead.assignedToId ?? null, // T3.2 — sale phụ trách theo sang ghi danh
      },
    });

    const paid = (input.paidAmount ?? 0) > 0;
    const order = await tx.order.create({
      data: {
        code: await nextInvoiceCode(tx, centerCode, now.getUTCFullYear()),
        type: "COURSE",
        customerName: lead.parentName,
        customerPhone: lead.phone,
        centerId: lead.centerId,
        // Người tạo đơn = người bấm chốt lead (cột danh sách /admin/orders).
        createdById: actor.id ?? null,
        subtotal: input.amount,
        totalAmount: input.amount,
        status: paid ? "CONFIRMED" : "PENDING_PAYMENT",
        paidAt: paid ? now : null,
      },
    });

    // (status=ENROLLED + convertedBy/At đã set ở bước CLAIM atomic phía trên — G2.)

    await writeAudit({
      actor, module: "enrollment", entityType: "Lead", entityId: lead.id, action: "STATUS_CHANGE",
      oldValues: { status: lead.status },
      newValues: { status: "ENROLLED", studentId: student.id, orderCode: order.code },
      reason: input.reason, orgUnitId: lead.centerId, tx,
    });
    // C-07 — dòng audit trên đã có, nhưng lượt chốt KHÔNG để lại mốc nào trên
    // DÒNG THỜI GIAN của lead: Sale mở hồ sơ thấy phễu dừng ở bước trước rồi im.
    // `auditAlreadyWritten` để không đẻ dòng nhật ký thứ hai cho cùng sự việc
    // (dòng trên thuộc module `enrollment` và mang mã đơn/mã học viên).
    await recordLeadStatusChange({
      tx, leadId: lead.id, actorId: actor.id, actorName: actor.name,
      from: lead.status, to: "ENROLLED", source: "CONVERT", reason: input.reason,
      auditAlreadyWritten: true,
    });

    // US-03 chat — HV vào lớp (enrollment mặc định ACTIVE) → PH vào nhóm lớp, cùng tx.
    await syncConversationMembership(tx, input.classId);

    return { lead, parent, student, enrollment, order };
  }, { timeout: 30_000, maxWait: 10_000 });

  // SAU commit: side-effect không-atomic (activation email, stats...) qua DomainEvent (C2.5).
  await publishEvent("lead.converted", {
    leadId: result.lead.id,
    studentId: result.student.id,
    parentUserId: result.parent.id,
    orderCode: result.order.code,
  });

  return result;
}
