// #13 (câu 11 BGĐ) — "Chuyển vai trò" cho người kiêm nhiều vai (Toại: QL cơ sở + GV +
// Đào tạo; Kiệt: SUPER_ADMIN + GV).
//
// ⚠️ ĐÂY LÀ TIỆN ÍCH GIAO DIỆN, KHÔNG PHẢI CƠ CHẾ BẢO MẬT.
// Quyền KHÔNG đổi: `resolveActor` vẫn union mọi UserOrgRole, `can()`/`checkPermission()`
// vẫn xét toàn bộ vai trò. Chuyển vai chỉ lọc MENU + panel dashboard mặc định, để người
// kiêm nhiều vai không phải bơi trong menu của cả 3 vai cùng lúc.
//
// Muốn thu hẹp quyền thật theo vai đang chọn (least-privilege) thì phải nhét `activeRole`
// vào JWT + lọc trong `resolveActor` (đang React.cache theo userId → phải đổi cache key)
// + đổi `scopedDb` theo vai. Việc đó ĐỔI HÀNH VI v2 ⇒ reset đồng hồ shadow và làm flip #09
// mang thêm rủi ro. Đã chốt 09/07: giai đoạn này chỉ đổi giao diện.
import type { Role } from "@prisma/client";
import { getEffectiveRoles } from "@/lib/auth/permissions";

export const ACTIVE_ROLE_COOKIE = "sr_active_role";

/**
 * Vai trò đang dùng, ĐÃ kiểm chứng nằm trong danh sách vai trò user thực sự giữ.
 * Cookie do client set → không tin; giá trị lạ/không sở hữu → trả null (dùng union).
 */
export function resolveActiveRole(
  user: { role?: Role | string | null; roles?: (Role | string)[] | null },
  cookieValue: string | undefined | null,
): Role | null {
  if (!cookieValue) return null;
  const owned = getEffectiveRoles(user);
  return owned.find((r) => r === cookieValue) ?? null;
}

/**
 * `user` dùng để lọc menu: nếu đang chọn 1 vai thì chỉ xét vai đó. Grant riêng
 * (`UserPermissionGrant` ALLOW) GIỮ NGUYÊN — nó gắn với con người, không gắn với vai.
 */
export function menuUserForRole<T extends { role?: Role | string | null; roles?: (Role | string)[] | null }>(
  user: T,
  activeRole: Role | string | null,
): T {
  if (!activeRole) return user;
  return { ...user, role: activeRole, roles: [activeRole] };
}

// ─── Sau khi sidebar đọc quyền theo cờ (10/07) ────────────────────────────────
//
// Switcher KHÔNG thể tiếp tục chạy trên mã vai legacy khi cờ bật. Hai bộ mã chỉ trùng
// nhau 5/9: `SUPER_ADMIN · CENTER_MANAGER · TEACHER · TRAINING · PARENT`.
// Legacy `HR / SALES_CSM / MARKETING / ACCOUNTANT` không có RoleDef cùng tên; ngược lại
// v2 có `CENTER_CLASS_MANAGER · ASSISTANT_TEACHER · HO_SALE · HO_*` không có mã legacy.
//
// Nếu để switcher chọn "SALES_CSM" trong khi menu đọc v2, Mỹ (Sale + Giáo vụ) sẽ mất
// sạch menu Giáo vụ — đúng lớp lỗi "menu nói dối" mà page-gates vừa diệt. Nên: cờ OFF →
// chọn theo vai legacy; cờ ON → chọn theo RoleDef code.

/** Danh sách vai user được phép chọn trong RoleSwitcher, theo hệ quyền đang hiệu lực. */
export function activeRoleOptions(
  user: { role?: Role | string | null; roles?: (Role | string)[] | null },
  actor: { orgRoles: { roleCode: string }[] } | null,
  flagOn: boolean,
): string[] {
  if (!flagOn) return getEffectiveRoles(user);
  return [...new Set(actor?.orgRoles.map((r) => r.roleCode) ?? [])].sort();
}

/** Cookie do client set → chỉ nhận giá trị nằm trong danh sách user THỰC SỰ giữ. */
export function resolveActiveRoleFrom(
  owned: readonly string[],
  cookieValue: string | undefined | null,
): string | null {
  if (!cookieValue) return null;
  return owned.find((r) => r === cookieValue) ?? null;
}

type MenuActor = {
  isSuperAdmin: boolean;
  orgRoles: { orgUnitId: string; roleCode: string }[];
  permissions: { roleCode: string }[];
};

/**
 * `actor` dùng để lọc menu ở nhánh v2: chỉ giữ quyền đến từ vai đang chọn.
 *
 * - `isSuperAdmin` phải hạ theo, nếu không `canV2` bypass hết và chọn vai thành vô nghĩa
 *   (Kiệt = SUPER_ADMIN + GV: chọn "Giáo viên" mà vẫn thấy menu quản trị).
 * - `grantsAllow` GIỮ NGUYÊN — grant riêng gắn với con người, không gắn với vai
 *   (đồng bộ với `menuUserForRole`, vốn giữ `grants`).
 * - Mã vai không có trong `orgRoles` (vd vai legacy khi cờ OFF) → KHÔNG thu hẹp, trả
 *   nguyên actor. Fail-open có chủ đích: đây là menu, không phải cổng.
 *
 * ⚠️ CHỈ dùng cho menu/dashboard. Đưa actor này vào `checkPermission`/`scopedDb` là đổi
 * hành vi quyền thật → xem cảnh báo đầu file.
 */
export function menuActorForRole<T extends MenuActor>(actor: T | null, activeRole: string | null): T | null {
  if (!actor || !activeRole) return actor;
  if (!actor.orgRoles.some((r) => r.roleCode === activeRole)) return actor;
  return {
    ...actor,
    isSuperAdmin: activeRole === "SUPER_ADMIN",
    orgRoles: actor.orgRoles.filter((r) => r.roleCode === activeRole),
    permissions: actor.permissions.filter((p) => p.roleCode === activeRole),
  };
}
