// lib/crm/commission-statement.ts — R1-10 persistence: lưu bảng hoa hồng theo kỳ (tiền).
// DRAFT→APPROVED (khóa) →REOPENED (chỉ SUPER_ADMIN, C10.6). "Của tôi" = C10.7.
import type { CommissionLine, CommissionStatement } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { TRIAL_TEACHER_TIER } from "@/lib/crm/trial-teacher-commission";
import { chanMoLaiKyCu, chanThangThuocSoMoi } from "@/lib/crm/commission-cutover-gate";
import { CommissionStmtError } from "@/lib/crm/commission-stmt-error";
import type { CommissionLine as ComputedLine } from "@/lib/crm/commission";

// `CommissionStmtError` dời sang `commission-stmt-error.ts` (cổng cutover cần ném cùng lớp lỗi); re-export để import cũ vẫn chạy.
export { CommissionStmtError };

/**
 * Ghi/đè dòng hoa hồng cho 1 kỳ. APPROVED → khóa (C10.6).
 *
 * ⚠️ ĐÂY LÀ CHỖ CHỐNG GHI TRÙNG CỦA 4 TẦNG SALE — không phải khoá unique.
 * `@@unique([statementId, tier, recipientId, enrollmentId])` KHÔNG che đường này: dòng
 * 4 tầng Sale để `enrollmentId = NULL`, mà NULL không bằng NULL trong UNIQUE của
 * Postgres ⇒ `createMany` chạy 10 lần thì có 10 bộ dòng. Thứ giữ cho "chốt lại kỳ"
 * không cộng đôi là cặp `deleteMany` + `createMany` NẰM TRONG CÙNG MỘT transaction ở
 * dưới. Đừng tách hai lệnh đó ra, và đừng đổi sang `createMany` đơn lẻ.
 */
export async function setStatementLines(
  actor: AuditActor,
  input: {
    period: string;
    lines: (ComputedLine & { leadId?: string | null; note?: string | null })[];
    reason?: string;
    /**
     * MANIFEST chủ sở hữu bút toán (04 §3.1, PR0m): TOÀN BỘ `paymentId` mà lần chốt này đã NẠP (không cắt 20 id như `note`) + lúc BẮT ĐẦU đọc.
     * Chỉ thêm dữ liệu audit, KHÔNG đổi số tiền. Manifest của kỳ = manifest của lần chốt CUỐI trước `approvedAt`.
     */
    manifest?: { paymentIds: readonly string[]; napLuc: Date };
  },
): Promise<CommissionStatement> {
  // Cổng cutover (CUT-3): kỳ đã thuộc sổ mới thì đường cũ không dựng bảng kê — TRƯỚC mọi phép đọc/ghi.
  await chanThangThuocSoMoi(db, input.period, "chốt");
  const existing = await db.commissionStatement.findUnique({ where: { period: input.period } });
  if (existing && existing.status === "APPROVED") {
    throw new CommissionStmtError("STATEMENT_LOCKED", "Bảng hoa hồng đã APPROVED — cần REOPEN (SUPER_ADMIN).");
  }
  const stmt =
    existing ??
    (await db.commissionStatement.create({ data: { period: input.period } }));

  // Dòng bảng kê + dòng audit CHỨA MANIFEST phải sống/chết cùng nhau (PR5c): manifest chỉ nằm ở audit "UPDATE" mới nhất, nên audit hỏng sau khi dòng đã
  // commit ⇒ manifest cũ ⇒ khoản có trong bảng kê đã duyệt mà thiếu trong manifest bị engine MỚI trả lần hai. Interactive `$transaction` + `writeAudit({ tx })`.
  await db.$transaction(async (tx) => {
    // 25/08 — CHỈ dọn 4 tầng Sale. Dòng tier=TRIAL_TEACHER được sinh từng cái một
    // trong transaction convert (lib/crm/trial-teacher-commission.ts) chứ không phải
    // tính lại cả kỳ; deleteMany trần sẽ xoá mất hoa hồng GV dạy Trial mỗi lần kế toán
    // dựng lại bảng kê Sale.
    await tx.commissionLine.deleteMany({
      where: { statementId: stmt.id, tier: { not: TRIAL_TEACHER_TIER } },
    });
    await tx.commissionLine.createMany({
      data: input.lines.map((l) => ({
        statementId: stmt.id,
        recipientId: l.recipientId,
        tier: l.tier,
        amount: l.amount,
        isClawback: l.isClawback ?? false,
        leadId: l.leadId ?? null,
        note: l.note ?? null,
      })),
    });
    await writeAudit({
      actor, module: "commission", entityType: "CommissionStatement", entityId: stmt.id,
      action: "UPDATE",
      newValues: {
        lineCount: input.lines.length,
        ...(input.manifest ? { paymentIds: [...input.manifest.paymentIds].sort(), napLuc: input.manifest.napLuc.toISOString() } : {}),
      },
      reason: input.reason,
      tx,
    });
  }, { timeout: 30_000 }); // createMany cả kỳ qua WAN: trần mặc định 5s của Prisma quá chặt cho bảng kê vài nghìn dòng
  return stmt;
}

export async function approveStatement(actor: AuditActor, period: string, reason?: string): Promise<CommissionStatement> {
  await chanThangThuocSoMoi(db, period, "duyệt");
  const stmt = await db.commissionStatement.findUnique({ where: { period } });
  if (!stmt) throw new CommissionStmtError("STATEMENT_NOT_FOUND", "Không tìm thấy bảng hoa hồng.");
  const updated = await db.commissionStatement.update({
    where: { period },
    data: { status: "APPROVED", approvedById: actor.id, approvedAt: new Date() },
  });
  await writeAudit({
    actor, module: "commission", entityType: "CommissionStatement", entityId: stmt.id,
    action: "STATUS_CHANGE", oldValues: { status: stmt.status }, newValues: { status: "APPROVED" }, reason,
  });
  return updated;
}

/** C10.6 — mở lại bảng đã APPROVED: CHỈ SUPER_ADMIN + audit. */
export async function reopenStatement(
  actor: AuditActor & { isSuperAdmin: boolean },
  period: string,
  reason?: string,
): Promise<CommissionStatement> {
  if (!actor.isSuperAdmin) {
    throw new CommissionStmtError("FORBIDDEN", "Chỉ SUPER_ADMIN được mở lại bảng hoa hồng.");
  }
  await chanMoLaiKyCu(db, period);
  const stmt = await db.commissionStatement.findUnique({ where: { period } });
  if (!stmt) throw new CommissionStmtError("STATEMENT_NOT_FOUND", "Không tìm thấy bảng hoa hồng.");
  if (stmt.status !== "APPROVED") {
    throw new CommissionStmtError("NOT_APPROVED", "Chỉ mở lại bảng đang APPROVED.");
  }
  const updated = await db.commissionStatement.update({ where: { period }, data: { status: "REOPENED" } });
  await writeAudit({
    actor, module: "commission", entityType: "CommissionStatement", entityId: stmt.id,
    action: "STATUS_CHANGE", oldValues: { status: "APPROVED" }, newValues: { status: "REOPENED" }, reason,
  });
  return updated;
}

/** C10.7 — "Hoa hồng của tôi": chỉ dòng của chính user. */
export async function getMyCommissionLines(userId: string, period?: string): Promise<CommissionLine[]> {
  return db.commissionLine.findMany({
    where: {
      recipientId: userId,
      ...(period ? { statement: { period } } : {}),
    },
    orderBy: { tier: "asc" },
  });
}
