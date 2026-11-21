import { describe, it, expect, afterEach } from "vitest";
import {
  extractOrderCode,
  decideSepayAction,
  normalizeContent,
  checkSepayAuth,
  isValidSepayAuth,
  normalizeSepayKey,
} from "./sepay";

// BGĐ 31/07 — khớp giao dịch ngân hàng (SePay) với đơn hàng.

const baseOrder = {
  id: "o1",
  code: "ORD-260521-000001",
  status: "PENDING_PAYMENT",
  totalAmount: 5_000_000,
  gatewayTxnId: null as string | null,
  discountApprovalStatus: null as string | null,
};

describe("extractOrderCode", () => {
  it("đọc được mã đơn dù ngân hàng xoá gạch nối / thêm chữ", () => {
    expect(extractOrderCode("ORD260521000001 NGUYEN VAN A 0901234567")).toBe(
      "ORD-260521-000001",
    );
    expect(extractOrderCode("CK tu 0901234567 ORD-260521-000001 hoc phi")).toBe(
      "ORD-260521-000001",
    );
    expect(extractOrderCode("ord260521000001")).toBe("ORD-260521-000001");
  });

  it("nội dung không có mã → null (đối soát tay)", () => {
    expect(extractOrderCode("CHUYEN TIEN HOC PHI BE AN")).toBeNull();
    expect(extractOrderCode("")).toBeNull();
    expect(extractOrderCode(null)).toBeNull();
  });

  it("normalizeContent bỏ dấu + ký tự lạ", () => {
    expect(normalizeContent("Học phí — Bé An")).toBe("HOCPHIBEAN");
  });
});

