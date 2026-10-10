// lib/auth/permission-eval.ts — A0-03: lõi quyết định quyền THUẦN (v1 matrix ↔ v2
// actor + shadow). KHÔNG import @/lib/auth (NextAuth) → test được trong vitest.
import type { Actor, Target } from "@/lib/auth/actor";
import { can as canV2 } from "@/lib/auth/can";
import { can as canMatrix, type Action, type CanUser } from "@/lib/auth/permissions";
import { isValidAction } from "@/lib/auth/action-registry";
import { decidePermission, type ShadowLogger } from "@/lib/auth/shadow-compare";

/**
 * Quyết định quyền từ (sessionUser cho v1, actor cho v2) + log lệch theo flag.
 * v1 chỉ tính khi action ∈ registry (Action union); ngoài registry → v1=false.
 */
export function evaluatePermission(params: {
  sessionUser: CanUser | null;
  actor: Actor | null;
  action: string;
  target?: Target;
  flagOn: boolean;
  logger?: ShadowLogger;
  /** R6-F2 — nhận (v1,v2) đã tính để persist shadow-diff (fire-and-forget ở runtime). */
  onEvaluated?: (r: { v1: boolean; v2: boolean }) => void;
}): boolean {
  const v1 =
    params.sessionUser && isValidAction(params.action)
      ? canMatrix(params.sessionUser, params.action as Action)
      : false;
  const v2 = params.actor ? canV2(params.actor, params.action, params.target) : false;
  params.onEvaluated?.({ v1, v2 });
  return decidePermission({
    action: params.action,
    userId: params.actor?.userId ?? "anon",
    v1,
    v2,
    flagOn: params.flagOn,
    logger: params.logger,
  });
}
