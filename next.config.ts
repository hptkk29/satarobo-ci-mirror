import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// SEC-H02 — security headers (áp cho MỌI response).
// X-Frame-Options = SAMEORIGIN (KHÔNG DENY): SCORM player nhúng /api/scorm/asset trong iframe cùng origin.
// Permissions-Policy: geolocation=(self) BẮT BUỘC giữ — QR điểm danh GV dùng GPS.
// CSP để Content-Security-Policy-Report-Only (chỉ thu vi phạm, KHÔNG chặn) — tune + enforce ở đợt S2.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://cdn.satarobo.vn https://*.r2.cloudflarestorage.com https://images.unsplash.com https://img.youtube.com https://www.google-analytics.com https://www.facebook.com",
  "font-src 'self' data:",
  "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://www.facebook.com",
  // S1 (tích hợp ZaloCRM 06/09/2026) — `https://zalo.satarobo.vn` là giao diện fork
  // ZaloCRM nhúng ở màn /zalo-crm.
  //
  // ⚠️ Khai dòng này KHÔNG làm iframe chạy được, và bỏ nó cũng không làm iframe chết:
  // header dưới đây đang gửi dưới tên `Content-Security-Policy-Report-Only` nên nó KHÔNG
  // chặn gì. Thứ chặn thật là header của CHÍNH ZaloCRM (`frame-ancestors 'none'` +
  // `X-Frame-Options: DENY`) — nới nó là việc F3 bên repo fork. Sửa ở đây là để hồ sơ
  // đúng và để màn không chết vào ngày bật enforce (đợt S2).
  // ⚠️ Host này cố ý KHÔNG được thêm vào `connect-src`: trình duyệt không gọi thẳng API
  // ZaloCRM: mọi lượt gọi đi server→server qua `ZALOCRM_BASE_URL`.
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://zalo.satarobo.vn",
  // EL-07 (C21) — video đào tạo nội bộ phát qua `https://*.r2.cloudflarestorage.com`
  // (đường ký, private). Host đó ĐÃ nằm trong danh sách nên GĐ2 không phải sửa dòng này.
  //
  // ⚠️ Hai điều phải nhớ khi tới GĐ2:
  //  1. Header đang là `Content-Security-Policy-Report-Only` (xem dòng khai bên dưới) —
  //     nên sai host CHỈ hiện trong console, không chặn. Ngày bật enforce là ngày video
  //     chết nếu quên. AC7 của EL-07 bắt thử enforce cục bộ ngay trong PR nền.
  //  2. Video đào tạo nội bộ KHÔNG BAO GIỜ nằm trong bucket gắn `cdn.satarobo.vn` —
  //     đó là bucket CÔNG KHAI. Nằm ở đó thì hình mờ động, chặn tua, giới hạn tốc độ và
  //     toàn bộ cơ chế chống học đối phó của GĐ2 chỉ là trang trí: ai có link là tải được.
  "media-src 'self' https://cdn.satarobo.vn https://*.r2.cloudflarestorage.com",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), browsing-topics=()" },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

