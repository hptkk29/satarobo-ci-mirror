// lib/ai-lead/dich-vu/ho-tro-test-duyet.ts — HỖ TRỢ CHO TEST của lát C: dựng `Actor` literal đúng hình dạng RBAC v2 mà `duyet.ts` đọc. KHÔNG import từ mã chạy thật.
//
// Vì sao tự dựng literal thay vì `buildActor`: ca cần kiểm là «phạm vi cơ sở» — thứ quyết định bởi `centerScope` của từng PermEntry (đúng là thứ `getModelVisibleCenterIds`
// đọc theo prefix `ai-leads:`), và literal cho phép đặt ĐÚNG ba hình: QLCS một cơ sở · vai Hội sở (ALL) · SUPER_ADMIN.
import type { Actor, PermEntry } from "@/lib/auth/actor";

const QUYEN_AI = ["ai-leads:view", "ai-leads:review"] as const;

function pe(action: string, centerScope: PermEntry["centerScope"], roleCode: string): PermEntry {
  // Seed GLOBAL (design §3): scope cơ sở KHÔNG nằm ở `scopeType` mà ở `centerScope` suy từ nơi neo vai.
  return { action, scopeType: "GLOBAL", orgUnitId: "ou-test", roleCode, centerScope };
}

/** QLCS neo tại các cơ sở `centerIds`: thấy + xử lý hồ sơ của đúng các cơ sở đó. */
export function actorQlcs(userId: string, centerIds: string[]): Actor {
  return {
    userId,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: centerIds.map((c) => ({ orgUnitId: `ou-${c}`, roleCode: "CENTER_MANAGER" })),
    permissions: QUYEN_AI.map((a) => pe(a, centerIds, "CENTER_MANAGER")),
    visibleCenterIds: centerIds,
    visibleOrgUnitIds: centerIds.map((c) => `ou-${c}`),
    grantsAllow: new Set(),
    assignedClassIds: new Set(),
  };
}

/** Vai Hội sở có `ai-leads:*` toàn hệ thống (centerScope ALL). */
export function actorHoiSo(userId: string, quyen: readonly string[] = QUYEN_AI): Actor {
  return {
    userId,
    isSuperAdmin: false,
    isHoLevel: true,
    orgRoles: [{ orgUnitId: "ou-ho", roleCode: "HO_MARKETING" }],
    permissions: quyen.map((a) => pe(a, "ALL", "HO_MARKETING")),
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set(),
    assignedClassIds: new Set(),
  };
}

export function actorSuperAdmin(userId: string): Actor {
  return { ...actorHoiSo(userId), isSuperAdmin: true };
}

/** Người chỉ có quyền XEM (không `review`) — dùng cho ca «xem được mà không ghi được». */
export function actorChiXem(userId: string, centerIds: string[]): Actor {
  return { ...actorQlcs(userId, centerIds), permissions: [pe("ai-leads:view", centerIds, "CENTER_MANAGER")] };
}
