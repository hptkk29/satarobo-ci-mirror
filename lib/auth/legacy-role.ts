/**
 * Đổi tên vai CŨ sang tên hiện hành (Phase T0.1: MANAGER → CENTER_MANAGER,
 * SALES → SALES_CSM).
 *
 * ⚠️ BẮT BUỘC gọi ở MỌI chỗ đọc `User.role` / `User.roles` THẲNG TỪ DB. Trước đây phép
 * đổi tên này chỉ nằm trong JWT callback (`lib/auth.ts`), nên code nào bỏ qua JWT mà đọc
 * cột thô sẽ thấy "MANAGER" và `hasRole(u, "CENTER_MANAGER")` trả false — quản lý cơ sở
 * còn dữ liệu cũ sẽ mất quyền một cách im lặng.
 *
 * Hàm thuần, không phụ thuộc next-auth, để mọi tầng import được.
 */
const LEGACY_ROLE_MAP: Record<string, string> = {
  MANAGER: "CENTER_MANAGER",
  SALES: "SALES_CSM",
};

export function migrateLegacyRole(role: string): string {
  return LEGACY_ROLE_MAP[role] ?? role;
}

export function migrateLegacyRoles(roles: readonly string[]): string[] {
  return roles.map(migrateLegacyRole);
}
