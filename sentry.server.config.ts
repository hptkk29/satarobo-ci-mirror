// Sentry server-side init (Node runtime — pages/api, app router server actions, RSC).
// Docs: https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { cheSauBiMat } from "./lib/observability/che-bi-mat";
import { locBreadcrumbSentry, locSuKienSentry } from "./lib/security/che-bi-mat";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
// Che bí mật (`?secret=` / header `x-webhook-secret` của webhook, `x-api-key`, `?apiKey=`...)
// ở MỌI đường ra: lỗi, giao dịch, span, breadcrumb — xem lib/observability/che-bi-mat.ts.

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // Don't send detailed Prisma queries with PII to Sentry
    sendDefaultPii: false,
    integrations: [
      // Capture HTTP errors from outgoing fetch (Resend, Meta CAPI, GA4 MP).
      // (Sentry v10+ tự auto-trace HTTP — không cần option `tracing`.)
      Sentry.httpIntegration(),
      // Prisma integration auto-instruments query spans
      // Sentry.prismaIntegration() — enable manually if needed
    ],
    beforeSend(event) {
      // Strip cookies + auth headers from server events
      if (event.request) {
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers["authorization"];
          delete event.request.headers["cookie"];
        }
      }
      // Hai bộ che chạy NỐI TIẾP, không thay nhau: bộ che webhook (secret webhook, x-api-key) rồi bộ che chung
      // (Bearer/Basic, tham số OAuth, khoá nhạy cảm theo tên — lib/security/che-bi-mat.ts).
      return locSuKienSentry(cheSauBiMat(event));
    },
    beforeSendTransaction(event) {
      return cheSauBiMat(event);
    },
    beforeSendSpan(span) {
      return cheSauBiMat(span);
    },
    beforeBreadcrumb(breadcrumb) {
      return locBreadcrumbSentry(cheSauBiMat(breadcrumb));
    },
  });
}
