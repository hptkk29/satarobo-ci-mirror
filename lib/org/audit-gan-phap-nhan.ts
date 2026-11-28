import type { Prisma } from "@prisma/client";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";

// lib/org/audit-gan-phap-nhan.ts — MỘT chỗ ghi audit cho việc gắn/gỡ/đổi pháp nhân của một đơn vị (Cây tổ chức), dùng chung cho
// đường "Sửa đơn vị" (`updateOrgUnit`) và đường "Đơn vị đang gắn" ở màn quản trị pháp nhân. Tách riêng để `org-service` không phải
// nhập mã tài chính. Ghi TRONG transaction của phép đổi. Chỉ ghi khi pháp nhân thật sự đổi.

export const ACTION_GAN_PHAP_NHAN = "GAN_PHAP_NHAN_CHO_DON_VI";

type PhapNhanTom = { taxCode: string; legalName: string } | null;

export async function ghiAuditGanPhapNhan(
  tx: Prisma.TransactionClient,
  p: {
    nguoi: AuditActor;
    donVi: { id: string; code: string };
    truoc: PhapNhanTom;
    sau: PhapNhanTom;
    lyDo?: string;
  },
): Promise<void> {
  await writeAudit({
    tx,
    actor: p.nguoi,
    module: "org",
    entityType: "OrgUnit",
    entityId: p.donVi.id,
    action: ACTION_GAN_PHAP_NHAN,
    oldValues: { maDonVi: p.donVi.code, phapNhan: p.truoc ? { ...p.truoc } : null },
    newValues: { maDonVi: p.donVi.code, phapNhan: p.sau ? { ...p.sau } : null },
    reason: p.lyDo,
    orgUnitId: p.donVi.id,
  });
}
