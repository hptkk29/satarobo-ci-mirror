// lib/security/nen-tang.ts — app đang chạy trên nền tảng NÀO. THUẦN, không import gì.
//
// MỘT chỗ trả lời câu hỏi này cho CẢ APP: IP khách làm khoá chặn tần suất + IP ghi nhật ký
// (`lib/security/client-ip.ts`) và IP nguồn fail-closed cho allowlist IP
// (`lib/security/ip-nguon-tin-cay.ts`). Sinh ra ở Cổng dữ liệu agent 28/09/2026 (cổng đã gỡ
// 02/10/2026), dời về đây cùng ngày khi phát hiện `client-ip.ts` còn tự hỏi theo kiểu thời Vercel — tức hỏi CHÍNH KHÁCH có gửi
// `x-vercel-forwarded-for` không.
//
// Trước đó các chỗ tự hỏi "`VERCEL === "1" || VERCEL_ENV`" — đúng khi prod còn ở Vercel, SAI kể
// từ khi chuyển sang VPS:
//
//   · Prod VPS VẪN đặt `VERCEL_ENV=production` (app/robots.ts + cookie SSO đọc nó —
//     docs/VPS-CHUYEN-HA-TANG.md), nên "có VERCEL_ENV" không còn nghĩa "đang ở Vercel".
//   · Env test của VPS có thể thiếu VERCEL_ENV ⇒ rơi nhánh "máy dev" ⇒ TIN `x-e2e-client-ip` —
//     header khách tự gửi, Caddy để nguyên ⇒ ai cũng giả được IP.
//
// Dấu hiệu dùng:
//   · `VERCEL=1` — Vercel đặt lúc chạy; VPS không đặt (deploy/.env.example không có nó).
//   · `NODE_ENV=production` và KHÔNG `CI` — `next start` trên máy chủ thật (Dockerfile đặt
//     NODE_ENV=production). Vế `!CI` giữ cho job E2E của CI (cũng `next start`) còn mô phỏng được
//     nhiều IP bằng `x-e2e-client-ip` (cùng khuôn `laProductionThat` ở client-ip.ts).
//
// ⚠️ Mặc định an toàn là "sau-proxy": thêm một nền tảng mới mà quên khai thì app chỉ tin phần tử
// cuối của XFF — tức từ chối nhiều hơn, không mở thêm.

type Env = Record<string, string | undefined>;

export type NenTang =
  /** Vercel: nền tảng đặt `x-vercel-forwarded-for` và GỠ mọi header `x-vercel-*` của khách. */
  | "vercel"
  /**
   * Máy chủ tự vận hành sau ĐÚNG MỘT proxy tin được (VPS: Caddy → app; app không mở cổng ra ngoài).
   * Proxy đặt IP khách vào CUỐI `X-Forwarded-For` và đặt `X-Forwarded-Proto`. Mọi header khác
   * (kể cả `x-vercel-forwarded-for`, `x-real-ip`, `x-e2e-client-ip`) là KHÁCH tự gửi.
   */
  | "sau-proxy"
  /** Máy dev, vitest, job CI — cho phép `x-e2e-client-ip` và http. */
  | "may-dev";

export function nenTangDangChay(env: Env = process.env): NenTang {
  if (env.VERCEL === "1") return "vercel";
  if (env.NODE_ENV === "production" && !env.CI) return "sau-proxy";
  return "may-dev";
}
