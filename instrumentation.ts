// Next.js 16 instrumentation hook — runs once at server startup.
// Loads Sentry server/edge configs based on runtime.
// Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }

  // Nền Hệ thống P3 · US-12 — cắm nơi nhận cho pha shadow của resolver dataScope.
  //
  // CHỈ trên runtime nodejs: nơi nhận ghi Prisma, mà edge thì không có. Không cắm ở
  // edge nghĩa là đường chạy edge không đóng góp số liệu shadow — chấp nhận được vì
  // các kiểm quyền theo đơn vị đều nằm ở Server Action / route handler (nodejs).
  //
  // Import ĐỘNG và sau cờ: môi trường chưa áp migration P3 sẽ không nạp module đụng
  // bảng `ScopeShadowDiff`, và bundle của các route không bị kéo thêm gì khi cờ tắt.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SCOPE_SHADOW_ENABLED === "true") {
    const [{ datScopeShadowSink }, { ghiScopeShadow }] = await Promise.all([
      import("./lib/permissions/scope-shadow-sink"),
      import("./lib/permissions/scope-shadow-report"),
    ]);
    datScopeShadowSink((actor, permissionKey, target) => {
      // Không await: `can()` là hàm đồng bộ và không được chờ một phép ghi log.
      void ghiScopeShadow({ actor, permissionKey, target });
    });
  }
}

// Capture errors from React Server Components + Route Handlers.
// Sentry v10 renamed the export to `captureRequestError`; alias to match
// Next.js 16 instrumentation contract.
export { captureRequestError as onRequestError } from "@sentry/nextjs";
