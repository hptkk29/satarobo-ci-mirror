import { describe, it, expect } from "vitest";
import {
  decideRoute,
  isAdminRoute,
  isInfraPath,
  sanitizeCallbackUrl,
  type MaybeRole,
  type RouteDecision,
} from "./route-policy";

/**
 * Bảng tổ hợp host × role × sessionValid cho `decideRoute()`.
 *
 * Ma trận nguồn chân lý:
 *  - 7 staff role (TRỪ PARENT): admin ✅ / portal ❌ (đá về admin).
 *  - PARENT: portal ✅ / admin ❌ (đá về portal).
 *  - Chưa login: /login GIỮ host đang đứng (callbackUrl = path).
 *  - Public: ai cũng vào; /admin|/portal lọt vào → đá đúng host.
 *
 * Các case khoá lỗ hổng đã biết (proxy.ts cũ KHÔNG check role ở admin branch):
 *  - PARENT + admin route → PHẢI redirectHost portal (trước fix: rewrite /admin/* = LỌT).
 *  - PARENT + admin /login (đã login) → PHẢI redirectHost portal (trước fix: → /dashboard).
 */

const STAFF_ROLES = [
  "SUPER_ADMIN",
  "CENTER_MANAGER",
  "HR",
  "SALES_CSM",
  "TEACHER",
  "MARKETING",
  "ACCOUNTANT",
] as const satisfies readonly Exclude<NonNullable<MaybeRole>, "PARENT">[];

const ALL_ROLES = [...STAFF_ROLES, "PARENT"] as const;

function authed(role: MaybeRole) {
  return { role, sessionValid: true } as const;
}

// ─────────────────────────────────────────────────────────────────────────
// A. Ma trận host × role
// ─────────────────────────────────────────────────────────────────────────

