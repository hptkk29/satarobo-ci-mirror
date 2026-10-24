// B-01 — phạm vi ĐƯỢC PHÉP đặt mục tiêu doanh thu. Phần THUẦN: không `server-only`,
// không Prisma, để Vitest chạy được mà không cần DB (cùng khuôn `lib/reports/scope-filters.ts`).
//
// Vì sao tách khỏi `_actions.ts`: quyền `revenue_targets:manage` chỉ trả lời "vai này
// được đặt mục tiêu", KHÔNG trả lời "đặt cho CƠ SỞ NÀO" — `RevenueTarget` nằm trong
// `SCOPE_EXEMPT` (`lib/db-scope.ts`) nên `scopedDb` là pass-through, không chặn giúp.
// Cách ly cơ sở ở đây phải làm TAY, và thứ làm tay thì phải có test canh — để nguyên
// trong Server Action là để nó chạy không ai kiểm.
//
// Dùng lại được cho các bảng chỉ tiêu song sinh sắp tới (`LeadTarget` C-01,
// `AdsBudgetTarget` D-02) — cả hai đã được chốt là "gate scope theo đúng tiền lệ
// setRevenueTargetAction" (quyết định 24/08/2026).

/** Phần Actor mà luật phạm vi cần — khai theo cấu trúc để module này không kéo `lib/db` vào. */
export type RevenueTargetScopeActor = {
  isSuperAdmin: boolean;
  isHoLevel: boolean;
  visibleCenterIds: string[];
};

export type RevenueTargetScopeVerdict = { ok: true } | { ok: false; error: string };

export const ERR_GLOBAL_TARGET_HO_ONLY =
  "Chỉ cấp hội sở mới đặt được mục tiêu toàn hệ thống";
export const ERR_CENTER_OUT_OF_SCOPE = "Cơ sở ngoài phạm vi quản lý của bạn";

/**
 * `centerId = null` nghĩa là MỤC TIÊU TOÀN HỆ THỐNG (không phải "chưa gán cơ sở") —
 * chỉ cấp hội sở/quản trị đặt được. `centerId` cụ thể: người không phải cấp hội sở chỉ
 * đặt được cho cơ sở nằm trong tầm nhìn của mình (QLCS giữ N cơ sở, không bắt buộc
 * cùng vùng — câu A-01 chốt 24/08/2026).
 *
 * FAIL-CLOSED: actor chưa được gán cơ sở nào (`visibleCenterIds` rỗng) thì mọi lối đều
 * chặn, không có nhánh nào rơi về "cho hết".
 */
export function checkRevenueTargetScope(
  actor: RevenueTargetScopeActor,
  centerId: string | null,
): RevenueTargetScopeVerdict {
  const isGlobalAllowed = actor.isSuperAdmin || actor.isHoLevel;
  if (centerId === null) {
    return isGlobalAllowed ? { ok: true } : { ok: false, error: ERR_GLOBAL_TARGET_HO_ONLY };
  }
  if (isGlobalAllowed) return { ok: true };
  return actor.visibleCenterIds.includes(centerId)
    ? { ok: true }
    : { ok: false, error: ERR_CENTER_OUT_OF_SCOPE };
}
