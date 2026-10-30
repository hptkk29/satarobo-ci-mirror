// lib/parttime/dieu-chinh-rut.ts — RÚT các khoản trừ ĐANG ĐỀ XUẤT của những đơn vị công việc vừa bị VOID / thành CŨ. Chạy TRONG
// giao dịch của chính phép VOID / đánh dấu cũ, để không bao giờ có khoản đề xuất treo trên một sự thật đã đổi.
//
// Tách file riêng (không để trong `dieu-chinh-db.ts`) vì `workunit-db.ts` phải gọi nó, mà `dieu-chinh-db.ts` lại đọc
// `workunit-db.ts` — gộp lại là vòng import. Khoản ĐÃ XÁC NHẬN không bao giờ bị rút ở đây (đó là quyết định của QLCS — vẫn hiện
// trong báo cáo, gắn theo phân công).
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";

export async function rutDeXuatCuaDonVi(
  tx: Prisma.TransactionClient,
  p: { workUnitIds: readonly string[]; lyDo: string; actor: { id: string | null; name: string }; now: Date },
): Promise<number> {
  if (!p.workUnitIds.length) return 0;
  const ds = await tx.compensationAdjustment.findMany({ where: { workUnitId: { in: [...p.workUnitIds] }, status: "PROPOSED" }, select: { id: true, orgUnitId: true } });
  let n = 0;
  for (const a of ds) {
    const u = await tx.compensationAdjustment.updateMany({ where: { id: a.id, status: "PROPOSED" }, data: { status: "CANCELLED", decidedAt: p.now, decisionReason: p.lyDo } });
    if (u.count === 0) continue;
    n++;
    await writeAudit({ actor: p.actor, module: "hr_attendance", entityType: "CompensationAdjustment", entityId: a.id, action: "PT_ADJUSTMENT_WITHDRAWN", oldValues: { status: "PROPOSED" }, newValues: { status: "CANCELLED" }, reason: p.lyDo, orgUnitId: a.orgUnitId, tx });
  }
  return n;
}
