// lib/transfer/transfer-policy.ts — R6-E2: chính sách duyệt chuyển lớp.
// - canApproveTransfer: SUPER/HO duyệt mọi nơi; CM chỉ duyệt khi THẤY cả 2 cơ sở
//   (nguồn + đích) trong scope — chuyển chéo cơ sở cần quyền trên cả hai (cách ly).
// - assertSameFee: lớp đích cùng KHOÁ ⇒ cùng mức phí (chuyển giữa kỳ không đổi phí).
import type { Actor } from "@/lib/auth/actor";

/** THUẦN — actor có quyền duyệt yêu cầu chuyển giữa from/to center. */
export function canApproveTransfer(
  actor: Pick<Actor, "isSuperAdmin" | "isHoLevel" | "visibleCenterIds">,
  params: { fromCenterId?: string | null; toCenterId?: string | null },
): boolean {
  if (actor.isSuperAdmin || actor.isHoLevel) return true;
  const visible = new Set(actor.visibleCenterIds);
  const okFrom = !params.fromCenterId || visible.has(params.fromCenterId);
  const okTo = !params.toCenterId || visible.has(params.toCenterId);
  return okFrom && okTo;
}

/** THUẦN — "cùng mức phí": chuyển trong cùng khoá. Khác khoá → đổi phí → chặn. */
export function isSameFeeTransfer(fromCourseId: string, toCourseId: string): boolean {
  return fromCourseId === toCourseId;
}
