// lib/security/client-ip.ts — IP DÙNG LÀM KHOÁ CHẶN TẦN SUẤT. Thuần, không chạm DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// VẤN ĐỀ  [chủ dự án nêu 21/09/2026]
//
//   *"lib/auth.ts lấy IP cho rate limit từ đâu? Nếu từ X-Forwarded-For (hoặc header client
//   gửi được) thì trên prod kẻ dò mật khẩu cũng tự đổi IP được → cổng IP vô dụng."*
//
// Bản cũ (`lib/auth.ts:51`) lấy **phần tử ĐẦU** của `x-forwarded-for`:
//
//     const xff = request?.headers?.get("x-forwarded-for");
//     if (xff) return xff.split(",")[0]!.trim();
//
// Đầu chuỗi XFF là đầu do CLIENT viết. Quy ước XFF là mỗi proxy **nối thêm vào CUỐI**, nên
// phần tử đầu là thứ xa nhất và ít đáng tin nhất — nếu nền tảng nối thay vì ghi đè thì
// `X-Forwarded-For: 1.2.3.4` do kẻ tấn công tự chèn sẽ thành khoá, và **mỗi request một
// khoá khác nhau** ⇒ trần 10 lượt/phút không bao giờ chạm tới.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO KHÔNG ĐI ĐO HÀNH VI CỦA VERCEL TRƯỚC — và vì sao không cần
//
// Tôi **không đo được** "Vercel ghi đè hay nối thêm `x-forwarded-for`" một cách không xâm
// lấn: không endpoint nào của repo trả lại IP mà nó thấy (`grep x-vercel` ra 0 kết quả),
// và cổng chặn đăng nhập **im lặng theo thiết kế** — bị chặn hay sai mật khẩu đều trả
// `null` y hệt, nên nó không dùng làm oracle được. Oracle duy nhất còn lại là trần của
// `/api/leads`, mà nó chỉ đếm SAU khi payload hợp lệ ⇒ đo là đẻ lead rác thật.
//
// Nên bản vá này **đúng dưới CẢ HAI hành vi**, và đó là điều đáng giá hơn một phép đo:
//
//   · nếu Vercel GHI ĐÈ   → chuỗi chỉ có IP thật     → phần tử cuối = IP thật ✅
//   · nếu Vercel NỐI THÊM → `<giả>, <thật>`          → phần tử cuối = IP thật ✅
//
// Lấy phần tử **CUỐI** là phép phòng thủ chuẩn khi biết chắc có đúng một proxy tin được
// đứng ngay trước mình — và trên Vercel thì đúng là vậy.
//
// Ưu tiên số một vẫn là `x-vercel-forwarded-for`: Vercel **gỡ** mọi header `x-vercel-*` do
// client gửi trước khi gọi hàm, nên đó là thứ client không chạm được.
//
// ⚠️ KHÔNG fail-closed về một khoá chung. Cám dỗ là "không có header tin được thì trả
// hằng số" — nhưng như vậy CẢ CÔNG TY dùng chung một trần 10 lượt/phút, và 8 giờ sáng thứ
// Hai là tự khoá cửa chính mình. Ở đây fail-closed hại hơn fail-open.
//
// ─────────────────────────────────────────────────────────────────────────────
// 28/09/2026 — PROD CHUYỂN SANG VPS SAU CADDY: "tin `x-vercel-forwarded-for` trước tiên" THÀNH LỖ
//
// Lý lẽ của bậc số một ở trên ("Vercel GỠ `x-vercel-*` của khách") chỉ đúng KHI ĐANG Ở VERCEL.
// Trên VPS không ai gỡ nó: Caddy để NGUYÊN mọi header khách gửi, chỉ đặt IP khách vào CUỐI
// `X-Forwarded-For` (deploy/Caddyfile, khối `proxy_app` — không `header_up X-Real-IP`). Bản cũ
// đọc header đó VÔ ĐIỀU KIỆN ⇒ kẻ dò mật khẩu gửi `x-vercel-forwarded-for: <số ngẫu nhiên>`
// mỗi lượt ⇒ mỗi lượt một khoá ⇒ đúng cái lỗ mà khối đầu tệp này sinh ra để vá. Cùng lúc
// `x-e2e-client-ip` mở cho test.satarobo.vn (env test có thể đặt VERCEL_ENV=test ⇒
// `laProductionThat` = false) và `x-real-ip` thành khoá khi thiếu XFF.
//
// Nay luật chọn header đi theo NỀN TẢNG (`lib/security/nen-tang.ts` — cùng một câu trả lời với
// `ip-nguon-tin-cay.ts`), không theo việc header có mặt hay không:
//   · vercel    → như cũ (header nền tảng → cửa E2E ngoài production → XFF cuối → x-real-ip);
//   · sau-proxy → CHỈ phần tử CUỐI của XFF. Không có ⇒ "unknown" (fail-open, lý do ở trên);
//   · may-dev   → cửa E2E ngoài production → XFF cuối → x-real-ip. Không đọc
//                 `x-vercel-forwarded-for`: ngoài Vercel nó chỉ có thể do khách gửi.
//
// Phần tử CUỐI đúng dưới cả hai hành vi của Caddy — ghi đè XFF bằng IP khách (mặc định khi
// không khai `trusted_proxies`) hay nối thêm — y như lập luận với Vercel ở trên.
// ⚠️ Bật proxy Cloudflare (đám mây cam) phía trước Caddy thì phần tử cuối thành IP Cloudflare ⇒
// phải khai `trusted_proxies` ở Caddy (hoặc sửa nhánh sau-proxy) CÙNG lúc bật.
//
// ⚠️ Mọi chỗ khác trong app đọc IP khách PHẢI đi qua tệp này (`ipChoRateLimit` cho khoá chặn,
// `ipKhachHang` cho nhật ký). `lib/security/nguon-ip-mot-cho.test.ts` quét cây và đỏ khi thấy
// một tệp tự đọc header IP — trước 28/09 có 15 tệp như vậy, đa số lấy phần tử ĐẦU của XFF.

