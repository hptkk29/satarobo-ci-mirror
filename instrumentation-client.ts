// Sentry client-side init.
// Next.js 16 + Turbopack auto-loads this file (renamed from
// sentry.client.config.ts per Sentry v10+ contract).
// Docs: https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { cheSauBiMat } from "./lib/observability/che-bi-mat";
import { locBreadcrumbSentry, locSuKienSentry } from "./lib/security/che-bi-mat";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // Sample 10% of regular traces. Increase if traffic is low; decrease if billing cap.
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // Replay always for errors, 10% sessions for general UX investigation
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    integrations: [
      // SEC-M09: mask toàn bộ text + block media trong Session Replay — chống lộ PII
      // học sinh (vị thành niên)/SĐT-email PH/công nợ lên Sentry. Replay-on-error VẪN
      // capture để chẩn đoán (chỉ nội dung PII bị ẩn, không tắt hẳn replay).
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    // Don't capture noise we can't act on
    ignoreErrors: [
      // Browser extensions / network noise
      "ResizeObserver loop limit exceeded",
      "Non-Error promise rejection captured",
      "Network request failed",
      "Failed to fetch",
      // Common AdBlock/extension errors
      /chrome-extension/,
      /moz-extension/,
    ],
    beforeSend(event, hint) {
      // Strip PII from URL params if present (e.g. `phone=...`)
      if (event.request?.url) {
        try {
          const url = new URL(event.request.url);
          ["phone", "email", "parentName", "childName"].forEach((p) => {
            if (url.searchParams.has(p)) url.searchParams.set(p, "[REDACTED]");
          });
          event.request.url = url.toString();
        } catch {
          // Ignore parse errors
        }
      }
      // Hai bộ che NỐI TIẾP: bộ che chung (Bearer/Basic, `code=` OAuth trên URL —
      // lib/security/che-bi-mat.ts) rồi bộ che webhook (`?secret=`, `?apiKey=`, `token=`,
      // `Bearer …`; không truyền giá trị env — bí mật server không có trong bundle).
      return locSuKienSentry(cheSauBiMat(event));
    },
    beforeBreadcrumb(breadcrumb) {
      return locBreadcrumbSentry(cheSauBiMat(breadcrumb));
    },
  });
}

// Required for App Router navigation tracing
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
