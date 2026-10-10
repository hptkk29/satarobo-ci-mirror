import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { NextAuthRequest } from "next-auth";
import type { Role } from "@prisma/client";
import {
  decideRoute,
  isAdminRoute,
  isInfraPath,
  isLegacyAdminPrefixed,
  isElearningPath,
  isTeacherPath,
  isTeacherCleanUrl,
  sanitizeCallbackUrl,
  type HostKind,
  type RouteDecision,
} from "@/lib/auth/route-policy";
import { isTeacherSiteEnabled } from "@/lib/flags";

const PUBLIC_HOST = "satarobo.vn";
const ADMIN_HOST = "admin.satarobo.vn";
const PORTAL_HOST = "hocvien.satarobo.vn"; // Phase T2.2 — portal phụ huynh/site con
const SALE_HOST = "sale.satarobo.vn"; // Site tĩnh nhập liệu Sale → MISA AMIS CRM
const TEACHER_HOST = "giaovien.satarobo.vn"; // L6 — site giáo viên (flag TEACHER_SITE_ENABLED)
const ELEARNING_HOST = "e-learning.satarobo.vn"; // EL-01 — đào tạo nội bộ (flag ELEARNING_ENABLED)

function detectHost(host: string): HostKind {
  if (host === PUBLIC_HOST || host === `www.${PUBLIC_HOST}`) return "public";
  if (host === ADMIN_HOST) return "admin";
  if (host === PORTAL_HOST) return "portal";
  if (host === SALE_HOST) return "sale";
  if (host === TEACHER_HOST) return "teacher";
  if (host === ELEARNING_HOST) return "elearning";
  if (host.endsWith(".vercel.app")) return "vercel";
  return "unknown"; // localhost, preview deployments
}

// ⚠️ Đây là BẢNG TRA TÊN HOST, KHÔNG phải luật host×role. Luật vẫn nằm trọn ở
// `decideRoute()` và vẫn unit-test được — đúng tinh thần CLAUDE.md #3. Thêm một
// host vào đây là mảnh (2) của bộ ba mà đầu `route-policy.ts` đã mô tả cho site GV
// (detectHost · HOST_BY_KIND · union+rule); thiếu nó thì `decideRoute` không diễn
// đạt nổi chiều RA, và ép qua typecheck sẽ cho `url.host = undefined`.
const HOST_BY_KIND = {
  admin: ADMIN_HOST,
  portal: PORTAL_HOST,
  public: PUBLIC_HOST,
  sale: SALE_HOST,
  teacher: TEACHER_HOST,
  elearning: ELEARNING_HOST,
} as const;

/** Redirect to same path on different host (preserves query string). */
function redirectToHost(
  req: NextAuthRequest,
  targetHost: string,
  targetPath: string,
  status: 307 | 308 = 308,
): NextResponse {
  const url = req.nextUrl.clone();
  url.host = targetHost;
  url.protocol = "https:";
  url.port = "";
  url.pathname = targetPath;
  return NextResponse.redirect(url, status);
}

/**
 * Redirect within same host (preserves host). Build URL từ
 * `req.nextUrl.clone()` thay vì `new URL(path, req.url)` để KHÔNG bị
 * NextAuth canonicalize sang NEXTAUTH_URL/VERCEL_URL.
 */
function redirectTo(
  req: NextAuthRequest,
  pathname: string,
  search?: Record<string, string>,
): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  if (search) {
    for (const [k, v] of Object.entries(search)) {
      url.searchParams.set(k, v);
    }
  }
  return NextResponse.redirect(url);
}

/** Internal rewrite — URL bar stays, server-side resolves new path. */
function rewriteTo(req: NextAuthRequest, pathname: string): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.rewrite(url);
}

/** Add noindex headers for admin subdomain responses (SEO defense). */
function withAdminHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

/** Thực thi một RouteDecision (do `decideRoute()` trả về) thành NextResponse. */
function execute(req: NextAuthRequest, decision: RouteDecision): NextResponse {
  switch (decision.type) {
    case "next":
      return NextResponse.next();
    case "rewrite":
      return rewriteTo(req, decision.path);
    case "redirectPath": {
      const search: Record<string, string> = {};
      if (decision.callbackUrl) search.callbackUrl = decision.callbackUrl;
      if (decision.reason) search.reason = decision.reason;
      return redirectTo(req, decision.path, Object.keys(search).length ? search : undefined);
    }
    case "redirectHost":
      return redirectToHost(req, HOST_BY_KIND[decision.host], decision.path, decision.status);
  }
}