describe("A. admin host × role", () => {
  it("mọi staff role vào admin route → rewrite /admin/* (GV THUẦN → site GV sau flip 10/07)", () => {
    for (const role of STAFF_ROLES) {
      const d = decideRoute({ hostKind: "admin", pathname: "/leads", ...authed(role) });
      if (role === "TEACHER") {
        // Flip TEACHER_SITE_ENABLED (default ON): GV thuần không làm việc trên
        // admin nữa — chuyển sang giaovien. GV kiêm nhiệm (test L6 riêng) ở lại.
        expect(d).toEqual<RouteDecision>({
          type: "redirectHost",
          host: "teacher",
          path: "/",
          status: 307,
        });
      } else {
        expect(d).toEqual<RouteDecision>({ type: "rewrite", path: "/admin/leads" });
      }
    }
  });

  // Regression: route folder tồn tại dưới app/(admin)/admin/* nhưng KHÔNG có
  // trong ADMIN_ROUTE_SEGMENTS → isAdminRoute=false → admin host bounce về public
  // = 404 (lỗi đã gặp với /payments, /cong-no, /report-cards, /cau-hinh-van-hanh).
  // Thêm route admin mới PHẢI thêm segment vào set.
  it("các route tài chính/báo cáo mới được nhận là admin route", () => {
    for (const seg of [
      "payments",
      "cong-no",
      "report-cards",
      "cau-hinh-van-hanh",
      "evaluations",
      "roles",
      "scorm",
      "bao-cao",
      "hoan-tien",
      "search",
      "compliance",
      "teaching-materials",
      "huong-dan",
      "otp-logs",
      "user-groups",
      "hoi-thoai",
      // A-02 (25/08/2026) — dashboard QLCS 4 tab.
      "dashboard-qlcs",
    ]) {
      expect(isAdminRoute(`/${seg}`)).toBe(true);
      expect(
        decideRoute({ hostKind: "admin", pathname: `/${seg}`, ...authed("SUPER_ADMIN") }),
      ).toEqual<RouteDecision>({ type: "rewrite", path: `/admin/${seg}` });
    }
  });

  // GĐ2 — màn "Lớp Trial" gộp hai màn cũ. Đây là lưới DUY NHẤT bắt được lỗi thiếu
  // segment: trên localhost trang chạy hoàn hảo, chỉ admin host mới 308 sang public
  // rồi 404. Hai segment cũ vẫn phải sống tới GĐ6 vì hai màn cũ chạy song song.
  it("lop-trial là admin route — kể cả tab con và path chi tiết", () => {
    expect(isAdminRoute("/lop-trial")).toBe(true);
    expect(isAdminRoute("/lop-trial/lich-hen")).toBe(true);
    expect(isAdminRoute("/lop-trial/moi")).toBe(true);
    expect(isAdminRoute("/lop-trial/abc123")).toBe(true);
    expect(
      decideRoute({ hostKind: "admin", pathname: "/lop-trial", ...authed("SUPER_ADMIN") }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/admin/lop-trial" });
    // Hai màn cũ CHƯA gỡ — mất một trong hai là người nghiệm thu mất đường đối chiếu.
    expect(isAdminRoute("/trials")).toBe(true);
    expect(isAdminRoute("/trial-classes")).toBe(true);
  });

  it("khuyen-mai là admin route (26/09/2026) — cả trang con /moi, /[id], /[id]/sua", () => {
    expect(isAdminRoute("/khuyen-mai")).toBe(true);
    expect(isAdminRoute("/khuyen-mai/moi")).toBe(true);
    expect(isAdminRoute("/khuyen-mai/abc/sua")).toBe(true);
  });

  // US-03 (Nền Hệ thống P0) — /user-groups từng THIẾU trong ADMIN_ROUTE_SEGMENTS dù
  // page tồn tại → link sidebar trên admin.satarobo.vn bounce 308 về public = 404.
  // Pin thêm path chi tiết (nested [id]) để không tái phát.
  it("user-groups là admin route — kể cả path chi tiết /user-groups/[id]", () => {
    expect(isAdminRoute("/user-groups")).toBe(true);
    expect(isAdminRoute("/user-groups/abc123")).toBe(true);
    expect(
      decideRoute({
        hostKind: "admin",
        pathname: "/user-groups/abc123",
        ...authed("SUPER_ADMIN"),
      }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/admin/user-groups/abc123" });
  });

  /**
   * A-02 — dashboard QLCS 4 tab nằm ở segment RIÊNG `/dashboard-qlcs`, không dùng lại
   * `/dashboard` (màn tiếp đất chung của cả 9 vai). Hai điều phải giữ:
   *  1. Segment mới được nhận là admin route KỂ CẢ khi mang searchParams của bộ lọc —
   *     `firstSegment` chỉ đọc path, nhưng pin lại để đổi cách tách segment là đỏ ngay.
   *  2. `/dashboard` CŨ không bị segment mới nuốt (prefix `dashboard` là con của nó).
   */
  it("[A-02] /dashboard-qlcs là admin route và KHÔNG đụng /dashboard cũ", () => {
    expect(isAdminRoute("/dashboard-qlcs")).toBe(true);
    expect(isAdminRoute("/dashboard")).toBe(true);
    expect(
      decideRoute({
        hostKind: "admin",
        pathname: "/dashboard-qlcs",
        ...authed("CENTER_MANAGER"),
      }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/admin/dashboard-qlcs" });
    expect(
      decideRoute({ hostKind: "admin", pathname: "/dashboard", ...authed("CENTER_MANAGER") }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/admin/dashboard" });
    // Phụ huynh vẫn bị đá về portal — segment mới không mở thêm cửa nào.
    expect(
      decideRoute({ hostKind: "admin", pathname: "/dashboard-qlcs", ...authed("PARENT") }),
    ).toEqual<RouteDecision>({ type: "redirectHost", host: "portal", path: "/", status: 307 });
  });

  /**
   * S1 (tích hợp ZaloCRM 06/09/2026) — màn Zalo CRM nhúng ở segment riêng `/zalo-crm`.
   *
   * Đây là lưới DUY NHẤT bắt được lỗi thiếu segment: trên localhost trang chạy hoàn hảo,
   * chỉ `admin.satarobo.vn/zalo-crm` mới bị 308 sang host public rồi 404 — và 308 là
   * permanent nên trình duyệt cache vĩnh viễn, sửa mã xong vẫn không tự khỏi. Danh sách
   * `ADMIN_ROUTE_SEGMENTS` gõ tay, không quét thư mục, nên không thêm ca ở đây là không
   * có gì canh (đã tái phát với /payments, /cong-no, /user-groups, /to-chuc).
   *
   * Ghim luôn dạng CÓ searchParams: nút "Nhắn Zalo" trên phiếu lead (S2) mở
   * `/zalo-crm?compose=84…&lead=<id>`, và `firstSegment` chỉ đọc pathname — đổi cách
   * tách segment là ca này đỏ ngay.
   */
  it("[S1] /zalo-crm là admin route — kể cả khi mang ?compose= của nút Nhắn Zalo", () => {
    expect(isAdminRoute("/zalo-crm")).toBe(true);
    expect(
      decideRoute({ hostKind: "admin", pathname: "/zalo-crm", ...authed("SUPER_ADMIN") }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/admin/zalo-crm" });
    // Tư vấn viên là người dùng chính của màn này.
    expect(
      decideRoute({ hostKind: "admin", pathname: "/zalo-crm", ...authed("SALES_CSM") }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/admin/zalo-crm" });
    // Phụ huynh vẫn bị đá về portal — segment mới không mở thêm cửa nào.
    expect(
      decideRoute({ hostKind: "admin", pathname: "/zalo-crm", ...authed("PARENT") }),
    ).toEqual<RouteDecision>({ type: "redirectHost", host: "portal", path: "/", status: 307 });
  });

  it("PARENT vào admin route → redirectHost portal (lỗ hổng đã bịt)", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/dashboard", ...authed("PARENT") }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "portal",
      path: "/",
      status: 307,
    });
    // nested admin path cũng phải bị chặn
    expect(
      decideRoute({ hostKind: "admin", pathname: "/leads/123", ...authed("PARENT") }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "portal",
      path: "/",
      status: 307,
    });
  });

  it("chưa login vào admin route → /login GIỮ host admin + callbackUrl", () => {
    expect(
      decideRoute({
        hostKind: "admin",
        pathname: "/leads",
        role: null,
        sessionValid: false,
      }),
    ).toEqual<RouteDecision>({
      type: "redirectPath",
      path: "/login",
      callbackUrl: "/leads",
      reason: undefined,
    });
  });

  it("staff vào / → /dashboard; PARENT vào / → portal; ẩn danh → /login", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/", ...authed("HR") }),
    ).toEqual<RouteDecision>({ type: "redirectPath", path: "/dashboard" });
    expect(
      decideRoute({ hostKind: "admin", pathname: "/", ...authed("PARENT") }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "portal",
      path: "/",
      status: 307,
    });
    expect(
      decideRoute({ hostKind: "admin", pathname: "/", role: null, sessionValid: false }),
    ).toEqual<RouteDecision>({ type: "redirectPath", path: "/login", reason: undefined });
  });
});

describe("A. portal host × role", () => {
  it("PARENT clean path → rewrite /portal/*", () => {
    expect(
      decideRoute({ hostKind: "portal", pathname: "/lich-hoc", ...authed("PARENT") }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/portal/lich-hoc" });
    expect(
      decideRoute({ hostKind: "portal", pathname: "/", ...authed("PARENT") }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/portal" });
  });

  it("mọi staff role lạc vào portal → redirectHost admin", () => {
    for (const role of STAFF_ROLES) {
      expect(
        decideRoute({ hostKind: "portal", pathname: "/lich-hoc", ...authed(role) }),
      ).toEqual<RouteDecision>({
        type: "redirectHost",
        host: "admin",
        path: "/dashboard",
        status: 307,
      });
    }
  });

  it("chưa login vào portal → /login GIỮ host portal + callbackUrl", () => {
    expect(
      decideRoute({
        hostKind: "portal",
        pathname: "/lich-hoc",
        role: null,
        sessionValid: false,
      }),
    ).toEqual<RouteDecision>({
      type: "redirectPath",
      path: "/login",
      callbackUrl: "/lich-hoc",
      reason: undefined,
    });
  });

  it("PARENT vào admin-ish path trên portal (vd /dashboard) → portal home", () => {
    expect(
      decideRoute({ hostKind: "portal", pathname: "/dashboard", ...authed("PARENT") }),
    ).toEqual<RouteDecision>({ type: "redirectPath", path: "/" });
  });
});

describe("A. public host × role — ai cũng vào", () => {
  it("public page → next (mọi role + ẩn danh)", () => {
    for (const role of [...ALL_ROLES, null] as MaybeRole[]) {
      expect(
        decideRoute({
          hostKind: "public",
          pathname: "/khoa-hoc",
          role,
          sessionValid: role !== null,
        }),
      ).toEqual<RouteDecision>({ type: "next" });
    }
  });
});

describe("A. public host × /login — F4 cổng login chung (Q41)", () => {
  it("mặc định (OFF): public /login → 307 admin/login (dồn về admin, không cache vĩnh viễn)", () => {
    expect(
      decideRoute({ hostKind: "public", pathname: "/login", role: null, sessionValid: false }),
    ).toEqual<RouteDecision>({ type: "redirectHost", host: "admin", path: "/login", status: 307 });
    expect(
      decideRoute({ hostKind: "public", pathname: "/login", ...authed("SUPER_ADMIN") }),
    ).toEqual<RouteDecision>({ type: "redirectHost", host: "admin", path: "/login", status: 307 });
  });

  it("ON: ẩn danh public /login → next (serve form ngay tại satarobo.vn)", () => {
    expect(
      decideRoute({
        hostKind: "public",
        pathname: "/login",
        role: null,
        sessionValid: false,
        commonLoginAtRoot: true,
      }),
    ).toEqual<RouteDecision>({ type: "next" });
  });

  it("ON: đã login mở public /login → về đúng host (staff→admin, PARENT→portal, GV thuần→teacher)", () => {
    expect(
      decideRoute({
        hostKind: "public",
        pathname: "/login",
        ...authed("SUPER_ADMIN"),
        commonLoginAtRoot: true,
      }),
    ).toEqual<RouteDecision>({ type: "redirectHost", host: "admin", path: "/dashboard", status: 307 });
    expect(
      decideRoute({
        hostKind: "public",
        pathname: "/login",
        ...authed("PARENT"),
        commonLoginAtRoot: true,
      }),
    ).toEqual<RouteDecision>({ type: "redirectHost", host: "portal", path: "/", status: 307 });
    expect(
      decideRoute({
        hostKind: "public",
        pathname: "/login",
        ...authed("TEACHER"),
        commonLoginAtRoot: true,
        teacherSiteEnabled: true,
      }),
    ).toEqual<RouteDecision>({ type: "redirectHost", host: "teacher", path: "/", status: 307 });
  });

  it("ON: /login → admin route KHÁC vẫn 308 admin (không đổi)", () => {
    expect(
      decideRoute({
        hostKind: "public",
        pathname: "/dashboard",
        role: null,
        sessionValid: false,
        commonLoginAtRoot: true,
      }),
    ).toEqual<RouteDecision>({ type: "redirectHost", host: "admin", path: "/dashboard", status: 308 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// B. Edge cases
// ─────────────────────────────────────────────────────────────────────────

describe("B. /login khi đã login", () => {
  it("PARENT ở portal/login → portal home", () => {
    expect(
      decideRoute({ hostKind: "portal", pathname: "/login", ...authed("PARENT") }),
    ).toEqual<RouteDecision>({ type: "redirectPath", path: "/" });
  });

  it("staff ở admin/login → /dashboard", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/login", ...authed("SUPER_ADMIN") }),
    ).toEqual<RouteDecision>({ type: "redirectPath", path: "/dashboard" });
  });

  it("PARENT ở admin/login (đã login) → redirectHost portal", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/login", ...authed("PARENT") }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "portal",
      path: "/",
      status: 307,
    });
  });

  it("staff ở portal/login (đã login) → redirectHost admin", () => {
    expect(
      decideRoute({ hostKind: "portal", pathname: "/login", ...authed("TEACHER") }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "admin",
      path: "/dashboard",
      status: 307,
    });
  });

  it("chưa login ở /login (admin & portal) → next (hiện form)", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/login", role: null, sessionValid: false }),
    ).toEqual<RouteDecision>({ type: "next" });
    expect(
      decideRoute({ hostKind: "portal", pathname: "/login", role: null, sessionValid: false }),
    ).toEqual<RouteDecision>({ type: "next" });
  });
});

describe("B. route lọt sai host", () => {
  it("/admin/* lọt vào public → redirectHost admin (strip prefix)", () => {
    expect(
      decideRoute({ hostKind: "public", pathname: "/admin/leads", role: null, sessionValid: false }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "admin",
      path: "/leads",
      status: 308,
    });
  });

  it("bare admin route name lọt vào public → redirectHost admin", () => {
    expect(
      decideRoute({ hostKind: "public", pathname: "/leads", role: null, sessionValid: false }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "admin",
      path: "/leads",
      status: 308,
    });
  });

  it("/portal/* lọt vào public host → redirectHost portal", () => {
    expect(
      decideRoute({ hostKind: "public", pathname: "/portal/lich-hoc", role: null, sessionValid: false }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "portal",
      path: "/",
      status: 308,
    });
  });

  it("/portal/* lọt vào admin host → redirectHost portal", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/portal/lich-hoc", ...authed("PARENT") }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "portal",
      path: "/",
      status: 308,
    });
  });

  it("legacy /admin/X trên admin host → strip prefix (giữ host)", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/admin/leads", ...authed("HR") }),
    ).toEqual<RouteDecision>({ type: "redirectPath", path: "/leads" });
  });

  it("non-admin path trên admin host → bounce public", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/khoa-hoc", ...authed("HR") }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "public",
      path: "/khoa-hoc",
      status: 308,
    });
  });
});

describe("B. infra paths không bị auth", () => {
  // `/monitoring` = Sentry tunnel (next.config.ts) — phải `next`, không được 308
  // sang public host (nếu không: báo lỗi site admin đi sai chỗ + browser cache 308).
  for (const p of ["/api/leads", "/_next/static/chunk.js", "/favicon.ico", "/monitoring"]) {
    it(`${p} (admin host) → next`, () => {
      expect(
        decideRoute({ hostKind: "admin", pathname: p, role: null, sessionValid: false }),
      ).toEqual<RouteDecision>({ type: "next" });
    });
    it(`${p} (portal host) → next`, () => {
      expect(
        decideRoute({ hostKind: "portal", pathname: p, role: null, sessionValid: false }),
      ).toEqual<RouteDecision>({ type: "next" });
    });
  }
});

describe("B. sessionValid=false (deactivated) → /login?reason bất kể role", () => {
  it("admin route, role còn nhưng session invalid → /login + reason + callbackUrl", () => {
    for (const role of ALL_ROLES) {
      const d = decideRoute({
        hostKind: "admin",
        pathname: "/leads",
        role,
        sessionValid: false,
      });
      expect(d).toEqual<RouteDecision>({
        type: "redirectPath",
        path: "/login",
        callbackUrl: "/leads",
        reason: "session-invalidated",
      });
    }
  });

  it("portal route, role còn nhưng session invalid → /login + reason", () => {
    const d = decideRoute({
      hostKind: "portal",
      pathname: "/lich-hoc",
      role: "PARENT",
      sessionValid: false,
    });
    expect(d).toEqual<RouteDecision>({
      type: "redirectPath",
      path: "/login",
      callbackUrl: "/lich-hoc",
      reason: "session-invalidated",
    });
  });
});

describe("B. callbackUrl sanitize chống open-redirect", () => {
  it("path nội bộ thuần → giữ nguyên", () => {
    expect(sanitizeCallbackUrl("/leads/123")).toBe("/leads/123");
  });
  it("//evil.com → /", () => {
    expect(sanitizeCallbackUrl("//evil.com")).toBe("/");
  });
  it("chứa http(s):// → /", () => {
    expect(sanitizeCallbackUrl("/x?next=https://evil.com")).toBe("/");
    expect(sanitizeCallbackUrl("/redir?u=http://evil")).toBe("/");
  });
  it("backslash trick → /", () => {
    expect(sanitizeCallbackUrl("/\\evil.com")).toBe("/");
    expect(sanitizeCallbackUrl("\\\\evil.com")).toBe("/");
  });
  it("không bắt đầu bằng / → /", () => {
    expect(sanitizeCallbackUrl("evil.com")).toBe("/");
    expect(sanitizeCallbackUrl("")).toBe("/");
  });

  it("decideRoute không bao giờ trả callbackUrl chứa host khác", () => {
    const d = decideRoute({
      hostKind: "admin",
      pathname: "//evil.com/leads",
      role: null,
      sessionValid: false,
    });
    // "//evil.com/leads" firstSegment = "evil.com" → không phải admin route →
    // bounce public; nhưng nếu là admin route, callbackUrl phải đã sanitize.
    if (d.type === "redirectPath" && d.callbackUrl) {
      expect(d.callbackUrl.startsWith("//")).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Tổng quát: KHÔNG bao giờ rewrite /admin/* cho PARENT, /portal/* cho staff.
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// Đợt 3B — đa vai trò (roles[])
// ─────────────────────────────────────────────────────────────────────────

describe("3B. đa vai trò (roles[])", () => {
  it("[CENTER_MANAGER, TEACHER] vào admin route → rewrite /admin/*", () => {
    expect(
      decideRoute({
        hostKind: "admin",
        pathname: "/leads",
        role: "CENTER_MANAGER",
        roles: ["CENTER_MANAGER", "TEACHER"],
        sessionValid: true,
      }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/admin/leads" });
  });

  it("[CENTER_MANAGER, TEACHER] vào portal → redirectHost admin (staff cấm portal)", () => {
    expect(
      decideRoute({
        hostKind: "portal",
        pathname: "/lich-hoc",
        role: "CENTER_MANAGER",
        roles: ["CENTER_MANAGER", "TEACHER"],
        sessionValid: true,
      }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "admin",
      path: "/dashboard",
      status: 307,
    });
  });

  it("[PARENT] (roles) vẫn như cũ — admin → portal, portal → rewrite", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/dashboard", role: "PARENT", roles: ["PARENT"], sessionValid: true }),
    ).toEqual<RouteDecision>({ type: "redirectHost", host: "portal", path: "/", status: 307 });
    expect(
      decideRoute({ hostKind: "portal", pathname: "/lich-hoc", role: "PARENT", roles: ["PARENT"], sessionValid: true }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/portal/lich-hoc" });
  });

  it("phòng vệ: nếu lỡ trộn [CENTER_MANAGER, PARENT] → coi là STAFF (vào admin, cấm portal)", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/leads", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER", "PARENT"], sessionValid: true }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/admin/leads" });
    expect(
      decideRoute({ hostKind: "portal", pathname: "/lich-hoc", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER", "PARENT"], sessionValid: true }),
    ).toEqual<RouteDecision>({ type: "redirectHost", host: "admin", path: "/dashboard", status: 307 });
  });

  it("roles trống → fallback role chính (back-compat)", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/leads", role: "HR", roles: [], sessionValid: true }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/admin/leads" });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// L5 — teacher host (giaovien.satarobo.vn) × role × flag TEACHER_SITE_ENABLED
// (phiếu BGĐ câu 7, 04/07/2026). 2-phase: flag OFF = hành vi hiện tại y nguyên.
// ─────────────────────────────────────────────────────────────────────────

describe("L5. teacher host × role — flag OFF (mặc định)", () => {
  const OFF = { teacherSiteEnabled: false } as const;

  it("TEACHER trên giaovien → bounce admin /dashboard (site chưa mở, GV vẫn dùng admin)", () => {
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/", ...authed("TEACHER"), ...OFF }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "admin",
      path: "/dashboard",
      status: 307,
    });
  });

  it("mọi staff role trên giaovien → bounce admin; PARENT → portal; ẩn danh → admin", () => {
    for (const role of STAFF_ROLES) {
      expect(
        decideRoute({ hostKind: "teacher", pathname: "/lich", ...authed(role), ...OFF }),
      ).toEqual<RouteDecision>({
        type: "redirectHost",
        host: "admin",
        path: "/dashboard",
        status: 307,
      });
    }
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/lich", ...authed("PARENT"), ...OFF }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "portal",
      path: "/",
      status: 307,
    });
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/lich", role: null, sessionValid: false, ...OFF }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "admin",
      path: "/dashboard",
      status: 307,
    });
  });

  it("bỏ trống flag (env unset trong test) → mặc định ON (FLIP 10/07 — site GV mở)", () => {
    // Trước flip default OFF → GV trên teacher host bị đá về admin. Sau flip
    // (lib/flags.ts !== "false") GV vào thẳng site GV; rollback = env "false"
    // (hành vi OFF vẫn được phủ bởi các test truyền teacherSiteEnabled: false).
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/", ...authed("TEACHER") }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/teacher" });
  });

  it("infra path → next (không bị bounce, kể cả flag OFF)", () => {
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/api/auth/session", role: null, sessionValid: false, ...OFF }),
    ).toEqual<RouteDecision>({ type: "next" });
  });
});

describe("L5. teacher host × role — flag ON", () => {
  const ON = { teacherSiteEnabled: true } as const;

  it("TEACHER: / → rewrite /teacher; clean URL /lich → rewrite /teacher/lich; /teacher/lich → next", () => {
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/", ...authed("TEACHER"), ...ON }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/teacher" });
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/lich", ...authed("TEACHER"), ...ON }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/teacher/lich" });
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/teacher/lich", ...authed("TEACHER"), ...ON }),
    ).toEqual<RouteDecision>({ type: "next" });
  });

  it("TEACHER ở /login (đã login) → teacher home", () => {
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/login", ...authed("TEACHER"), ...ON }),
    ).toEqual<RouteDecision>({ type: "redirectPath", path: "/" });
  });

  // Sự cố 19/08/2026: 6 segment tồn tại ở CẢ hai site. Nhánh "chuẩn hoá path lạc khu" chạy
  // trước nên clean URL của đúng những màn này bị ném về trang chủ GV — im lặng, không lỗi.
  // Năm cái đầu hỏng từ trước bản vá; `lich` suýt hỏng thêm khi vá link chết "Lịch tổng" bên admin.
  it.each(["don-tu", "hoc-ba", "huong-dan", "scorm", "tin-nhan", "lich", "cham-cong"])(
    "clean URL /%s trùng tên segment admin nhưng vẫn phải mở màn GV",
    (seg) => {
      expect(
        decideRoute({ hostKind: "teacher", pathname: `/${seg}`, ...authed("TEACHER"), ...ON }),
      ).toEqual<RouteDecision>({ type: "rewrite", path: `/teacher/${seg}` });
    },
  );

  it("trang Tất cả thông báo chạy được ở CẢ hai host", () => {
    // Ràng buộc PRD: trang này KHÔNG có trên sidebar ⇒ nếu segment thiếu thì lỗi chỉ lộ ra khi
    // người dùng bấm "Xem tất cả thông báo" ở chân panel — muộn và khó lần.
    expect(isAdminRoute("/thong-bao")).toBe(true);
    expect(
      decideRoute({ hostKind: "admin", pathname: "/thong-bao", ...authed("SUPER_ADMIN") }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/admin/thong-bao" });
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/thong-bao", ...authed("TEACHER"), ...ON }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/teacher/thong-bao" });
  });

  it("path lạc khu THẬT (không phải màn GV) vẫn bị đưa về trang chủ GV", () => {
    for (const p of ["/dashboard", "/leads", "/portal/ho-so", "/admin/students"]) {
      expect(
        decideRoute({ hostKind: "teacher", pathname: p, ...authed("TEACHER"), ...ON }),
      ).toEqual<RouteDecision>({ type: "redirectPath", path: "/" });
    }
  });

  it("đa vai trò kiêm TEACHER ([CENTER_MANAGER, TEACHER]) → vào site GV", () => {
    expect(
      decideRoute({
        hostKind: "teacher",
        pathname: "/lich",
        role: "CENTER_MANAGER",
        roles: ["CENTER_MANAGER", "TEACHER"],
        sessionValid: true,
        ...ON,
      }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/teacher/lich" });
  });

  it("staff KHÔNG có role TEACHER (CENTER_MANAGER) → bounce admin /dashboard", () => {
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/lich", ...authed("CENTER_MANAGER"), ...ON }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "admin",
      path: "/dashboard",
      status: 307,
    });
    // kể cả đứng ở /login
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/login", ...authed("CENTER_MANAGER"), ...ON }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "admin",
      path: "/dashboard",
      status: 307,
    });
  });

  it("PARENT → bounce portal /", () => {
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/lich", ...authed("PARENT"), ...ON }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "portal",
      path: "/",
      status: 307,
    });
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/login", ...authed("PARENT"), ...ON }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "portal",
      path: "/",
      status: 307,
    });
  });

  it("chưa login → /login GIỮ host teacher + callbackUrl; ở /login → next (form)", () => {
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/lich", role: null, sessionValid: false, ...ON }),
    ).toEqual<RouteDecision>({
      type: "redirectPath",
      path: "/login",
      callbackUrl: "/lich",
      reason: undefined,
    });
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/login", role: null, sessionValid: false, ...ON }),
    ).toEqual<RouteDecision>({ type: "next" });
  });

  it("sessionValid=false (deactivated) → /login + reason", () => {
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/lich", role: "TEACHER", sessionValid: false, ...ON }),
    ).toEqual<RouteDecision>({
      type: "redirectPath",
      path: "/login",
      callbackUrl: "/lich",
      reason: "session-invalidated",
    });
  });

  it("TEACHER vào path lạc khu (/dashboard, /portal/x, /admin/x) → teacher home", () => {
    for (const p of ["/dashboard", "/leads", "/portal/lich-hoc", "/admin/leads"]) {
      expect(
        decideRoute({ hostKind: "teacher", pathname: p, ...authed("TEACHER"), ...ON }),
      ).toEqual<RouteDecision>({ type: "redirectPath", path: "/" });
    }
  });

  it("infra path → next", () => {
    expect(
      decideRoute({ hostKind: "teacher", pathname: "/_next/static/x.js", role: null, sessionValid: false, ...ON }),
    ).toEqual<RouteDecision>({ type: "next" });
  });
});

describe("L5/L6. TEACHER × host × flag TEACHER_SITE_ENABLED (2-phase, ĐÃ wire proxy #06)", () => {
  // Public host: GV vẫn xem site công khai bình thường (cả 2 flag).
  for (const flag of [false, true]) {
    it(`flag=${flag}: TEACHER trên public host (apex) → next`, () => {
      expect(
        decideRoute({
          hostKind: "public",
          pathname: "/khoa-hoc",
          ...authed("TEACHER"),
          teacherSiteEnabled: flag,
        }),
      ).toEqual<RouteDecision>({ type: "next" });
    });
  }

  // flag OFF (L5, 2-phase): GV thuần vẫn LÀM VIỆC trên admin — KHÔNG đá đi.
  it("flag=false: GV thuần trên admin host → rewrite /admin/* (vẫn dùng admin)", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/leads", ...authed("TEACHER"), teacherSiteEnabled: false }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/admin/leads" });
  });
  it("flag=false: GV thuần login trên admin host → /dashboard (chưa auto-bounce)", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/login", ...authed("TEACHER"), teacherSiteEnabled: false }),
    ).toEqual<RouteDecision>({ type: "redirectPath", path: "/dashboard" });
  });

  // flag ON (L6, đã wire proxy #06): GV THUẦN trên admin → auto-bounce sang giaovien.
  it("flag=true: GV thuần trên admin host → redirectHost teacher (L6 auto-bounce)", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/leads", ...authed("TEACHER"), teacherSiteEnabled: true }),
    ).toEqual<RouteDecision>({ type: "redirectHost", host: "teacher", path: "/", status: 307 });
  });
  it("flag=true: GV thuần login trên admin host → redirectHost teacher (L6)", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/login", ...authed("TEACHER"), teacherSiteEnabled: true }),
    ).toEqual<RouteDecision>({ type: "redirectHost", host: "teacher", path: "/", status: 307 });
  });

  // L0 chấm công (05/09/2026) — sự cố từ 10/07: mã QR tại quầy in host admin
  // (`/cham-cong/checkin?c=&t=`). GV thuần quét → admin host đá sang giaovien nhưng
  // path bị ép về "/" ⇒ rơi trang chủ, không chấm công được. Nay: path nào site GV có
  // thì GIỮ; query do proxy giữ (clone nextUrl). Path admin-only vẫn về "/".
  it("flag=true: GV thuần quét QR chấm công trên admin host → sang giaovien GIỮ path", () => {
    expect(
      decideRoute({
        hostKind: "admin",
        pathname: "/cham-cong/checkin",
        ...authed("TEACHER"),
        teacherSiteEnabled: true,
      }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "teacher",
      path: "/cham-cong/checkin",
      status: 307,
    });
  });
  it("flag=true: path admin-only (/leads/123) vẫn đá về trang chủ GV, không mang path sang", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/leads/123", ...authed("TEACHER"), teacherSiteEnabled: true }),
    ).toEqual<RouteDecision>({ type: "redirectHost", host: "teacher", path: "/", status: 307 });
  });
  it("teacher host: /cham-cong/checkin rewrite vào màn check-in của site GV", () => {
    expect(
      decideRoute({
        hostKind: "teacher",
        pathname: "/cham-cong/checkin",
        ...authed("TEACHER"),
        teacherSiteEnabled: true,
      }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/teacher/cham-cong/checkin" });
  });
  // GV kiêm vai admin KHÔNG bị đá: vẫn chấm trên admin host như cũ.
  it("flag=true: GV kiêm CENTER_MANAGER quét QR → rewrite admin, không đổi host", () => {
    expect(
      decideRoute({
        hostKind: "admin",
        pathname: "/cham-cong/checkin",
        role: "TEACHER",
        roles: ["TEACHER", "CENTER_MANAGER"],
        sessionValid: true,
        teacherSiteEnabled: true,
      }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/admin/cham-cong/checkin" });
  });

  // flag ON: GV KIÊM vai trò admin (CENTER_MANAGER) → KHÔNG auto-bounce, vẫn dùng admin.
  it("flag=true: GV kiêm CENTER_MANAGER trên admin host → vẫn admin (isTeacherOnly=false)", () => {
    expect(
      decideRoute({
        hostKind: "admin",
        pathname: "/leads",
        role: "CENTER_MANAGER",
        roles: ["CENTER_MANAGER", "TEACHER"],
        sessionValid: true,
        teacherSiteEnabled: true,
      }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/admin/leads" });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Sale host (sale.satarobo.vn) — biểu mẫu tĩnh CÔNG KHAI đã NGHỈ (22/08/2026).
//
// Địa chỉ nhập khách duy nhất nay là `admin.satarobo.vn/nhap-khach-hang`
// (23/08/2026 dời vào admin). Host cũ chỉ còn đá 307 về đó — 307 chứ KHÔNG 308
// để quyết định vận hành này còn đảo được mà không vướng cache vĩnh viễn.
// ─────────────────────────────────────────────────────────────────────────

const TO_INTAKE: RouteDecision = {
  type: "redirectHost",
  host: "admin",
  path: "/nhap-khach-hang",
  status: 307,
};

describe("Sale host (sale.satarobo.vn) — site đã gỡ, mọi đường về biểu mẫu admin", () => {
  it("mọi đường CŨ của biểu mẫu → về trang nhập khách mới", () => {
    for (const p of [
      "/",
      "/thank-you",
      "/thank-you/",
      "/sale/nhap-lieu.html",
      "/sale/thank-you.html",
    ]) {
      expect(
        decideRoute({ hostKind: "sale", pathname: p, role: null, sessionValid: false }),
      ).toEqual<RouteDecision>(TO_INTAKE);
    }
  });

  it("path lạ trên sale host → cũng về trang nhập khách mới", () => {
    for (const p of ["/random", "/khoa-hoc", "/admin/leads", "/portal/lich-hoc", "/login"]) {
      expect(
        decideRoute({ hostKind: "sale", pathname: p, role: null, sessionValid: false }),
      ).toEqual<RouteDecision>(TO_INTAKE);
    }
  });

  it("infra path (favicon/api/robots/_next) → next", () => {
    for (const p of ["/favicon.ico", "/api/anything", "/robots.txt", "/_next/static/x.js"]) {
      expect(
        decideRoute({ hostKind: "sale", pathname: p, role: null, sessionValid: false }),
      ).toEqual<RouteDecision>({ type: "next" });
    }
  });

  it("mọi role + ẩn danh đều nhận CÙNG quyết định (host này không phục vụ gì)", () => {
    for (const role of [...ALL_ROLES, null] as MaybeRole[]) {
      const sessionValid = role !== null;
      expect(
        decideRoute({ hostKind: "sale", pathname: "/", role, sessionValid }),
      ).toEqual<RouteDecision>(TO_INTAKE);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Biểu mẫu nhập khách hàng — `admin.satarobo.vn/nhap-khach-hang`.
//
// 23/08/2026 DỜI VÀO ADMIN (đảo chốt 22/08 vốn để nó ở host public). Lý do:
// mục sidebar admin trỏ `/nhap-khach-hang` nên mỗi lần nhập là người dùng bị
// văng khỏi khung admin sang site khác rồi phải bấm quay lại.
//
// 🔴 Bất biến sống-còn của đợt này: **không được đá qua đá lại**. Public đá
// sang admin; nếu segment `nhap-khach-hang` thiếu trong `ADMIN_ROUTE_SEGMENTS`
// thì admin đá ngược về public → vòng lặp vô hạn. Test cuối khối khoá đúng đó.
// ─────────────────────────────────────────────────────────────────────────

describe("/nhap-khach-hang — biểu mẫu nội bộ, nay ở admin host", () => {
  it("admin host + nhân sự → PHỤC VỤ TẠI CHỖ (rewrite vào route group)", () => {
    for (const p of ["/nhap-khach-hang", "/nhap-khach-hang/"]) {
      expect(
        decideRoute({ hostKind: "admin", pathname: p, ...authed("MARKETING") }),
      ).toEqual<RouteDecision>({ type: "rewrite", path: "/admin" + p });
    }
  });

  it("🔴 admin host + chưa đăng nhập → /login kèm callbackUrl", () => {
    expect(
      decideRoute({
        hostKind: "admin",
        pathname: "/nhap-khach-hang",
        role: null,
        sessionValid: false,
      }),
    ).toEqual<RouteDecision>({
      type: "redirectPath",
      path: "/login",
      callbackUrl: "/nhap-khach-hang",
    });
  });

  it("phiên đã bị vô hiệu → /login kèm lý do", () => {
    expect(
      decideRoute({
        hostKind: "admin",
        pathname: "/nhap-khach-hang",
        role: "SALES_CSM",
        sessionValid: false,
      }),
    ).toEqual<RouteDecision>({
      type: "redirectPath",
      path: "/login",
      callbackUrl: "/nhap-khach-hang",
      reason: "session-invalidated",
    });
  });

  it("địa chỉ public CŨ → đá 307 sang admin (dấu trang + RedirectURL của MISA)", () => {
    for (const p of ["/nhap-khach-hang", "/nhap-khach-hang/"]) {
      // Đá VÔ ĐIỀU KIỆN: ai vào được là việc của nhánh admin, không nhân đôi cổng.
      expect(
        decideRoute({ hostKind: "public", pathname: p, ...authed("MARKETING") }),
      ).toEqual<RouteDecision>(TO_INTAKE);
      expect(
        decideRoute({ hostKind: "public", pathname: p, role: null, sessionValid: false }),
      ).toEqual<RouteDecision>(TO_INTAKE);
    }
  });

  it("PARENT lạc vào địa chỉ public cũ → về portal, không lảng vảng", () => {
    expect(
      decideRoute({ hostKind: "public", pathname: "/nhap-khach-hang", ...authed("PARENT") }),
    ).toEqual<RouteDecision>(TO_INTAKE);
    // Tới admin host thì nhánh admin đá tiếp về portal — cổng nằm ở MỘT chỗ.
    expect(
      decideRoute({ hostKind: "admin", pathname: "/nhap-khach-hang", ...authed("PARENT") }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "portal",
      path: "/",
      status: 307,
    });
  });

  it("host sale → 307 sang biểu mẫu của admin (site Sale đã gỡ)", () => {
    // ⚠️ ĐẢO KỲ VỌNG LẦN HAI. 23/08/2026 ca này từng đòi ở LẠI site Sale
    // (`/sale/nhap-khach-hang`) vì site đó đã có biểu mẫu riêng. Site gỡ hẳn
    // 22/09/2026 ⇒ quay về đích duy nhất còn lại là biểu mẫu bên admin.
    expect(
      decideRoute({
        hostKind: "sale",
        pathname: "/nhap-khach-hang",
        ...authed("SALES_CSM"),
      }),
    ).toEqual<RouteDecision>(TO_INTAKE);
  });

  it("host giáo viên / portal → về nhà của họ (không có quyền nhập lead)", () => {
    expect(
      decideRoute({
        hostKind: "teacher",
        teacherSiteEnabled: true,
        pathname: "/nhap-khach-hang",
        ...authed("TEACHER"),
      }),
    ).toEqual<RouteDecision>({ type: "redirectPath", path: "/" });
    expect(
      decideRoute({ hostKind: "portal", pathname: "/nhap-khach-hang", ...authed("PARENT") }),
    ).toEqual<RouteDecision>({ type: "redirectPath", path: "/" });
  });

  it("🔴 KHÔNG vòng lặp: đích của cú đá phải được admin host phục vụ tại chỗ", () => {
    // Đi đúng đường một người dùng thật đi: gõ địa chỉ public cũ → theo
    // Location → phải DỪNG ở admin, không bị đá tiếp. Thiếu segment
    // "nhap-khach-hang" trong ADMIN_ROUTE_SEGMENTS là hỏng đúng ở bước 2.
    const step1 = decideRoute({
      hostKind: "public",
      pathname: "/nhap-khach-hang",
      ...authed("SALES_CSM"),
    });
    expect(step1).toEqual<RouteDecision>(TO_INTAKE);

    const step2 = decideRoute({
      hostKind: "admin",
      pathname: step1.type === "redirectHost" ? step1.path : "",
      ...authed("SALES_CSM"),
    });
    expect(step2.type).toBe("rewrite");
    expect(step2).not.toMatchObject({ type: "redirectHost", host: "public" });
  });
});

describe("Invariants bảo mật", () => {
  it("PARENT KHÔNG bao giờ nhận rewrite vào /admin/*", () => {
    for (const p of ["/leads", "/dashboard", "/users", "/nhan-su", "/settings"]) {
      const d = decideRoute({ hostKind: "admin", pathname: p, ...authed("PARENT") });
      expect(d.type === "rewrite" && d.path.startsWith("/admin")).toBe(false);
    }
  });

  it("staff KHÔNG bao giờ nhận rewrite vào /portal/*", () => {
    for (const role of STAFF_ROLES) {
      for (const p of ["/lich-hoc", "/bai-tap", "/ho-so"]) {
        const d = decideRoute({ hostKind: "portal", pathname: p, ...authed(role) });
        expect(d.type === "rewrite" && d.path.startsWith("/portal")).toBe(false);
      }
    }
  });

  it("L5: role KHÔNG-TEACHER không bao giờ nhận rewrite vào /teacher/* (kể cả flag ON)", () => {
    const nonTeacher = [...STAFF_ROLES.filter((r) => r !== "TEACHER"), "PARENT"] as const;
    for (const role of nonTeacher) {
      for (const p of ["/", "/lich", "/teacher/lich"]) {
        for (const flag of [false, true]) {
          const d = decideRoute({
            hostKind: "teacher",
            pathname: p,
            ...authed(role),
            teacherSiteEnabled: flag,
          });
          expect(d.type === "rewrite" || d.type === "next").toBe(false);
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// H. /doi-mat-khau — trang đổi MK bắt buộc (BGĐ 31/07, mustChangePassword)
// ─────────────────────────────────────────────────────────────────────────

describe("H. /doi-mat-khau (đổi mật khẩu bắt buộc)", () => {
  it("admin host: staff đã login → next (phục vụ app/(auth)/doi-mat-khau)", () => {
    for (const role of STAFF_ROLES.filter((r) => r !== "TEACHER")) {
      expect(
        decideRoute({ hostKind: "admin", pathname: "/doi-mat-khau", ...authed(role) }),
      ).toEqual<RouteDecision>({ type: "next" });
    }
  });

  it("admin host: chưa login → /login (không leak trang)", () => {
    expect(
      decideRoute({
        hostKind: "admin",
        pathname: "/doi-mat-khau",
        role: null,
        sessionValid: false,
      }),
    ).toEqual<RouteDecision>({ type: "redirectPath", path: "/login", reason: undefined });
  });

  it("admin host: PARENT → đá về portal", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/doi-mat-khau", ...authed("PARENT") }),
    ).toEqual<RouteDecision>({ type: "redirectHost", host: "portal", path: "/", status: 307 });
  });

  it("teacher host (flag ON): TEACHER đã login → next, KHÔNG rewrite /teacher/*", () => {
    expect(
      decideRoute({
        hostKind: "teacher",
        pathname: "/doi-mat-khau",
        ...authed("TEACHER"),
        teacherSiteEnabled: true,
      }),
    ).toEqual<RouteDecision>({ type: "next" });
  });

  it("teacher host (flag ON): chưa login → /login", () => {
    expect(
      decideRoute({
        hostKind: "teacher",
        pathname: "/doi-mat-khau",
        role: null,
        sessionValid: false,
        teacherSiteEnabled: true,
      }),
    ).toEqual<RouteDecision>({ type: "redirectPath", path: "/login", reason: undefined });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AUTH-SĐT P6 — /quen-mat-khau là trang OTP CÔNG KHAI, luật y hệt /kich-hoat.
//
// Ba nhánh host trước đây chép riêng `pathname === "/kich-hoat"`; P6 gom vào
// `isPublicOtpPath()`. Bảng dưới chạy CẢ HAI path qua cùng bộ kỳ vọng — thêm màn
// OTP mới mà quên nối một nhánh host thì ca này đỏ ngay.
// ─────────────────────────────────────────────────────────────────────────

describe("P6. trang OTP công khai (/kich-hoat + /quen-mat-khau) — cùng một luật", () => {
  const OTP_PATHS = ["/kich-hoat", "/quen-mat-khau"] as const;

  for (const pathname of OTP_PATHS) {
    it(`${pathname}: ẩn danh vào được ở mọi host (không đá về /login)`, () => {
      for (const hostKind of ["public", "admin", "portal"] as const) {
        expect(
          decideRoute({ hostKind, pathname, role: null, sessionValid: false }),
        ).toEqual<RouteDecision>({ type: "next" });
      }
    });

    it(`${pathname}: PARENT đã login → về portal, không ở lại màn OTP`, () => {
      expect(
        decideRoute({ hostKind: "portal", pathname, ...authed("PARENT") }),
      ).toEqual<RouteDecision>({ type: "redirectPath", path: "/" });
      expect(
        decideRoute({ hostKind: "admin", pathname, ...authed("PARENT") }),
      ).toEqual<RouteDecision>({ type: "redirectHost", host: "portal", path: "/", status: 307 });
    });

    it(`${pathname}: staff đã login → về nhà admin`, () => {
      expect(
        decideRoute({ hostKind: "admin", pathname, ...authed("SUPER_ADMIN") }),
      ).toEqual<RouteDecision>({ type: "redirectPath", path: "/dashboard" });
    });
  }
});

/**
 * 10/08 — HỒI QUY: mọi cron chết im vì canonical 308 của nhánh `.vercel.app`.
 *
 * Vercel Cron gọi `satarobo-vn.vercel.app/api/cron/*`; nhánh 1 trong `proxy.ts` trả 308
 * sang host thật ⇒ handler không chạy, `Authorization: Bearer` rụng khi đổi host.
 * `proxy.ts` giờ chặn trước bằng `isInfraPath()`, nên hợp đồng của hàm này là chỗ khoá lại.
 */
describe("isInfraPath — đường hạ tầng KHÔNG được canonical-hoá", () => {
  for (const p of [
    "/api/cron/dispatch-events",
    "/api/cron/class-schedule-sync",
    "/api/public/webhook/sepay",
    "/api/auth/session",
    "/_next/data/x.json",
    "/monitoring",
    "/robots.txt",
    "/sitemap.xml",
  ]) {
    it(`${p} → infra`, () => expect(isInfraPath(p)).toBe(true));
  }

  for (const p of ["/", "/khoa-hoc", "/login", "/dashboard", "/apidocs", "/monitoringx"]) {
    it(`${p} → KHÔNG phải infra (vẫn canonical-hoá bình thường)`, () =>
      expect(isInfraPath(p)).toBe(false));
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Site Sale (`SALE_SITE_ENABLED`) — GỠ HẲN 22/09/2026.
//
// Khối test "cờ BẬT" cũ (site có đăng nhập, rewrite `/sale/*`, chiều ra trên admin)
// xoá cùng cờ. Host `sale.satarobo.vn` VẪN còn trong `HostKind` và vẫn được khoá
// bằng khối `describe("Sale host …")` phía trên: mọi đường đá 307 về biểu mẫu nhập
// khách ở admin, không trừ đường nào, không còn cờ nào đổi được hành vi đó.
// ─────────────────────────────────────────────────────────────────────────

// EL-01 — e-learning host (e-learning.satarobo.vn) × role × cờ ELEARNING_ENABLED.
// 2-phase như L5: cờ OFF = hành vi hiện tại y nguyên, 0 byte HTML e-learning.
//
// Khác teacher ở ĐÚNG MỘT chỗ: điều kiện vào là "không phải PARENT-thuần"
// (QĐ-7: EMP = mọi vai staff), không phải một vai cụ thể.
// ─────────────────────────────────────────────────────────────────────────

describe("EL-01. e-learning host × role — cờ OFF (mặc định)", () => {
  const OFF = { elearningEnabled: false } as const;

  it.each(STAFF_ROLES)("%s trên e-learning → bounce admin /dashboard", (role) => {
    expect(
      decideRoute({ hostKind: "elearning", pathname: "/", ...authed(role), ...OFF }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "admin",
      path: "/dashboard",
      status: 307,
    });
  });

  it("PARENT trên e-learning → bounce portal", () => {
    expect(
      decideRoute({ hostKind: "elearning", pathname: "/", ...authed("PARENT"), ...OFF }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "portal",
      path: "/",
      status: 307,
    });
  });

  it("cờ OFF: KHÔNG rewrite path nào — 0 byte HTML e-learning được phục vụ", () => {
    for (const p of ["/", "/khoa-hoc", "/bao-cao", "/elearning", "/elearning/x"]) {
      const d = decideRoute({
        hostKind: "elearning",
        pathname: p,
        ...authed("TRAINING"),
        ...OFF,
      });
      expect(d.type).not.toBe("rewrite");
      expect(d.type).not.toBe("next");
    }
  });
});

describe("EL-01. e-learning host × role — cờ ON", () => {
  const ON = { elearningEnabled: true } as const;

  it.each(STAFF_ROLES)("%s (vai staff bất kỳ) vào được — QĐ-7 EMP = mọi vai staff", (role) => {
    expect(
      decideRoute({ hostKind: "elearning", pathname: "/", ...authed(role), ...ON }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/elearning" });
  });

  it("PARENT-thuần → bounce portal (đào tạo nội bộ không dành cho phụ huynh)", () => {
    expect(
      decideRoute({ hostKind: "elearning", pathname: "/bao-cao", ...authed("PARENT"), ...ON }),
    ).toEqual<RouteDecision>({
      type: "redirectHost",
      host: "portal",
      path: "/",
      status: 307,
    });
  });

  it("chưa login → /login kèm callbackUrl", () => {
    expect(
      decideRoute({
        hostKind: "elearning",
        pathname: "/khoa-hoc/an-toan",
        role: null,
        sessionValid: false,
        ...ON,
      }),
    ).toEqual<RouteDecision>({
      type: "redirectPath",
      path: "/login",
      callbackUrl: "/khoa-hoc/an-toan",
      reason: undefined,
    });
  });

  it("clean URL được rewrite vào route group", () => {
    expect(
      decideRoute({ hostKind: "elearning", pathname: "/khoa-hoc", ...authed("TEACHER"), ...ON }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/elearning/khoa-hoc" });
  });

  it("path /elearning/* thật → next (không rewrite chồng)", () => {
    expect(
      decideRoute({ hostKind: "elearning", pathname: "/elearning/khoa-hoc", ...authed("HR"), ...ON }),
    ).toEqual<RouteDecision>({ type: "next" });
  });

  it.each(["/admin/leads", "/portal/ho-so", "/teacher/lich"])(
    "path lạc khu %s → về trang chủ e-learning",
    (p) => {
      expect(
        decideRoute({ hostKind: "elearning", pathname: p, ...authed("SALES_CSM"), ...ON }),
      ).toEqual<RouteDecision>({ type: "redirectPath", path: "/" });
    },
  );

  it("đã login vào /login → về trang chủ e-learning", () => {
    expect(
      decideRoute({ hostKind: "elearning", pathname: "/login", ...authed("TRAINING"), ...ON }),
    ).toEqual<RouteDecision>({ type: "redirectPath", path: "/" });
  });

  it("/doi-mat-khau phục vụ tại chỗ, KHÔNG rewrite", () => {
    expect(
      decideRoute({ hostKind: "elearning", pathname: "/doi-mat-khau", ...authed("TEACHER"), ...ON }),
    ).toEqual<RouteDecision>({ type: "next" });
  });

  it("infra path không bị auth", () => {
    expect(
      decideRoute({
        hostKind: "elearning",
        pathname: "/api/auth/session",
        role: null,
        sessionValid: false,
        ...ON,
      }),
    ).toEqual<RouteDecision>({ type: "next" });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// EL-01 · AC10 — kích thước PR1 (QĐ-CDA-13 BP-1).
//
// `lib/auth/route-policy.ts` là chỗ va chạm số một giữa e-learning (host thứ 6) và
// parity site giáo viên (host thứ 5): hai luồng sửa CÙNG hàm decideRoute() và CÙNG
// bảng test này. PR1 vì thế chỉ được chạm proxy.ts + route-policy.ts + test này
// (+ lib/flags.ts nếu cần) — route group, layout gate, lối vào đi PR sau.
//
// Quy tắc quy trình mà không có test thì tuần thứ ba sẽ có người gộp "cho tiện", nên
// nó phải chạy trong CI. Bất biến kiểm được KHÔNG cần git: PR1 chưa tạo route group.
// ─────────────────────────────────────────────────────────────────────────

describe("EL-01 · AC10. Bất biến cấu trúc khu e-learning", () => {
  // PR1 đã merge (case này từng khẳng định route group CHƯA tồn tại, và nó đã làm
  // đúng việc: đỏ ngay khi PR2 bắt đầu tạo thư mục). PR2 lật lại khẳng định — từ nay
  // route group PHẢI tồn tại, vì host thứ 6 rewrite vào đó; thiếu nó thì cờ ON cho 404.
  it("route group app/(elearning)/ tồn tại — đích rewrite của host thứ 6", async () => {
    const { existsSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const f of [
      "app/(elearning)/elearning/layout.tsx",
      "app/(elearning)/elearning/page.tsx",
    ]) {
      expect(existsSync(resolve(process.cwd(), f)), `thiếu ${f}`).toBe(true);
    }
  });

  it("proxy.ts và route-policy.ts nhất quán: mọi HostKind định tuyến đều có host thật", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const proxy = readFileSync(resolve(process.cwd(), "proxy.ts"), "utf8");
    // Mỗi kind xử lý ở BRANCH 2 phải có một dòng trong HOST_BY_KIND — thiếu thì
    // redirectHost ném undefined vào URL và người dùng rơi vào vòng lặp câm.
    for (const kind of ["admin", "portal", "public", "teacher", "elearning"]) {
      expect(proxy, `HOST_BY_KIND thiếu "${kind}"`).toContain(`${kind}:`);
    }
  });

  it("nhánh /elearning trên localhost nằm ở BRANCH 3, KHÔNG lọt vào BRANCH 1", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const proxy = readFileSync(resolve(process.cwd(), "proxy.ts"), "utf8");

    const branch1 = proxy.indexOf("BRANCH 1:");
    const branch3 = proxy.indexOf("BRANCH 3:");
    const teacher = proxy.indexOf("isTeacherPath(pathname)");
    const elearning = proxy.indexOf("isElearningPath(pathname)");

    expect(branch1).toBeGreaterThan(-1);
    expect(branch3).toBeGreaterThan(branch1);
    expect(teacher).toBeGreaterThan(branch3);

    // BUG THẬT đã xảy ra ở PR1 và lọt qua merge: khối này bị đặt trong BRANCH 1
    // (`kind === "vercel" && NODE_ENV === "production"`) nên chỉ sống ở preview
    // deployment. Hậu quả trên localhost và mọi host thật: `/elearning` rơi xuống
    // nhánh cuối, bị đá về `/login` MẤT `callbackUrl` — đăng nhập xong văng ra
    // trang chủ. Không có lỗi, không có log; e2e bắt được nhờ đòi `callbackUrl`.
    // Guard này rẻ hơn nhiều so với lần truy vết tiếp theo.
    expect(
      elearning,
      "isElearningPath phải nằm SAU mốc BRANCH 3 — đặt trong BRANCH 1 là nhánh chết",
    ).toBeGreaterThan(branch3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sale THUẦN trên admin host — 22/09/2026 KHÔNG CÒN LUẬT RIÊNG
// ─────────────────────────────────────────────────────────────────────────────
// Trước đây có "chiều ra": tư vấn viên thuần mở admin.satarobo.vn thì bị 307 sang
// site Sale. Site đã gỡ ⇒ luật đó phải gỡ theo, không thì họ bị đá sang một host
// chỉ biết đá ngược về admin — vòng lặp.
describe("Sale THUẦN trên admin host → Ở LẠI admin (site Sale đã gỡ)", () => {
  it("Sale thuần vào admin host → phục vụ tại chỗ, KHÔNG đá đi đâu", () => {
    expect(
      decideRoute({ hostKind: "admin", pathname: "/leads", ...authed("SALES_CSM") }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/admin/leads" });
  });

  it("🔴 KHÔNG còn nhánh nào trả `host: \"sale\"` — đó là vòng lặp chuyển hướng", () => {
    for (const pathname of ["/", "/leads", "/dashboard", "/tra-cuu"]) {
      for (const roles of [["SALES_CSM"], ["SALES_CSM", "PARENT"], ["CENTER_MANAGER", "SALES_CSM"]] as const) {
        const d = decideRoute({
          hostKind: "admin",
          pathname,
          role: roles[0],
          roles: [...roles],
          sessionValid: true,
        });
        expect(d.type === "redirectHost" && d.host === "sale", `${pathname} · ${roles.join("+")}`).toBe(false);
      }
    }
  });

  it("kiêm nhiệm vẫn làm việc bình thường trên admin", () => {
    expect(
      decideRoute({
        hostKind: "admin",
        pathname: "/leads",
        role: "CENTER_MANAGER",
        roles: ["CENTER_MANAGER", "SALES_CSM"],
        sessionValid: true,
      }),
    ).toEqual<RouteDecision>({ type: "rewrite", path: "/admin/leads" });
  });
});

/**
 * Phương án B (27/09/2026) — kênh realtime chat SSE `/api/chat/stream` phải tới được handler
 * trên MỌI host có chat (admin, portal hocvien, site GV giaovien), với mọi vai và cả khi chưa
 * đăng nhập (handler tự trả 401 — proxy không được đá 30x, EventSource không theo redirect
 * sang host khác). Không sửa `decideRoute`: `/api/*` vốn là infra — test này khoá hợp đồng đó.
 */
describe("Phương án B — /api/chat/stream + /api/chat/realtime-token đi thẳng tới handler", () => {
  const PATHS = ["/api/chat/stream", "/api/chat/realtime-token"];
  const HOSTS = ["admin", "portal", "teacher"] as const;
  for (const pathname of PATHS) {
    it(`${pathname} là infra path`, () => expect(isInfraPath(pathname)).toBe(true));
    for (const hostKind of HOSTS) {
      for (const role of [null, "PARENT", "TEACHER", "SUPER_ADMIN"] as const) {
        it(`${hostKind} × ${role ?? "chưa login"} → next`, () => {
          expect(
            decideRoute({
              hostKind,
              pathname,
              role,
              sessionValid: role !== null,
              teacherSiteEnabled: true,
            }),
          ).toEqual<RouteDecision>({ type: "next" });
        });
      }
    }
  }
});

/**
 * [POS4-RT-01] GĐ4 POS (07/10/2026) — bốn endpoint của máy đồng bộ POS Agent (`/api/pos-agent/*`) phải tới
 * được handler trên MỌI host, với mọi vai và cả khi CHƯA đăng nhập: extension ký HMAC, không mang phiên
 * NextAuth — proxy mà đá 302/308 theo vai thì chữ ký sai path và agent chết câm. Không sửa `decideRoute`:
 * `/api/*` vốn là infra (`isInfraPath`) — ca này KHOÁ hợp đồng đó (khuôn ca SSE ngay trên).
 */
describe("[POS4-RT-01] /api/pos-agent/* đi thẳng tới handler ở mọi host × vai", () => {
  const PATHS = ["/api/pos-agent/heartbeat", "/api/pos-agent/status", "/api/pos-agent/jobs", "/api/pos-agent/transactions"];
  const HOSTS = ["admin", "public", "portal", "teacher"] as const;
  for (const pathname of PATHS) {
    it(`${pathname} là infra path`, () => expect(isInfraPath(pathname)).toBe(true));
    for (const hostKind of HOSTS) {
      for (const role of [null, "PARENT", "TEACHER", "SUPER_ADMIN"] as const) {
        it(`${hostKind} × ${role ?? "chưa login"} → next`, () => {
          expect(
            decideRoute({
              hostKind,
              pathname,
              role,
              sessionValid: role !== null,
              teacherSiteEnabled: true,
            }),
          ).toEqual<RouteDecision>({ type: "next" });
        });
      }
    }
  }
});
