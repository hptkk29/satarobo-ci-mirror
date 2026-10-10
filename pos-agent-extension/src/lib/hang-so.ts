/**
 * Hằng số dùng chung của extension "SataRobo POS Agent" (GĐ5 POS).
 *
 * Nguồn: hợp đồng `docs/pos-agent-api.md` (phiên bản 1, chốt 07/10/2026) + roadmap POS §2–§6.
 * ⚠️ Hai content script (`content-main.ts`, `content-isolated.ts`) KHÔNG import được tệp này
 * (Chrome nạp content script dạng script cổ điển) ⇒ chúng giữ bản sao vài hằng số; test
 * `allowlist`/`content-*` dựng URL từ CHÍNH tệp này nên hai bên lệch là test đỏ.
 */

export const PHIEN_BAN = "0.1.0";

/** Kênh tin nhắn nội bộ của extension (service worker ⇄ content script ⇄ world MAIN). */
export const KENH = "satarobo-pos-agent";

export const PORTAL_ORIGIN = "https://merchant.techcombank.com";
export const PORTAL_MATCH = `${PORTAL_ORIGIN}/*`;
export const DUONG_PHIEN_PORTAL = "/api/auth/session";
/** Trang danh sách giao dịch — app tự gọi search khi mở trang này (nguồn bắt header). */
export const TRANG_GIAO_DICH = "/soft-pos-transaction";
/** App portal đá về trang này khi hết phiên (roadmap §6 GĐ5 — tín hiệu 3). */
export const DUONG_DANG_NHAP = "/login";

/** merchant_code của portal: chữ IN HOA + số (đo: NCCPH6KE, NCCQYY4D). */
export const MERCHANT_RE = /^[A-Z0-9]{4,32}$/;

export function duongTimKiem(merchantCode: string): string {
  return `/api/partners/merchant-portal/${merchantCode}/v2/transactions/search`;
}

/** Địa chỉ satarobo được hỗ trợ (hợp đồng §1). Mỗi gói chỉ khai MỘT trong hai. */
export const SATAROBO_GOC = {
  PROD: "https://admin.satarobo.vn",
  TEST: "https://test.satarobo.vn",
} as const;
export type MoiTruongSatarobo = keyof typeof SATAROBO_GOC;

export const API_AGENT = {
  heartbeat: "/api/pos-agent/heartbeat",
  status: "/api/pos-agent/status",
  jobs: "/api/pos-agent/jobs",
  transactions: "/api/pos-agent/transactions",
} as const;

export const ALARM = {
  /** 1 phút: hỏi job + đồng bộ (cũng là nhịp "còn sống" — hợp đồng §8.2). */
  phut: "pos-agent-phut",
  /** 10 phút: keepalive `GET /api/auth/session` của portal + heartbeat. */
  keepalive: "pos-agent-keepalive",
} as const;

export const NHIP = {
  phutMs: 60_000,
  keepaliveMs: 10 * 60_000,
  nhanhMs: 2_000,
  keoDaiNhanhMs: 120_000,
} as const;

export const PAGE_SIZE = 50;
export const LUI_CUA_SO_MS = 2 * 60 * 60_000;
export const LAN_DAU_MS = 72 * 60 * 60_000;
/** TỰ QUYẾT: cửa sổ tối đa 31 ngày — agent tắt lâu hơn thì phần cũ đi đường import file. */
export const CUA_SO_TOI_DA_MS = 31 * 24 * 60 * 60_000;
/** TỰ QUYẾT: chia cửa sổ thành mảnh ≤ 24h (giới hạn khoảng ngày của portal chưa đo). */
export const MANH_CUA_SO_MS = 24 * 60 * 60_000;
export const TOI_DA_TRANG_MOT_MANH = 400;
/**
 * RV5 — biên cộng vào MỐC CUỐI cửa sổ gửi portal (sau khi đã hiệu chỉnh đồng hồ máy theo X-Server-Time).
 * Phủ: độ trễ mạng của phép đo lệch giờ (đo lúc NHẬN phản hồi ⇒ luôn hụt ~RTT) + đồng hồ máy POS/portal
 * lệch với máy chủ. TỰ QUYẾT 2 phút (đặc tả RV gợi ý 2–5′): portal nhận mốc tương lai — chính app gửi
 * "… 23:59:59" của hôm nay (chờ đo §5). Biên KHÔNG vào `lastSyncedAt`.
 */
export const BIEN_CUOI_CUA_SO_MS = 2 * 60_000;

/** Mỗi lô ≤ 50 dòng (hợp đồng cho ≤ 200): lô nhỏ ⇒ mỗi POST xong nhanh, ít nguy cơ service worker bị cắt. */
export const DONG_MOT_LO = 50;
/** Dưới trần 524 288 byte của hợp đồng, chừa biên. */
export const BYTE_MOT_LO = 480_000;
export const TOI_DA_LO_MOT_LUOT = 999;
/**
 * RV5 — máy chủ trả 400 PAYLOAD_INVALID trỏ ĐÚNG một dòng (`error.field = transactions[i].…`) ⇒ bỏ dòng đó
 * rồi gửi lại lô. Trần số dòng bỏ / lượt: quá trần là lệch hợp đồng có hệ thống (phải sửa mã) ⇒ dừng lượt.
 */
export const TOI_DA_BO_DONG_MOT_LUOT = 10;

/** `/transactions` có thể mất vài chục giây (hợp đồng §4.4: timeout ≥ 60 giây). */
export const TIMEOUT_GIAO_DICH_MS = 90_000;
export const TIMEOUT_THUONG_MS = 15_000;
export const TIMEOUT_LENH_TAB_MS = 35_000;
/** Sau khi trang giao dịch tải xong: chờ app gọi search của nó (bắt header) rồi mới đồng bộ. */
export const CHO_SAU_TRANG_MOI_MS = 8_000;
/** Hợp đồng §3.6: cộng độ lệch giờ vào X-Agent-Ts khi |lệch| > 60 giây. */
export const LECH_GIO_NGUONG_MS = 60_000;
/** 503 NOT_CONFIGURED ⇒ thử lại sau 5 phút (hợp đồng §7.1). */
export const CHO_KHI_CHUA_CAU_HINH_MAY_CHU_MS = 5 * 60_000;
