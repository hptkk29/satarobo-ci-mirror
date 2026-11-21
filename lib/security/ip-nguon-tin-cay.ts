// lib/security/ip-nguon-tin-cay.ts — IP NGUỒN dùng làm CĂN CỨ CHO QUA (allowlist IP). THUẦN.
//
// 02/10/2026 — dời từ `lib/agents/gateway/ip.ts` khi gỡ Cổng dữ liệu agent: webhook tổng đài
// (`lib/calls/webhook.ts`) dùng chung hàm này cho allowlist IP của nó, nên hàm phải sống ngoài cổng.
// 06/10/2026 — webhook tổng đài (OmiCall) ĐÃ GỠ ⇒ hiện KHÔNG còn nơi gọi ngoài test. Giữ vì là
// cổng IP fail-closed dùng lại được (lưới `nguon-ip-mot-cho.test.ts` vẫn liệt kê nó).
//
// ── KHÁC `ipChoRateLimit` Ở ĐÂU, VÀ VÌ SAO KHÔNG DÙNG NÓ ─────────────────────────────
// `lib/security/client-ip.ts` sinh ra để làm KHOÁ CHẶN TẦN SUẤT, và nó cố ý FAIL-OPEN: không
// có header tin được thì trả "unknown" và vẫn cho qua (khoá chung còn hơn tự khoá cửa). Với
// danh sách IP được phép thì ngược lại hoàn toàn: IP là CĂN CỨ CẤP QUYỀN, nên:
//
//   · Trên Vercel CHỈ tin `x-vercel-forwarded-for` — nền tảng đặt, và Vercel gỡ mọi header
//     `x-vercel-*` do client gửi. `x-forwarded-for`/`x-real-ip` bị bỏ qua HẲN: nếu một ngày
//     nền tảng đổi hành vi "ghi đè" sang "nối thêm", header giả sẽ lọt qua allowlist.
//   · Không đọc được IP tin cậy ⇒ trả `null` ⇒ chỗ gọi TỪ CHỐI (fail closed).
//
//   · Trên VPS (từ 28/09/2026 — `nen-tang.ts`): app chỉ tới được qua Caddy, Caddy NỐI IP khách vào
//     CUỐI `x-forwarded-for` ⇒ CHỈ tin phần tử cuối đó. Mọi header khác (kể cả
//     `x-vercel-forwarded-for`, `x-e2e-client-ip`, `x-real-ip`) là khách tự gửi — Caddy để nguyên.
//
// Chỉ máy dev / CI mới nhận `x-e2e-client-ip` rồi phần tử CUỐI của XFF — bộ test cần mô phỏng IP.

import { nenTangDangChay } from "./nen-tang";

type DocHeader = { get(name: string): string | null } | undefined;
type Env = Record<string, string | undefined>;

function phanTuCuoi(chuoi: string): string {
  const phan = chuoi.split(",").map((s) => s.trim()).filter(Boolean);
  return phan[phan.length - 1] ?? "";
}

/**
 * Chuẩn hoá để so khớp: bỏ khoảng trắng, IPv4 ánh xạ IPv6 ("::ffff:1.2.3.4") về IPv4,
 * IPv6 về chữ thường. Không phải IP hợp lệ ⇒ `null`.
 */
export function chuanHoaIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  if (s.startsWith("::ffff:") && /^::ffff:\d{1,3}(\.\d{1,3}){3}$/.test(s)) s = s.slice(7);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
    return s.split(".").every((o) => Number(o) <= 255 && String(Number(o)) === o) ? s : null;
  }
  if (/^[0-9a-f:]+$/.test(s) && s.includes(":")) return s;
  return null;
}

/** IP nguồn TIN CẬY của lượt gọi, hoặc `null` nếu không xác định được (⇒ từ chối). */
export function ipNguonTinCay(headers: DocHeader, env: Env = process.env): string | null {
  const doc = (ten: string) => headers?.get(ten)?.trim() || null;
  const nenTang = nenTangDangChay(env);
  if (nenTang === "vercel") {
    const v = doc("x-vercel-forwarded-for");
    return v ? chuanHoaIp(phanTuCuoi(v)) : null;
  }
  if (nenTang === "sau-proxy") {
    const xff = doc("x-forwarded-for");
    return xff ? chuanHoaIp(phanTuCuoi(xff)) : null;
  }
  const e2e = doc("x-e2e-client-ip");
  if (e2e) return chuanHoaIp(e2e);
  const xff = doc("x-forwarded-for");
  if (xff) return chuanHoaIp(phanTuCuoi(xff));
  return chuanHoaIp(doc("x-real-ip"));
}
