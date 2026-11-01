// .dependency-cruiser.cjs — Architecture governance cho Sata Robo VN
// Rule theo Doc 15 §4.10 (Governance & CI Enforcement) + ticket A0-04.
// Severity: 'error' = chặn CI; 'warn' = nhắc nhở; 'info' = thống kê.
// Chạy:  pnpm depcruise           (report — exit !=0 nếu có lỗi severity 'error')
//        pnpm lint:boundaries     (dùng trong CI)
// Docs: https://github.com/sverweij/dependency-cruiser

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    /* ───────────── Rule phổ quát (an toàn — bật 'error' ngay) ───────────── */
    {
      name: "no-circular",
      severity: "error",
      comment: "Cấm import vòng (A→B→A) — gây khó test, khó tách module.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-unresolvable",
      severity: "error",
      comment: "Import trỏ tới module không tồn tại (gõ sai path/alias).",
      from: {},
      to: {
        couldNotResolve: true,
        // Loại marker ảo của Next.js (không có module thật để resolve).
        pathNot: "^(server-only|client-only)$",
      },
    },
    {
      name: "not-to-test",
      severity: "error",
      comment: "Code production KHÔNG được import file test.",
      from: { pathNot: "\\.(spec|test)\\.[jt]sx?$|^tests/" },
      to: { path: "\\.(spec|test)\\.[jt]sx?$|^tests/" },
    },
    {
      name: "no-deprecated-core",
      severity: "warn",
      comment: "Đang dùng Node core API deprecated.",
      from: {},
      to: { dependencyTypes: ["core"], path: "^(punycode|domain|sys|_linklist|constants)$" },
    },

    /* ───────────── Doc 15 §4.10 — Boundary kiến trúc đích ─────────────
       Hiện 'warn' vì codebase as-is chưa có scopedDb/modules; sau khi A0-04
       (scopedDb) + modules/* hoàn tất → đổi sang 'error'. Xem ghi chú từng rule. */
    {
      name: "app-no-direct-prisma",
      // #04 (08/07): GIỮ 'warn' có chủ đích — KHÔNG flip 'error'. Enforcement CHÍNH XÁC
      // do ESLint lo (eslint.config.mjs + lib/eslint/db-import-allowlist.mjs: error-level,
      // phủ app/(admin|portal|teacher) + allowlist 25 exception hợp lệ đã có comment lý do).
      // Rule depcruise này khớp THÔ mọi ^app/ → lib/db.ts (gồm Loại C public/api/(auth)/cron/
      // OG legit import db không actor) nên 'error' sẽ false-positive; để 'warn' làm tín hiệu
      // kiến trúc, ESLint mới là cổng chặn.
      severity: "warn",
      comment:
        "app/** KHÔNG import @/lib/db trực tiếp — phải đi qua scopedDb(actor) (Doc 15 §4.4/§4.10). Enforcement chính xác: ESLint allowlist (25 exception). Đây là cảnh báo thô.",
      from: { path: "^app/" },
      to: { path: "^lib/db\\.ts$" },
    },
    {
      // Spec tích hợp §2.1 PA-1 — adapter nhà cung cấp sống ở `lib/integrations/<vendor>/`
      // (đúng cách `lib/zalo/` đang tổ chức), và MÀN HÌNH KHÔNG ĐƯỢC GỌI THẲNG NÓ.
      //
      // Gộp 27/08: trục gọi điện và hộp thư đa kênh dựng cùng ngày, mỗi bên tự thêm
      // một luật y hệt nhau với tên khác. Giữ MỘT luật — vùng chặn lấy bản rộng hơn
      // (`components/` cũng không được gọi thẳng), mẫu khớp lấy bản chính xác hơn
      // (neo đuôi tệp, để `provider-types.ts` kiểu mặt tiền công khai không bị chặn oan).
      //
      // Vì sao gọi thẳng là hỏng: bỏ qua tầng nghiệp vụ (`lib/inbox/send.ts`) tức bỏ giành-chỗ-PENDING (bấm hai lần là khách nhận hai tin)
      // và bỏ luật "chỉ gửi THÀNH CÔNG mới tính là đã trả lời" (tắt nhầm đồng hồ
      // chăm sóc). Cả hai đều là lỗi im lặng.
      //
      // Vì sao để 'error' ngay trong khi luật `modules/*` bên dưới vẫn là no-op: luật
      // này khớp một cây thư mục CÓ THẬT, nên nó không thể báo oan lên mã cũ.
      //
      // `lib/integrations/registry` và `lib/integrations/types` KHÔNG bị chặn — đó là
      // mặt tiền công khai (trạng thái kênh, nhãn lý do) mà giao diện cần để nói thật.
      name: "app-no-direct-vendor-adapter",
      severity: "error",
      comment:
        "app/** và components/** KHÔNG import thẳng lib/integrations/<vendor>/provider — " +
        "đi qua tầng nghiệp vụ (lib/inbox/send.ts). Đổi nhà cung cấp phải chỉ đụng 1 tệp.",
      from: { path: "^(app|components)/" },
      to: { path: "^lib/integrations/[^/]+/provider\.[jt]s$" },
    },
    {
      name: "module-no-deep-cross-import",
      severity: "error",
      comment:
        "modules/A KHÔNG import sâu vào modules/B — chỉ qua public API (modules/B hoặc modules/B/index). (No-op tới khi có modules/*)",
      from: { path: "^modules/([^/]+)/" },
      to: {
        path: "^modules/([^/]+)/.+",
        pathNot: "^modules/([^/]+)/index\\.[jt]s$",
        // chỉ chặn khi khác module (B != A)
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "only-integration-calls-external",
      severity: "warn",
      comment:
        "Chỉ modules/integration được gọi provider ngoài (Resend/Zalo/MISA/Meta/Upstash/AWS...). Module nghiệp vụ phải đi qua adapter. (No-op tới khi có modules/*)",
      from: { path: "^modules/(?!integration/)" },
      to: {
        path: "node_modules/(resend|@upstash|@aws-sdk|nodemailer|axios|node-fetch|@sentry)",
        dependencyTypes: ["npm"],
      },
    },
    {
      name: "reporting-no-write-back",
      severity: "warn",
      comment:
        "modules/reporting chỉ ĐỌC — không import service ghi của module khác (không là source-of-truth). (No-op tới khi có modules/*)",
      from: { path: "^modules/reporting/" },
      to: { path: "^modules/(?!reporting/)[^/]+/(service|repository|actions)" },
    },
  ],

  options: {
    doNotFollow: { path: "node_modules" },
    // Resolve alias @/* → ./* qua tsconfig.
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
    },
    // Bỏ qua file không phải nguồn khi quét.
    exclude: { path: "node_modules|\\.next/|^(coverage|playwright-report|test-results)/|\\.d\\.ts$" },
    reporterOptions: {
      dot: { collapsePattern: "node_modules/(@[^/]+/[^/]+|[^/]+)" },
      archi: {
        collapsePattern:
          "^(app|components|lib|modules)/[^/]+|^node_modules/(@[^/]+/[^/]+|[^/]+)",
      },
    },
  },
};