const nextConfig: NextConfig = {
  // VPS (docker): gói server tối thiểu `.next/standalone` cho image chạy `node server.js`.
  // Vercel bỏ qua trường này nên hai nơi deploy dùng chung một config.
  output: "standalone",

  // Bỏ pass TypeScript bên trong `next build` — CHỈ khi CI job Quality đặt
  // `CI_BO_TS_TRONG_BUILD=1` (09/10/2026). Job đó vừa chạy `pnpm typecheck` ngay trước và
  // phải xanh mới tới bước build, nên pass thứ hai là VIỆC LÀM LẠI — và chính nó là thứ chạm
  // trần heap ~4 GB rồi OOM (PR #420, xem chú thích bước Build trong `ci.yml`).
  // Máy dev và `deploy-vps.yml` KHÔNG đặt cờ ⇒ build ở đó vẫn typecheck như cũ.
  typescript: { ignoreBuildErrors: process.env.CI_BO_TS_TRONG_BUILD === "1" },

  // Route tải file mẫu import lead ĐỌC file soạn tay trong public/ bằng fs → phải ép
  // đóng gói file đó vào bundle serverless (public/ mặc định chỉ lên CDN, lambda không có).
  outputFileTracingIncludes: {
    "/api/admin/templates/leads": ["./public/templates/mau-lead-v2.xlsx"],
  },

  // DEV-ONLY (Next 16 chặn cross-origin tới dev server theo mặc định): cho phép
  // đăng nhập đa phiên khi QA — admin ở localhost, GV ở 127.0.0.1, PH ở IP LAN
  // (cookie tách theo host). Không ảnh hưởng production build.
  allowedDevOrigins: ["127.0.0.1", "192.168.98.183"],

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.satarobo.vn",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.r2.cloudflarestorage.com",
        pathname: "/**",
      },
      // YouTube thumbnails used in testimonials
      {
        protocol: "https",
        hostname: "img.youtube.com",
        pathname: "/vi/**",
      },
    ],
  },

  // 301 redirects:
  //   1) From old domains laptrinhrobot.vn / luyenthirobosim.vn → new no-hyphen slugs
  //   2) From legacy SP1-4 + hyphenated course paths → new slugs (Phase 4.UI.FIX.1)
  async redirects() {
    return [
      // ─── Old domains (Phase 1 marketing sites) ──────────────────────────
      {
        source: "/:path*",
        has: [{ type: "host", value: "laptrinhrobot.vn" }],
        destination: "https://satarobo.vn/khoa-hoc/laptrinhrobot/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.laptrinhrobot.vn" }],
        destination: "https://satarobo.vn/khoa-hoc/laptrinhrobot/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "luyenthirobosim.vn" }],
        destination: "https://satarobo.vn/khoa-hoc/luyenthirobosim/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.luyenthirobosim.vn" }],
        destination: "https://satarobo.vn/khoa-hoc/luyenthirobosim/:path*",
        permanent: true,
      },
      // ─── Legacy in-domain slugs → 2 khoá học chính ──────────────────────
      // SP1 (RoboSim Online) + SP2 (Robotics Offline) → Lập trình Robot
      // SP3 (Sata Inno School) + SP4 (SATAGO) → /khoa-hoc overview (đã ngừng)
      // Hyphenated legacy slugs → no-hyphen mới
      { source: "/khoa-hoc/sp1", destination: "/khoa-hoc/luyenthirobosim", permanent: true },
      { source: "/khoa-hoc/sp2", destination: "/khoa-hoc/laptrinhrobot", permanent: true },
      { source: "/khoa-hoc/sp3", destination: "/khoa-hoc", permanent: true },
      { source: "/khoa-hoc/sp4", destination: "/khoa-hoc", permanent: true },
      { source: "/khoa-hoc/lap-trinh-robot", destination: "/khoa-hoc/laptrinhrobot", permanent: true },
      { source: "/khoa-hoc/luyen-thi-robosim", destination: "/khoa-hoc/luyenthirobosim", permanent: true },
      // Old blog slugs đã đổi
      { source: "/tin-tuc/sata-inno-school-giai-phap-stem-truong-hoc", destination: "/tin-tuc", permanent: true },
      { source: "/tin-tuc/satago-du-lich-giao-duc-stem", destination: "/tin-tuc", permanent: true },
    ];
  },
};

const sentryWebpackPluginOptions = {
  // Suppress Sentry plugin output in build log (errors still surface).
  silent: true,

  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Tunnel route to bypass ad-blockers (Sentry events go through /monitoring)
  tunnelRoute: "/monitoring",

  // Hide source maps from public bundle output
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },

  // Disable Sentry logger to reduce bundle size in production
  disableLogger: true,

  // Automatically tree-shake Sentry logger statements
  reactComponentAnnotation: {
    enabled: true,
  },
};

export default withSentryConfig(nextConfig, sentryWebpackPluginOptions);
