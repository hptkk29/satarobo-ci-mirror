// lib/auth/switchable-areas.ts — #13 (câu 11 BGĐ): helper CHUYỂN KHU VỰC CROSS-HOST
// (admin ↔ teacher ↔ portal).
//
// ⚠️ ĐỪNG NHẦM với `lib/auth/active-role.ts`. Hai concept KHÁC nhau:
//   • active-role.ts  = ĐÃ ship #13 phase-1 (câu 11, user chốt 09/07): bộ lọc vai trò
//     cookie-based CHỈ trong admin — đổi MENU + panel dashboard mặc định, KHÔNG đổi host,
//     KHÔNG đổi quyền. Là cái đang chạy thật.
//   • switchable-areas.ts (file này) = nút chuyển QUA ranh giới HOST (admin↔teacher↔portal),
//     dành cho tương lai — chưa wire vào đâu cả.
//
// TRẠNG THÁI: hiện KHÔNG được import ở đâu (chưa dead code — là mảnh building block đã test).
// Chờ mở khoá: `TEACHER_SITE_ENABLED` = ON (mới có host teacher khác admin để mà "chuyển")
// và/hoặc #10 dashboard đa-vai wire helper này. Xem spec-13-chuyen-vai-tro-blocker.md §4.3.
//
// Dùng cho nút "Chuyển vai trò" (#13) + panel đa-vai (#10). NGUỒN SỰ THẬT = decideRoute:
// một area là "chuyển được" ⇔ decideRoute KHÔNG đá user khỏi host đó. Nhờ vậy helper
// KHÔNG viết lại luật host×role song song — luôn khớp gating thật (route-policy.test.ts).
// Không có area nào lọt vào đây mà route-policy sẽ chặn ⇒ không sinh nút chuyển "chết".
//
// ⚠️ Đầu vào là legacy Role union (PARENT/TEACHER/staff). Khi #13 dựng menu, map từ
// resolveActor().orgRoles (v2 roleCode) → token phân loại: "TEACHER"→TEACHER,
// (parent-hood qua Student.parentUserId)→PARENT, roleCode khác→1 staff Role bất kỳ
// (decideRoute coi mọi staff ≠ PARENT/TEACHER như nhau). Xem spec-13-chuyen-vai-tro-blocker.md.
import type { Role } from "@prisma/client";
import { decideRoute, type HostKind, type MaybeRole, type RouteDecision } from "@/lib/auth/route-policy";

export type SwitchableArea = "admin" | "teacher" | "portal";

/** Nhãn + host + trang chủ mỗi khu vực (menu #13 dùng để hiển thị + điều hướng). */
export const AREA_META: Record<SwitchableArea, { label: string; hostKind: HostKind; home: string }> = {
  admin: { label: "Quản trị", hostKind: "admin", home: "/dashboard" },
  teacher: { label: "Giáo viên", hostKind: "teacher", home: "/" },
  portal: { label: "Phụ huynh", hostKind: "portal", home: "/" },
};

const PROBE_ORDER: readonly SwitchableArea[] = ["admin", "teacher", "portal"];

/** decideRoute cho user Ở LẠI host này (phục vụ / điều hướng nội bộ) chứ không đá đi. */
function staysOnHost(d: RouteDecision, host: HostKind): boolean {
  if (d.type === "next" || d.type === "rewrite") return true;
  // redirectPath nội bộ (vd chuẩn hoá về home) = vẫn trong khu vực; trừ khi ép /login.
  if (d.type === "redirectPath") return d.path !== "/login";
  // redirectHost: chỉ "ở lại" nếu đá về CHÍNH host này (thực tế không xảy ra) → coi là bị đá.
  return d.host === host;
}

/**
 * Danh sách khu vực (admin/teacher/portal) mà tập vai trò này được phép ở lại.
 * ≥2 phần tử ⇒ #13 hiện nút "Chuyển vai trò"; ≤1 ⇒ ẩn (không có gì để chuyển).
 *
 * @param roles  union vai trò (legacy Role); null/rỗng ⇒ chưa login ⇒ [].
 * @param opts.teacherSiteEnabled  ép flag site GV (test/SSR); bỏ trống → đọc env.
 */
export function listSwitchableAreas(
  roles: MaybeRole[],
  opts?: { teacherSiteEnabled?: boolean },
): SwitchableArea[] {
  const cleaned = roles.filter((r): r is Role => r !== null);
  if (cleaned.length === 0) return [];
  return PROBE_ORDER.filter((area) => {
    const { hostKind, home } = AREA_META[area];
    const decision = decideRoute({
      hostKind,
      pathname: home,
      role: cleaned[0],
      roles: cleaned,
      sessionValid: true,
      teacherSiteEnabled: opts?.teacherSiteEnabled,
    });
    return staysOnHost(decision, hostKind);
  });
}
