// lib/auth/menu-gon.ts — "Menu gọn theo vai" (28/09/2026, chủ dự án chọn: CHỈ ẩn khỏi menu).
//
// Kế toán mở admin thấy cả Học viên, Lớp học, Lịch tổng, Tra cứu… vì vai giữ quyền XEM các
// thứ đó (có chủ đích — công nợ, hoá đơn, phiếu thu đọc học viên/ghi danh/lớp). Gỡ quyền
// thì mất lối xem khi cần; nên thay vào đó mỗi vai khai danh sách mục menu ẨN
// (`RoleDef.anMenu`, nguồn `prisma/seed-roles.ts`, sửa được ở màn Vai trò & quyền).
//
// ⚠️ ĐÂY LÀ TIỆN ÍCH GIAO DIỆN, KHÔNG PHẢI QUYỀN (cùng họ `lib/auth/active-role.ts`).
// Trang vẫn mở được bằng link; `can()`/`checkPermission()`/`scopedDb` không đọc gì ở đây.
// Muốn CHẶN thật thì gỡ quyền trong seed vai, đừng thêm vào danh sách này.
//
// Luật người giữ nhiều vai: mục chỉ ẩn khi MỌI vai đang dùng đều ẩn nó (giao các danh sách).
// Sai thì nghiêng về hiện thừa — Kế toán kiêm Sale vẫn thấy Tra cứu vì vai Sale không ẩn.

/** Mã vai đang dùng để gọn menu. Chỉ bộ mã RoleDef (RBAC v2): cờ TẮT ⇒ không gọn. */
export function vaiDangDungChoMenu(
  actor: { isSuperAdmin: boolean; orgRoles: readonly { roleCode: string }[] } | null,
  rbacV2: boolean,
): string[] {
  // v1 dùng mã vai legacy (ACCOUNTANT…) không trùng mã RoleDef ⇒ không có dữ liệu để gọn.
  if (!rbacV2 || !actor || actor.isSuperAdmin) return [];
  return [...new Set(actor.orgRoles.map((r) => r.roleCode))].sort();
}

/** Đường dẫn mục menu ẩn với người đang xem = GIAO danh sách ẩn của mọi vai đang dùng. */
export function menuAnTheoVai(input: {
  vai: readonly string[];
  anMenuCuaVai: ReadonlyMap<string, readonly string[]>;
}): string[] {
  // Vai không nạp được dòng RoleDef ⇒ coi như không ẩn gì ⇒ giao rỗng (fail-open: hiện như cũ).
  const cuaTungVai = input.vai.map((v) => new Set<string>(input.anMenuCuaVai.get(v) ?? []));
  const [dau, ...conLai] = cuaTungVai;
  if (!dau) return [];
  return [...dau].filter((h) => conLai.every((s) => s.has(h))).sort();
}
