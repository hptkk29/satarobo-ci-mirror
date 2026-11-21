/**
 * Dữ liệu dùng chung cho bộ test extension POS Agent (GĐ5).
 *
 * Khoá/agent lấy NGUYÊN VĂN từ hợp đồng `docs/pos-agent-api.md` §3.8 (vector cố định —
 * chỉ để test, KHÔNG dùng thật). Mốc thời gian là HẰNG SỐ (luật 19: test không đọc đồng hồ).
 */

export const PORTAL = "https://merchant.techcombank.com";
export const AGENT_ID = "cm9posagentcs1test0000001";
export const MASTER_KEY = "pos-agent-master-key-CHI-DE-TEST-khong-dung-that-0123456789";
export const BI_MAT = "293c3ade00fc88792aba32e1c692d50596efbb52b42967973aea1c6f55f855a9";
export const MERCHANT = "NCCPH6KE";
export const MERCHANT_KHAC = "NCCQYY4D";
export const GOC_PROD = "https://admin.satarobo.vn";
export const GOC_TEST = "https://test.satarobo.vn";
export const DUONG_TIM_KIEM = `/api/partners/merchant-portal/${MERCHANT}/v2/transactions/search`;
export const URL_TIM_KIEM = `${PORTAL}${DUONG_TIM_KIEM}`;
export const URL_PHIEN = `${PORTAL}/api/auth/session`;

/** 2026-10-07T10:20:00+07:00 — đúng `X-Agent-Ts` của vector V1. */
export const T0 = 1791343200000;
export const PHUT = 60_000;
export const GIO = 60 * PHUT;

/** Giá trị BÍ MẬT giả của phiên portal — test quét để chắc chúng không bao giờ rời trang. */
export const TOKEN_GIA = {
  accessToken:
    "eyJhbGciOiJub25lIn0.eyJzdWIiOiJib3QiLCJleHAiOjE3OTE0MjIxMDB9.chu-ky-gia-ACCESS-SECRET",
  refreshToken: "REFRESH-SECRET-7f3c",
  deviceId: "DEVICE-SECRET-91ab",
  xApiAuth: "XAPIAUTH-SECRET-55aa",
  xApiPayment: "XAPIPAYMENT-SECRET-66bb",
  cookie: "next-auth.session-token=COOKIE-SECRET-77cc",
} as const;

/** `exp` trong `TOKEN_GIA.accessToken` = 2026-10-08T08:15:00+07:00. */
export const HET_HAN_ACCESS_ISO = "2026-10-08T08:15:00+07:00";

/** Mọi chuỗi KHÔNG BAO GIỜ được rời trang portal / đi tới satarobo. */
export const CHUOI_CAM: readonly string[] = [
  "ACCESS-SECRET",
  TOKEN_GIA.refreshToken,
  TOKEN_GIA.deviceId,
  TOKEN_GIA.xApiAuth,
  TOKEN_GIA.xApiPayment,
  "COOKIE-SECRET",
  "NGUYEN VAN A",
  "V9E1013322",
];

/** Một dòng giao dịch như portal trả — có CẢ trường cấm (`sender_card_name`, `device_id`) + khoá lạ. */
export function dongPortal(ghiDe: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    transaction_id: "TXN20261007000123",
    transaction_type: "PAYMENT",
    transaction_detail_status: "SUCCESS",
    transaction_master_status: "SUCCESS",
    order_description: "Học phí bé An K7M2N",
    authorization_id: "123456",
    card_transaction_id: "628012345678",
    tcb_transaction_id: "FT26280123456",
    order_amount: 6732000,
    transaction_master_amount: 6732000,
    transaction_detail_amount: 6732000,
    fee: null,
    tax: 0,
    currency: "VND",
    transaction_time: "2026/10/07 10:18:42",
    merchant_code: MERCHANT,
    store_code: "CH9TSGU9",
    terminal_code: "QTT45XWQT",
    device_id: "V9E1013322",
    payment_method: "CARD",
    service_type: "OMSMARTPOS",
    sender_card_number: "411111******1111",
    sender_card_type: "VISA",
    sender_card_name: "NGUYEN VAN A",
    accounting_reference_id: null,
    settlement_id: null,
    merchant_order_id: "MO-0001",
    transaction_operation_msg: "APPROVED",
    // khoá lạ portal có thể thêm — không được lọt
    user: { accessToken: TOKEN_GIA.accessToken },
    x_api_auth: TOKEN_GIA.xApiAuth,
    ...ghiDe,
  };
}

/** Sinh n dòng với mã giao dịch + giờ quẹt khác nhau (giờ VN, cùng ngày 07/10/2026). */
export function nhieuDong(n: number, gioBatDau = "10:00:00"): Record<string, unknown>[] {
  const [h, m, s] = gioBatDau.split(":").map(Number);
  const ra: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const giay = h * 3600 + m * 60 + s - i * 7;
    const hh = String(Math.floor(giay / 3600)).padStart(2, "0");
    const mm = String(Math.floor((giay % 3600) / 60)).padStart(2, "0");
    const ss = String(giay % 60).padStart(2, "0");
    ra.push(
      dongPortal({
        transaction_id: `TXN2026100700${String(1000 + i)}`,
        transaction_time: `2026/10/07 ${hh}:${mm}:${ss}`,
        order_description: `Thu hoc phi ${i} ABCDE`,
      }),
    );
  }
  return ra;
}

/** Quét SÂU một giá trị: trả đường dẫn đầu tiên chứa một chuỗi cấm (khoá hoặc giá trị). */
export function timChuoiCam(v: unknown, cam: readonly string[] = CHUOI_CAM): string | null {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? null);
  for (const c of cam) if (s.includes(c)) return c;
  return null;
}