import { nenTangDangChay } from "./nen-tang";

/** Header dành riêng cho E2E — CHỈ có tác dụng trên máy dev/CI và Vercel NGOÀI production. */
export const HEADER_IP_E2E = "x-e2e-client-ip";

/**
 * Đang chạy trên PRODUCTION THẬT?
 *
 * ⚠️ `VERCEL_ENV` là nguồn đúng khi chạy trên Vercel: nó phân biệt `production` với
 * `preview` và với môi trường tuỳ biến (`test`). Chỉ khi KHÔNG có nó mới rơi về `NODE_ENV`.
 *
 * ⚠️ Vế `!CI` là bắt buộc, không phải thừa: `next start` luôn đặt `NODE_ENV=production`,
 * kể cả trên máy runner của CI. Thiếu vế đó thì mọi job E2E bị coi là production và cửa
 * test đóng sập — tức bản vá bảo mật này sẽ tự làm hỏng đúng bộ test mà nó phục vụ.
 */
/**
 * Chỉ cần đọc vài khoá, nên nhận `Record` thay vì `NodeJS.ProcessEnv`.
 *
 * ⚠️ Không phải để cho tiện: `NodeJS.ProcessEnv` ĐÒI có `NODE_ENV`, nên mọi fixture của
 * test phải bịa thêm khoá đó hoặc ép kiểu — và ép kiểu trong test là chỗ lỗi trốn vào.
 */
export type BienMoiTruong = Record<string, string | undefined>;

export function laProductionThat(env: BienMoiTruong = process.env): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "production";
  return env.NODE_ENV === "production" && !env.CI;
}

type DocHeader = { get(name: string): string | null } | undefined;

/**
 * IP khách của lượt gọi, hoặc `null` nếu không xác định được. Dùng cho NHẬT KÝ (AuditLog,
 * chấm công, SCORM, chấp nhận chính sách, `Lead.ipAddress`) — nơi không được ghi một chữ
 * "unknown" như thể nó là một IP.
 *
 * Thứ tự theo nền tảng (`nenTangDangChay`), và mỗi bậc đều có lý do:
 *
 * **vercel** (`VERCEL=1`):
 *   1. `x-vercel-forwarded-for` — nền tảng đặt, client KHÔNG giả được (Vercel gỡ header
 *      `x-vercel-*` đến từ ngoài). Tin tuyệt đối.
 *   2. `x-e2e-client-ip` — **chỉ ngoài production**. Cửa để bộ E2E mô phỏng nhiều người
 *      dùng khác nhau mà KHÔNG phải tắt cổng chặn.
 *   3. phần tử **CUỐI** của `x-forwarded-for` — xem khối chú thích đầu tệp.
 *   4. `x-real-ip` — proxy tự đặt; client gửi được nhưng nó chỉ tới lượt khi 1–3 đều trống.
 *
 * **sau-proxy** (VPS sau Caddy): CHỈ phần tử CUỐI của `x-forwarded-for`. Mọi header khác là
 * khách tự gửi — Caddy để nguyên.
 *
 * **may-dev** (máy dev, vitest, CI): 2 → 3 → 4 như trên, bỏ bậc 1.
 */
