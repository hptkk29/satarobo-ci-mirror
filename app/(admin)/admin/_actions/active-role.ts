"use server";

// #13 — đặt vai trò đang dùng (chỉ ảnh hưởng GIAO DIỆN; xem lib/auth/active-role.ts).
// File 'use server' chỉ export hàm async (quy tắc dự án).
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { isRbacV2Enabled, isTeacherSiteEnabled } from "@/lib/flags";
import {
  ACTIVE_ROLE_COOKIE,
  activeRoleOptions,
  resolveActiveRoleFrom,
} from "@/lib/auth/active-role";
import { areaForRole, areaHomeUrl } from "@/lib/auth/hosts";

// F2 (Q41) — SSO đa subdomain bật khi env này set (VD ".satarobo.vn"). Điều khiển
// cả (a) cookie sr_active_role có domain chung để host đích thấy vai, (b) F3 điều
// hướng cross-host. MẶC ĐỊNH không set → hành vi cũ (host-only, không nhảy site).
const ssoCookieDomain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;

export async function setActiveRoleAction(
  role: string,
): Promise<{ ok: boolean; error?: string; targetHost?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  const jar = await cookies();

  // "" = bỏ chọn → quay lại xem gộp mọi vai trò.
  if (role === "") {
    jar.delete(ACTIVE_ROLE_COOKIE);
    revalidatePath("/", "layout");
    return { ok: true };
  }

  // Chỉ nhận vai trò user THỰC SỰ giữ — chặn tự set vai lạ qua devtools.
  // Cờ ON → đối chiếu RoleDef code (actor.orgRoles); cờ OFF → vai legacy trong JWT.
  const actor = await resolveActor(session.user.id);
  const owned = activeRoleOptions(session.user, actor, isRbacV2Enabled());
  const valid = resolveActiveRoleFrom(owned, role);
  if (!valid) return { ok: false, error: "Bạn không giữ vai trò này" };

  jar.set(ACTIVE_ROLE_COOKIE, valid, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    // F2 — khi SSO bật, cookie phủ toàn zone để host đích (VD giaovien) thấy vai đang chọn.
    ...(ssoCookieDomain ? { domain: ssoCookieDomain } : {}),
  });
  revalidatePath("/", "layout");

  // F3 (Q41) — GV kiêm nhiệm chọn "Giáo viên" từ admin → điều hướng sang giaovien.
  // CHỈ khi: (a) SSO bật (không shared cookie thì nhảy host = văng login); (b) vai vừa
  // chọn ám chỉ teacher; (c) site teacher đang mở; (d) session.user.roles (LEGACY —
  // ĐÚNG nguồn decideRoute dùng để gác host) thực sự chứa TEACHER — nếu không, nhảy sang
  // teacher sẽ bị route-policy đá ngược về admin (v2 roleCode có thể chưa backfill legacy).
  // Chỉ xử lý teacher: RoleSwitcher chỉ hiện trên admin cho user đa vai; PARENT thuần
  // không bao giờ thấy switcher nên không cần nhánh portal (sẽ bị bounce nếu chạm).
  // Mặc định (SSO off) → không targetHost → RoleSwitcher giữ router.refresh() như cũ.
  if (ssoCookieDomain && areaForRole(valid) === "teacher") {
    const legacyRoles = session.user.roles ?? [];
    if (legacyRoles.includes("TEACHER") && isTeacherSiteEnabled()) {
      return { ok: true, targetHost: areaHomeUrl("teacher") };
    }
  }
  return { ok: true };
}
