// lib/auth/check-permission.ts — A0-03: điểm vào RUNTIME thống nhất cho quyền.
// Chạy can() v1 (matrix) + can() v2 (actor) SONG SONG, log lệch (shadow), trả kết
// quả theo cờ RBAC_V2_ENABLED. API mới cho code mới; callsite cũ migrate ở Phase C.
// KHÔNG đổi hành vi prod khi flag OFF (vẫn dùng v1). Lõi thuần ở permission-eval.ts.
//
// US-02 (Nền Hệ thống P0, 09/08/2026): bảng PermissionGrant MỚI cắm vào TRƯỚC đường
// cũ — grant khớp (hit) thì grant là nguồn sự thật; KHÔNG grant khớp → fallback
// NGUYÊN TRẠNG v1/v2/shadow/flag (luật #2). Engine ship với bảng RỖNG = zero change.
import { auth } from "@/lib/auth";
import { resolveActor, type Target } from "@/lib/auth/actor";
import { PermissionError } from "@/lib/auth/can";
import { evaluatePermission } from "@/lib/auth/permission-eval";
import {
  decidePermissionWithGrant,
  decidePermissionDetailWithGrant,
} from "@/lib/auth/permission-decision";

export { evaluatePermission };
// Lõi quyết định (grant mới → fallback đường cũ) nằm ở permission-decision.ts —
// tách file để test integration import được mà không kéo theo next-auth.
export { decidePermissionWithGrant };

/** Runtime: lấy session + resolveActor (1 query/request) → grant mới ưu tiên,
 *  miss → evaluatePermission. R6-F2: persist shadow-diff khi v1≠v2 (fire-and-forget). */
export async function checkPermission(action: string, target?: Target): Promise<boolean> {
  const session = await auth();
  if (!session?.user) return false;
  const actor = await resolveActor(session.user.id);
  return decidePermissionWithGrant({ sessionUser: session.user, actor, action, target });
}

/**
 * US-02 (cho US-03 dùng — chưa có consumer): như checkPermission nhưng trả kèm
 * fieldMask (DENY cấp trường từ grant). Miss grant → fieldMask [] (đường cũ
 * không có khái niệm che trường).
 */
export async function checkPermissionDetail(
  action: string,
  target?: Target,
): Promise<{ allowed: boolean; fieldMask: string[] }> {
  const session = await auth();
  if (!session?.user) return { allowed: false, fieldMask: [] };
  const actor = await resolveActor(session.user.id);
  // Mask VÔ ĐIỀU KIỆN (không gate theo grant hit) — DENY cấp trường đơn độc vẫn che
  // trường dù quyết định action đến từ đường cũ (TS-02).
  return decidePermissionDetailWithGrant({ sessionUser: session.user, actor, action, target });
}

/** Ném PermissionError nếu không đủ quyền (dùng đầu Server Action/route). */
export async function assertPermission(action: string, target?: Target): Promise<void> {
  if (!(await checkPermission(action, target))) throw new PermissionError();
}

/**
 * Vào được nếu có ÍT NHẤT MỘT action trong danh sách (OR). Dùng với `PAGE_GATES`
 * để gate trang, thay chuỗi `!(await checkPermission(a)) && !(await checkPermission(b))`
 * — vốn gọi `auth()` + `resolveActor()` lặp mỗi action.
 *
 * Short-circuit: dừng ở action đầu tiên PASS, nên shadow-diff chỉ ghi cho những action
 * thực sự được đánh giá. Đúng bằng hành vi của chuỗi `||` cũ, không thêm nhiễu.
 */
export async function checkAnyPermission(
  actions: readonly string[],
  target?: Target,
): Promise<boolean> {
  const session = await auth();
  if (!session?.user) return false;
  const actor = await resolveActor(session.user.id);

  for (const action of actions) {
    // US-02: mỗi action đi qua cùng lõi grant-trước-fallback-sau như checkPermission;
    // shadow-diff vẫn chỉ ghi cho action THỰC SỰ rơi xuống đường cũ (miss grant).
    if (decidePermissionWithGrant({ sessionUser: session.user, actor, action, target })) {
      return true;
    }
  }
  return false;
}

/** Bản ném lỗi của checkAnyPermission (đầu Server Action/route). */
export async function assertAnyPermission(
  actions: readonly string[],
  target?: Target,
): Promise<void> {
  if (!(await checkAnyPermission(actions, target))) throw new PermissionError();
}

/**
 * #11 follow-up SAU flip #09 — quyền xem PII lead (Q7), thay bản can() v1 trần cũ ở
 * lib/auth/permissions. Qua checkPermission nên grant per-user (UserPermissionGrant
 * ALLOW) vẫn ăn ở cả v1 lẫn v2; KHÔNG truyền target vì leads:view-pii seed GLOBAL
 * (cách ly cơ sở đã do scopedDb ở tầng query). Đặt ở đây (không phải lib/lead/pii —
 * module thuần) và không phải permissions.ts (permission-eval import ngược → vòng).
 * ⚠️ Chỉ merge SAU flip #09 + seed-prod-roles — merge trước sẽ đẻ lệch shadow.
 */
export async function canViewLeadPii(): Promise<boolean> {
  return checkPermission("leads:view-pii");
}