export function ipKhachHang(
  headers: DocHeader,
  env: BienMoiTruong = process.env,
): string | null {
  const doc = (ten: string) => headers?.get(ten)?.trim() || null;
  const xffCuoi = () => {
    const xff = doc("x-forwarded-for");
    return xff ? phanTuCuoi(xff) : null;
  };

  const nenTang = nenTangDangChay(env);
  if (nenTang === "sau-proxy") return xffCuoi();

  if (nenTang === "vercel") {
    const cuaVercel = doc("x-vercel-forwarded-for");
    if (cuaVercel) {
      const ip = phanTuCuoi(cuaVercel);
      if (ip) return ip;
    }
  }

  if (!laProductionThat(env)) {
    const e2e = doc(HEADER_IP_E2E);
    if (e2e) return e2e;
  }

  return xffCuoi() ?? doc("x-real-ip");
}

/**
 * IP dùng làm khoá chặn tần suất — cùng luật với `ipKhachHang`, chỉ khác: không xác định
 * được thì trả `"unknown"` (một khoá chung) chứ không ném, không chặn. Xem khối chú thích
 * đầu tệp: fail-closed ở đây hại hơn fail-open.
 */
export function ipChoRateLimit(
  headers: DocHeader,
  env: BienMoiTruong = process.env,
): string {
  return ipKhachHang(headers, env) ?? "unknown";
}

/**
 * Phần tử CUỐI của một chuỗi kiểu `a, b, c`; chuỗi toàn dấu phẩy/khoảng trắng ⇒ `null`.
 *
 * ⚠️ Cuối chứ không phải đầu. Đây là toàn bộ nội dung của bản vá — đổi lại thành `[0]` là
 * mở lại đúng lỗ đã vá, và diff của nó trông vô hại. Ca `[CIP-03]` ghim.
 */
function phanTuCuoi(chuoi: string): string | null {
  const phan = chuoi
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return phan[phan.length - 1] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CỬA TẮT CHẶN TẦN SUẤT ĐĂNG NHẬP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `LOGIN_RATELIMIT_DISABLED=1` có được phép có tác dụng không.
 *
 * Chủ dự án chốt 21/09/2026: *"thêm chốt cứng — bị BỎ QUA khi VERCEL_ENV=production (hoặc
 * NODE_ENV=production ngoài CI), log cảnh báo nếu thấy nó được đặt trên prod."*
 *
 * ⚠️ BỎ QUA chứ không NÉM. `lib/otp/service.ts:49` chọn ném khi thấy `OTP_TEST_FIXED_CODE`
 * trên production, và đó là lựa chọn đúng cho NÓ — một mã OTP hằng số làm mọi tài khoản mở
 * toang, chết sớm là đúng. Ở đây ngược lại: ném nghĩa là **cả site không đăng nhập được**
 * vì một biến env thừa. Bỏ qua + kêu to giữ đúng phần an toàn mà không tự gây sự cố.
 *
 * ⚠️ Log ở mức `error` chứ không `warn`: một biến tắt-lưới-an-ninh nằm trên production là
 * thứ phải nổi lên trong Sentry, không phải một dòng trôi qua.
 */
export function duocTatChanTanSuatDangNhap(
  env: BienMoiTruong = process.env,
  ghiLoi: (s: string) => void = (s) => console.error(s),
): boolean {
  if (env.LOGIN_RATELIMIT_DISABLED !== "1") return false;
  if (laProductionThat(env)) {
    ghiLoi(
      "[SEC] LOGIN_RATELIMIT_DISABLED đang được ĐẶT TRÊN PRODUCTION — đã BỎ QUA, cổng " +
        "chặn brute-force đăng nhập vẫn hoạt động. Gỡ biến env này khỏi môi trường " +
        "production rồi deploy lại.",
    );
    return false;
  }
  return true;
}