describe("decideSepayAction", () => {
  it("đủ tiền, đơn chờ thanh toán → CONFIRM", () => {
    const r = decideSepayAction({
      payload: { id: 1, transferType: "in", transferAmount: 5_000_000 },
      order: baseOrder,
    });
    expect(r).toEqual({ action: "CONFIRM", orderId: "o1", amount: 5_000_000, soDot: null });
  });

  // 03/08 — khách chọn đóng 2 đợt: ngưỡng đối khớp là ĐỢT 1, không phải tổng đơn.
  // Không có ca này thì mọi giao dịch trả góp rơi vào "trả thiếu → xử lý tay".
  it("đóng ĐỢT 1 (nhỏ hơn tổng đơn) → vẫn CONFIRM + trả kèm soDot", () => {
    const r = decideSepayAction({
      payload: { id: 1, transferType: "in", transferAmount: 3_000_000 },
      order: baseOrder,
      dueNow: { amount: 3_000_000, soDot: 1 },
    });
    expect(r).toEqual({ action: "CONFIRM", orderId: "o1", amount: 3_000_000, soDot: 1 });
  });

  it("đóng THIẾU cả so với đợt 1 → MANUAL", () => {
    const r = decideSepayAction({
      payload: { id: 1, transferType: "in", transferAmount: 1_000_000 },
      order: baseOrder,
      dueNow: { amount: 3_000_000, soDot: 1 },
    });
    expect(r.action).toBe("MANUAL");
  });

  it("trả DƯ vẫn xác nhận (chuyển thừa không chặn giao dịch)", () => {
    const r = decideSepayAction({
      payload: { id: 1, transferType: "in", transferAmount: 6_000_000 },
      order: baseOrder,
    });
    expect(r.action).toBe("CONFIRM");
  });

  it("tiền RA → SKIP", () => {
    const r = decideSepayAction({
      payload: { id: 1, transferType: "out", transferAmount: 5_000_000 },
      order: baseOrder,
    });
    expect(r).toEqual({ action: "SKIP", reason: "Không phải giao dịch tiền vào" });
  });

  it("không khớp đơn → MANUAL (đối soát tay), không lỗi", () => {
    const r = decideSepayAction({
      payload: { id: 1, transferType: "in", transferAmount: 5_000_000 },
      order: null,
    });
    expect(r.action).toBe("MANUAL");
  });

  it("cùng gatewayTxnId → SKIP (idempotent khi SePay gửi lại)", () => {
    const r = decideSepayAction({
      payload: { id: 77, transferType: "in", transferAmount: 5_000_000 },
      order: { ...baseOrder, gatewayTxnId: "77" },
    });
    expect(r).toEqual({ action: "SKIP", reason: "Giao dịch đã được xử lý" });
  });

  it("đơn đã CONFIRMED → SKIP", () => {
    const r = decideSepayAction({
      payload: { id: 1, transferType: "in", transferAmount: 5_000_000 },
      order: { ...baseOrder, status: "CONFIRMED" },
    });
    expect(r.action).toBe("SKIP");
  });

  // ⚠️ ĐẢO 14/09/2026 — ca này TRƯỚC ĐÂY khẳng định `MANUAL` ("không vòng qua khâu
  // duyệt"). Luật đã đổi theo hai lẽ, không phải một:
  //  (1) chủ dự án chốt bỏ hẳn cơ chế duyệt đơn hàng;
  //  (2) kể cả không có (1) thì cổng đó vẫn phải gỡ — nó LÀM MẤT TIỀN. Ở webhook,
  //      nhánh MANUAL có đơn chỉ ghi IntegrationLog rồi return: không BankTransaction,
  //      không PaymentRequest/Allocation, không Payment. Tiền vào bank, ba sổ trống.
  // Đừng khôi phục ca cũ khi thấy nó "an toàn hơn" — nó an toàn hơn ở chỗ không tự chốt
  // đơn, và đắt hơn ở chỗ không ghi tiền vào đâu cả.
  it("giảm giá chưa duyệt → CONFIRM (cổng duyệt đã gỡ; xem lib/orders/bo-duyet.test.ts)", () => {
    const r = decideSepayAction({
      payload: { id: 1, transferType: "in", transferAmount: 5_000_000 },
      order: { ...baseOrder, discountApprovalStatus: "PENDING_APPROVAL" },
    });
    expect(r.action).toBe("CONFIRM");
  });

  it("trả THIẾU → MANUAL (người thật quyết định)", () => {
    const r = decideSepayAction({
      payload: { id: 1, transferType: "in", transferAmount: 2_000_000 },
      order: baseOrder,
    });
    expect(r.action).toBe("MANUAL");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// XÁC THỰC WEBHOOK — 12/08: 19 lần SePay gọi về prod đều 401, 4 giao dịch thật
// (06→08/08, tổng ~26,8tr) rơi mất. Env `SEPAY_WEBHOOK_API_KEY` CÓ trên Vercel
// Production từ 03/08 ⇒ hỏng ở khâu SO KHỚP chứ không phải thiếu cấu hình, mà
// route lại không ghi lại gì khi từ chối nên không ai biết hỏng ở đâu.
// Hai việc test này khoá: (1) tha những sai lệch định dạng vô hại; (2) lý do
// từ chối phải nói rõ hỏng ở đâu mà KHÔNG lộ key.
// ═══════════════════════════════════════════════════════════════════════════
const KEY = "sk_sepay_9f2b7c1d4e6a8b3c";
const headersOf = (h: Record<string, string>) => new Headers(h);

describe("normalizeSepayKey", () => {
  it("bỏ khoảng trắng, nháy bao ngoài và tiền tố scheme dán nhầm", () => {
    expect(normalizeSepayKey(` ${KEY} `)).toBe(KEY);
    expect(normalizeSepayKey(`"${KEY}"`)).toBe(KEY);
    expect(normalizeSepayKey(`'${KEY}'`)).toBe(KEY);
    expect(normalizeSepayKey(`Apikey ${KEY}`)).toBe(KEY);
    expect(normalizeSepayKey(`Bearer ${KEY}`)).toBe(KEY);
    expect(normalizeSepayKey(`"Apikey ${KEY}"`)).toBe(KEY);
  });

  it("KHÔNG cắt nhầm khi key chỉ tình cờ bắt đầu bằng chữ 'token'", () => {
    expect(normalizeSepayKey("tokenABC123")).toBe("tokenABC123");
  });
});

describe("checkSepayAuth", () => {
  const prev = process.env.SEPAY_WEBHOOK_API_KEY;
  afterEach(() => {
    if (prev === undefined) delete process.env.SEPAY_WEBHOOK_API_KEY;
    else process.env.SEPAY_WEBHOOK_API_KEY = prev;
  });

  it("thiếu env → NO_ENV (đóng cửa, không mở toang khi chưa cấu hình)", () => {
    delete process.env.SEPAY_WEBHOOK_API_KEY;
    const r = checkSepayAuth(headersOf({ authorization: `Apikey ${KEY}` }));
    expect(r).toEqual({ ok: false, code: "NO_ENV", detail: expect.any(String) });
  });

  it("đúng định dạng SePay `Authorization: Apikey <key>` → qua", () => {
    process.env.SEPAY_WEBHOOK_API_KEY = KEY;
    expect(checkSepayAuth(headersOf({ authorization: `Apikey ${KEY}` }))).toEqual({
      ok: true,
      via: "authorization/Apikey",
    });
  });

  it("tha các biến thể vô hại: hoa/thường của scheme, thừa khoảng trắng, xuống dòng", () => {
    process.env.SEPAY_WEBHOOK_API_KEY = KEY;
    for (const h of [`APIKEY ${KEY}`, `apikey  ${KEY} `, `Apikey\t${KEY}\n`]) {
      expect(checkSepayAuth(headersOf({ authorization: h })).ok).toBe(true);
    }
  });

  it("tha các kiểu gửi khác: Bearer, Token, không scheme, X-Api-Key", () => {
    process.env.SEPAY_WEBHOOK_API_KEY = KEY;
    expect(checkSepayAuth(headersOf({ authorization: `Bearer ${KEY}` })).ok).toBe(true);
    expect(checkSepayAuth(headersOf({ authorization: `Token ${KEY}` })).ok).toBe(true);
    expect(checkSepayAuth(headersOf({ authorization: KEY })).ok).toBe(true);
    expect(checkSepayAuth(headersOf({ "x-api-key": KEY })).ok).toBe(true);
    expect(checkSepayAuth(headersOf({ apikey: KEY })).ok).toBe(true);
  });

  it("env bị dán kèm nháy hoặc kèm chữ 'Apikey' → vẫn khớp (lỗi cấu hình hay gặp)", () => {
    for (const envValue of [`"${KEY}"`, `Apikey ${KEY}`, ` ${KEY}\n`]) {
      process.env.SEPAY_WEBHOOK_API_KEY = envValue;
      expect(checkSepayAuth(headersOf({ authorization: `Apikey ${KEY}` })).ok).toBe(true);
    }
  });

  it("người cấu hình dán cả 'Apikey' vào ô key bên SePay → vẫn khớp", () => {
    process.env.SEPAY_WEBHOOK_API_KEY = KEY;
    expect(checkSepayAuth(headersOf({ authorization: `Apikey Apikey ${KEY}` })).ok).toBe(true);
  });

  it("không gửi header nào → NO_HEADER (bên SePay chưa bật xác thực)", () => {
    process.env.SEPAY_WEBHOOK_API_KEY = KEY;
    const r = checkSepayAuth(headersOf({ "content-type": "application/json" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NO_HEADER");
  });

  it("sai key → MISMATCH, lý do đủ để chẩn đoán nhưng KHÔNG chứa key", () => {
    process.env.SEPAY_WEBHOOK_API_KEY = KEY;
    const wrong = "sk_sepay_KHAC_HOAN_TOAN";
    const r = checkSepayAuth(headersOf({ authorization: `Apikey ${wrong}` }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("MISMATCH");
    expect(r.detail).toContain(String(wrong.length));
    expect(r.detail).toContain(String(KEY.length));
    expect(r.detail).not.toContain(KEY);
    expect(r.detail).not.toContain(wrong);
  });

  it("khác nhau CHỈ hoa/thường → vẫn từ chối nhưng nói rõ để người vá đúng chỗ", () => {
    process.env.SEPAY_WEBHOOK_API_KEY = KEY;
    const r = checkSepayAuth(headersOf({ authorization: `Apikey ${KEY.toUpperCase()}` }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("MISMATCH");
    expect(r.detail).toMatch(/hoa\/thường/i);
  });

  it("key bị cắt cụt → lý do chỉ ra số ký tự trùng ở đầu", () => {
    process.env.SEPAY_WEBHOOK_API_KEY = KEY;
    const r = checkSepayAuth(headersOf({ authorization: `Apikey ${KEY.slice(0, 10)}` }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.detail).toMatch(/trùng 10 ký tự đầu/);
  });

  it("isValidSepayAuth (đường cũ) giữ nguyên hợp đồng boolean", () => {
    process.env.SEPAY_WEBHOOK_API_KEY = KEY;
    expect(isValidSepayAuth(`Apikey ${KEY}`)).toBe(true);
    expect(isValidSepayAuth("Apikey sai")).toBe(false);
    expect(isValidSepayAuth(null)).toBe(false);
  });
});
