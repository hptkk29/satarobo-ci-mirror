// Sentry edge runtime init — for middleware (proxy.ts) + edge routes.
// Limited Sentry features in edge runtime.
// Docs: https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { cheSauBiMat } from "./lib/observability/che-bi-mat";
import { locBreadcrumbSentry, locSuKienSentry } from "./lib/security/che-bi-mat";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
// Che bí mật ở mọi đường ra — cùng bộ che với server (lib/observability/che-bi-mat.ts).

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.05 : 1.0,
    // proxy.ts thấy header Authorization của mọi lượt gọi API — che trước khi gửi.
    // Hai bộ che chạy NỐI TIẾP: bộ che webhook rồi bộ che chung (Bearer/Basic, tham số OAuth).
    beforeSend(event) {
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
