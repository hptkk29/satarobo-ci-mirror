// lib/auth/permission-decision.ts — US-02 (Nền Hệ thống P0): lõi quyết định quyền
// dùng chung cho checkPermission/checkAnyPermission, TÁCH KHỎI check-permission.ts
// có chủ đích: file này KHÔNG import `@/lib/auth` (next-auth) nên test integration
// Playwright (node thuần) import được trực tiếp — đúng phần logic sau auth().
//
// 1) resolveGrant trên bảng PermissionGrant MỚI (nạp sẵn trên Actor). Hit → grant là
//    nguồn sự thật, KHÔNG chạy evaluatePermission/shadow-compare (tránh nhiễu
//    RbacShadowDiff bằng những lệch v1/v2 mà grant đã đè).
// 2) Miss → đường cũ NGUYÊN VẸN: evaluatePermission + persist shadow-diff khi v1≠v2
//    (luật cứng #2 — không đổi hành vi đường cũ trước P4).
import type { Actor, Target } from "@/lib/auth/actor";
import { isRbacV2Enabled } from "@/lib/flags";
import { evaluatePermission } from "@/lib/auth/permission-eval";
import type { CanUser } from "@/lib/auth/permissions";
import { recordPermissionShadow } from "@/lib/auth/shadow-report";
import { resolveGrant, getFieldMask } from "@/lib/permissions/can";

function targetKey(target?: Target): string | null {
  if (!target) return null;
  return target.centerId ?? target.classId ?? target.createdById ?? null;
}

/**
 * Như decidePermissionWithGrant nhưng trả kèm fieldMask. Mask tính VÔ ĐIỀU KIỆN qua
 * getFieldMask — KHÔNG gate theo resolveGrant().hit: khi grant CHỈ có DENY cấp trường
 * thì hit=false (mask không quyết action) nhưng trường VẪN phải che, kể cả khi ALLOW
 * đến từ đường cũ (review 09/08 — đúng kịch bản TS-02 "thấy danh sách, mất phone").
 */
export function decidePermissionDetailWithGrant(params: {
  sessionUser: CanUser;
  actor: Actor;
  action: string;
  target?: Target;
}): { allowed: boolean; fieldMask: string[] } {
  return {
    allowed: decidePermissionWithGrant(params),
    fieldMask: getFieldMask(params.actor, params.action, params.target),
  };
}

export function decidePermissionWithGrant(params: {
  sessionUser: CanUser;
  actor: Actor;
  action: string;
  target?: Target;
}): boolean {
  const { actor, action, target } = params;
  const decision = resolveGrant(actor, action, target);
  if (decision.hit) return decision.allowed;
  return evaluatePermission({
    sessionUser: params.sessionUser,
    actor,
    action,
    target,
    flagOn: isRbacV2Enabled(),
    onEvaluated: ({ v1, v2 }) => {
      if (v1 !== v2) {
        void recordPermissionShadow({ action, userId: actor.userId, v1, v2, targetKey: targetKey(target) });
      }
    },
  });
}