export default auth((req: NextAuthRequest) => {
  const { pathname } = req.nextUrl;
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const session = req.auth;
  const kind = detectHost(host);

  // ═══════════════════════════════════════════════════════════════════
  // BRANCH 1: *.vercel.app → canonical host (production only).
  // Pure canonicalization (không liên quan auth) — giữ inline.
  // ═══════════════════════════════════════════════════════════════════
  if (kind === "vercel" && process.env.NODE_ENV === "production") {
    // 10/08 — SỰ CỐ: MỌI cron chết im từ lúc dựng. Vercel Cron gọi vào URL deployment
    // (`satarobo-vn.vercel.app`), request rơi đúng nhánh này rồi ăn 308 sang host thật ⇒
    // handler KHÔNG BAO GIỜ chạy, và `Authorization: Bearer` cũng rụng khi đổi host nên
    // có follow redirect cũng 401. Triệu chứng: `DomainEvent` tích 285 dòng PENDING,
    // `attempts` = 0 (chưa từng được claim), không log lỗi, không ai biết.
    // Cùng họ với bug `/monitoring` đã vá trong `isInfraPath` — lần đó chỉ vá 3 nhánh
    // host thật, bỏ sót đúng nhánh canonical này.
    // Canonical-hoá là chuyện SEO/người dùng; `/api/*`, `/_next/*`, sitemap… không liên
    // quan ⇒ cho đi thẳng. Webhook ngoài (SePay/Zalo) trỏ nhầm vào .vercel.app cũng nhờ
    // đây mà sống thay vì rụng payload im lặng.
    if (isInfraPath(pathname)) return NextResponse.next();
    if (isLegacyAdminPrefixed(pathname)) {
      const cleanPath = pathname.replace(/^\/admin/, "") || "/dashboard";
      return redirectToHost(req, ADMIN_HOST, cleanPath, 308);
    }
    if (pathname === "/login" || isAdminRoute(pathname)) {
      return redirectToHost(req, ADMIN_HOST, pathname, 308);
    }
    return redirectToHost(req, PUBLIC_HOST, pathname, 308);
  }

  // ═══════════════════════════════════════════════════════════════════
  // BRANCH 2: host thật (public/admin/portal) → decideRoute() thuần tuý.
  // Toàn bộ logic phân quyền theo host nằm trong lib/auth/route-policy.ts
  // (test bằng route-policy.test.ts). Middleware không biết tokenVersion/
  // isActive (cần DB) → sessionValid = có JWT hợp lệ; tầng liveness
  // (deactivated/tokenVersion) enforce ở layout RSC. defense-in-depth.
  // ═══════════════════════════════════════════════════════════════════
  if (
    kind === "public" ||
    kind === "admin" ||
    kind === "portal" ||
    kind === "sale" ||
    kind === "teacher" ||
    kind === "elearning"
  ) {
    const decision = decideRoute({
      hostKind: kind,
      pathname,
      role: (session?.user?.role as Role | undefined) ?? null,
      roles: (session?.user?.roles as Role[] | undefined) ?? undefined,
      sessionValid: Boolean(session?.user),
    });
    const response = execute(req, decision);
    // Admin + teacher + e-learning đều là khu NỘI BỘ → noindex (SEO defense).
    return kind === "admin" || kind === "teacher" || kind === "elearning"
      ? withAdminHeaders(response)
      : response;
  }

  // ═══════════════════════════════════════════════════════════════════
  // BRANCH 3: unknown host (localhost, preview) — không có subdomain split.
  // Dùng path /admin/X như file system Next.js phục vụ + clean-URL mirror.
  // Áp role gate tối thiểu để dev không bypass được (PARENT ↛ /admin/*).
  // ═══════════════════════════════════════════════════════════════════
  const role = (session?.user?.role as Role | undefined) ?? null;
  // Đợt 3B — multi-role: xét UNION roles như decideRoute (route-policy.ts), KHÔNG
  // chỉ role chính. User PARENT kiêm TEACHER mà chỉ check role==='PARENT' sẽ bị
  // đá /portal trong khi portal layout đá /dashboard → ERR_TOO_MANY_REDIRECTS.
  const effectiveRoles: Role[] =
    session?.user?.roles && (session.user.roles as Role[]).length > 0
      ? (session.user.roles as Role[])
      : role !== null
        ? [role]
        : [];
  const isStaff = effectiveRoles.some((r) => r !== "PARENT");
  const isParentOnly = !isStaff && effectiveRoles.includes("PARENT");
  // L6 — GV THUẦN (role nhân sự DUY NHẤT là TEACHER) khi flag ON. Localhost không
  // có subdomain nên decideRoute trả "next" cho unknown host: phải xử lý ở đây,
  // ĐỐI XỨNG với cách PARENT được đưa về /portal bên dưới. Nếu không, GV thuần
  // đăng nhập trên localhost sẽ rơi vào /dashboard (admin) và không bao giờ thấy
  // site GV mới — khác hành vi host thật (admin-host redirect GV thuần → giaovien).
  // GV kiêm vai trò admin (CM/HR...) KHÔNG tính là teacher-only → vẫn ở admin.
  const isTeacherOnly =
    isTeacherSiteEnabled() &&
    effectiveRoles.includes("TEACHER") &&
    effectiveRoles.filter((r) => r !== "PARENT").every((r) => r === "TEACHER");

  // Site GV dùng path thật /teacher/* trên localhost (không rewrite). Gác login;
  // gate role do layout app/(teacher) tự lo (defense-in-depth như admin).
  if (isTeacherPath(pathname)) {
    if (!session?.user) {
      return redirectTo(req, "/login", { callbackUrl: sanitizeCallbackUrl(pathname) });
    }
    return NextResponse.next();
  }

  // EL-01 — khu đào tạo nội bộ dùng path thật /elearning/* trên localhost (không
  // rewrite). Đối xứng với nhánh isTeacherPath ngay trên: không có nhánh này thì hành vi
  // trên máy dev KHÁC prod — kiểu lệch tốn nhiều giờ nhất để truy ra.
  // Gate role + gate hồ sơ nhân sự do layout app/(elearning) tự lo (EL-01 PR2).
  //
  // ⚠️ Khối này PHẢI nằm ở BRANCH 3. Bản PR1 đặt nhầm nó trong BRANCH 1
  // (`kind === "vercel" && NODE_ENV === "production"`) ⇒ trên localhost và trên mọi host
  // thật nó KHÔNG BAO GIỜ chạy, `/elearning` rơi xuống nhánh cuối và đá về `/login`
  // MẤT `callbackUrl` — đăng nhập xong văng ra trang chủ, không ai biết tại sao.
  if (isElearningPath(pathname)) {
    if (!session?.user) {
      return redirectTo(req, "/login", { callbackUrl: sanitizeCallbackUrl(pathname) });
    }
    return NextResponse.next();
  }

  if (isLegacyAdminPrefixed(pathname)) {
    if (!session?.user) {
      return redirectTo(req, "/login", { callbackUrl: sanitizeCallbackUrl(pathname) });
    }
    if (isParentOnly) {
      return redirectTo(req, "/portal");
    }
    if (isTeacherOnly) {
      return redirectTo(req, "/teacher");
    }
    if (pathname === "/admin" || pathname === "/admin/") {
      return redirectTo(req, "/admin/dashboard");
    }
    return NextResponse.next();
  }

  // Clean URL trên localhost: rewrite /X → /admin/X cho known admin routes.
  if (isAdminRoute(pathname)) {
    if (!session?.user) {
      return redirectTo(req, "/login", { callbackUrl: sanitizeCallbackUrl(pathname) });
    }
    if (isParentOnly) {
      return redirectTo(req, "/portal");
    }
    if (isTeacherOnly) {
      // L0 chấm công (05/09/2026) — ĐỐI XỨNG với nhánh admin host của decideRoute: site GV
      // có màn này thì GIỮ path + query (mã QR chấm công `/cham-cong/checkin?c=&t=`), không
      // thì về trang chủ GV như cũ. Nhánh này chạy cho localhost VÀ test.satarobo.vn
      // (host "unknown") — thiếu nó thì trên test GV thuần quét QR vẫn rơi trang chủ,
      // và bản vá trong decideRoute không nghiệm thu được ở đâu ngoài prod.
      if (isTeacherCleanUrl(pathname)) {
        return redirectTo(
          req,
          "/teacher" + pathname,
          Object.fromEntries(req.nextUrl.searchParams.entries()),
        );
      }
      return redirectTo(req, "/teacher");
    }
    return rewriteTo(req, "/admin" + pathname);
  }

  if (pathname === "/login" && session?.user) {
    return redirectTo(
      req,
      isParentOnly ? "/portal" : isTeacherOnly ? "/teacher" : "/dashboard",
    );
  }

  return NextResponse.next();
});

// Broad matcher — middleware runs on all page/API requests.
// Static assets excluded for performance.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|js|css|woff|woff2|ttf|map)$).*)",
  ],
};
