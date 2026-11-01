// lib/auth/action-registry.ts — A0-02: danh mục action hợp lệ (single source).
// Validator (gán RolePermission) + UI dropdown đọc từ đây. Gán action ngoài
// registry → từ chối (AC5). Đồng bộ với matrix tĩnh `PERMISSIONS` (permissions.ts)
// cho tới khi can() v2 (A0-03) đọc hoàn toàn từ DB.
import { ALL_ACTIONS } from "./permissions";

/** Mọi action `<resource>:<verb>` được phép gán cho role. */
export const ACTION_REGISTRY: readonly string[] = ALL_ACTIONS;

const REGISTRY_SET = new Set<string>(ACTION_REGISTRY);

/** True nếu action nằm trong registry. */
export function isValidAction(action: string): boolean {
  return REGISTRY_SET.has(action);
}

/** Lọc/khẳng định danh sách action hợp lệ; trả về action đầu tiên không hợp lệ (nếu có). */
export function firstInvalidAction(actions: string[]): string | null {
  return actions.find((a) => !REGISTRY_SET.has(a)) ?? null;
}
