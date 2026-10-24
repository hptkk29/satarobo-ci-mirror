// lib/payments/sepay.ts — BGĐ 31/07: tự động xác nhận đơn khi tiền về tài khoản.
//
// SePay (https://sepay.vn) đọc biến động số dư ngân hàng rồi POST webhook về hệ
// thống.
//
// ⚠️ 20/08 — QR KHÔNG CÒN NHÚNG MÃ ĐƠN. Nội dung CK nay là dạng người đọc
// `HoTenCon_SdtPH_TenKhoa` (chủ dự án chốt; xem lib/payments/vietqr.ts), nên
// `extractOrderCode` bên dưới CHỈ còn khớp được:
//   - đơn đã phát QR/nội dung CK TRƯỚC 20/08, và
//   - khách tự gõ tay mã đơn.
// Với nội dung dạng mới, `decideSepayAction` trả MANUAL (không thấy đơn) và route
// đẩy giao dịch sang `ingestPayosWebhook`, ở đó nhánh (d) tra ngược theo SĐT phụ
// huynh rồi phân bổ bình thường. Tức "MANUAL + không có đơn" KHÔNG còn đồng nghĩa
// với "phải xử lý tay" — đọc lib/payments/payos-ingest.ts trước khi kết luận.
//
// Phần THUẦN (parse/khớp) tách khỏi route để test không cần HTTP/DB.

/** Payload SePay gửi về (chỉ khai các field ta dùng; SePay còn gửi thêm). */
export type SepayWebhookPayload = {
  /** id giao dịch trên SePay — khoá idempotency. */
  id?: number | string;
  gateway?: string;
  transactionDate?: string;
  accountNumber?: string;
  /** Nội dung chuyển khoản (thô). */
  content?: string;
  description?: string;
  /** "in" = tiền vào, "out" = tiền ra. */
  transferType?: string;
  transferAmount?: number;
  referenceCode?: string;
};

/** Bỏ dấu/ký tự lạ + viết hoa → so khớp không phụ thuộc định dạng ngân hàng. */
export function normalizeContent(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Rút MÃ ĐƠN từ nội dung CK. Mã đơn dạng `ORD-YYMMDD-NNNNNN`; ngân hàng thường
 * xoá dấu gạch nối nên ta tìm chuỗi `ORD` + 12 chữ số rồi dựng lại mã có gạch.
 * Trả null nếu nội dung không chứa mã hợp lệ.
 */
export function extractOrderCode(content: string | null | undefined): string | null {
  const norm = normalizeContent(content);
  const m = norm.match(/ORD(\d{12})/);
  if (!m) return null;
  const digits = m[1]!;
  return `ORD-${digits.slice(0, 6)}-${digits.slice(6)}`;
}

export type SepayMatchInput = {
  payload: SepayWebhookPayload;
  /** Đơn tra được theo mã (null nếu không tìm thấy). */
  order: {
    id: string;
    code: string;
    status: string;
    totalAmount: number;
    gatewayTxnId: string | null;
    discountApprovalStatus: string | null;
  } | null;
  /**
   * Số tiền PHẢI THU NGAY (lib/payments/due-now.ts) — khách chọn đóng 2 đợt thì
   * đây là đợt 1, KHÔNG phải tổng đơn. Thiếu tham số này (đường gọi cũ) thì lùi
   * về `order.totalAmount` để không đổi hành vi ngoài ý muốn.
   */
  dueNow?: { amount: number; soDot: number | null };
};

export type SepayMatchResult =
  | { action: "CONFIRM"; orderId: string; amount: number; soDot: number | null }
  | { action: "SKIP"; reason: string }
  | { action: "MANUAL"; reason: string };

/**
 * Quyết định xử lý 1 giao dịch (THUẦN). Nguyên tắc:
 *  - Chỉ xử lý tiền VÀO ("in").
 *  - Không khớp mã đơn / không thấy đơn → MANUAL (đối soát tay), KHÔNG lỗi.
 *  - Đã ghi cùng gatewayTxnId → SKIP (idempotent, SePay retry an toàn).
 *  - Đơn không ở PENDING_PAYMENT → SKIP (đã xác nhận / đã huỷ).
 *  - Giảm giá chưa được duyệt → MANUAL (không tự xác nhận vòng qua khâu duyệt).
 *  - Số tiền < tổng đơn → MANUAL (trả thiếu/đặt cọc: người thật quyết định).
 */
/**
 * TIỀN THẬT CÓ VÀO TÀI KHOẢN KHÔNG — câu hỏi về THỰC TẾ, không về cách ta phân loại.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO TÁCH RA (23/09/2026)
 *
 * `decideSepayAction` trả lời "xử lý giao dịch này thế nào". Webhook cần trả lời thêm một
 * câu KHÁC và ĐỨNG TRƯỚC: "có tiền thật vào không" — vì tiền vào thì PHẢI để lại dấu trong
 * sổ, bất kể ta quyết định gì sau đó.
 *
 * Trước bản vá, cửa ghi sổ của webhook hỏi nhầm câu: `decision.action === "MANUAL" && !order`.
 * Vế `!order` từng gần như luôn đúng (memo không mang mã đơn), nên lập luận "ca có đơn đã rõ
 * ràng, để người quyết" đứng vững. Ngày 14/09 memo đổi sang mang `matchKey` (`ORD…D1`), và
 * `extractOrderCode` khớp đúng chuỗi ấy ⇒ vế `!order` hoá SAI THƯỜNG XUYÊN. Không ai sửa dòng
 * đó, nhưng ý nghĩa của nó đã đổi — và ba lớp ca rơi ra ngoài sổ:
 *   · trả thiếu / đặt cọc có mã đơn;
 *   · đợt 2 của đơn đã bị đường cũ chốt CONFIRMED ở đợt 1 (`order.status !== PENDING_PAYMENT`);
 *   · đợt theo CON — `dueNow` tính từ `OrderInstallment` (Ledger-A, KHÔNG có `orderItemId`)
 *     nên mọi lần trả theo đợt của con đều trông như trả thiếu.
 *
 * Trả về kiểu PHÂN BIỆT (ok + amount / lý do) chứ không trả boolean: `decideSepayAction` cần
 * chính hai câu lý do ấy cho nhánh SKIP của nó, nên nếu đây là boolean thì hai lý do phải được
 * gõ lại ở chỗ khác — tức bản thứ hai của cùng một luật.
 */
export type TienVaoSepay = { ok: true; amount: number } | { ok: false; reason: string };

export function docTienVao(payload: SepayWebhookPayload): TienVaoSepay {
  if ((payload.transferType ?? "in").toLowerCase() !== "in") {
    return { ok: false, reason: "Không phải giao dịch tiền vào" };
  }
  const amount = Number(payload.transferAmount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "Số tiền không hợp lệ" };
  }
  return { ok: true, amount };
}

export function decideSepayAction(input: SepayMatchInput): SepayMatchResult {
  const { payload, order } = input;

  // Hai ca "không phải tiền" dùng CHUNG `docTienVao` với cửa ghi sổ của webhook — một định
  // nghĩa, hai chỗ đọc. Gõ lại ở đây là để hai nơi trôi khác nhau rồi sổ hở đúng lúc cần kín.
  const tien = docTienVao(payload);
  if (!tien.ok) {
    return { action: "SKIP", reason: tien.reason };
  }
  const amount = tien.amount;
  if (!order) {
    return { action: "MANUAL", reason: "Không khớp mã đơn trong nội dung chuyển khoản" };
  }
  const txnId = payload.id != null ? String(payload.id) : null;
  if (txnId && order.gatewayTxnId === txnId) {
    return { action: "SKIP", reason: "Giao dịch đã được xử lý" };
  }
  if (order.status !== "PENDING_PAYMENT") {
    return { action: "SKIP", reason: `Đơn đang ở trạng thái ${order.status}` };
  }
  // ⚠️ ĐÃ GỠ [14/09/2026] — cổng "giảm giá chưa duyệt ⇒ MANUAL".
  //
  // Chủ dự án chốt bỏ cơ chế duyệt đơn hàng. Nhưng kể cả không có chốt đó thì cổng này
  // vẫn phải gỡ: nó LÀM MẤT TIỀN chứ không bảo vệ gì. Ở webhook,
  // `app/api/public/webhook/sepay/route.ts` vào nhánh sớm với mọi action ≠ CONFIRM, và
  // cửa ghi vào sổ mới CHỈ chạy `if (decision.action === "MANUAL" && !order)` — ca "có
  // đơn + giảm giá chưa duyệt" tra RA đơn nên không qua cửa đó, chỉ ghi IntegrationLog
  // rồi return: không BankTransaction (kể cả UNMATCHED), không PaymentRequest/Allocation,
  // không Payment. Tiền vào tài khoản ngân hàng, ba sổ trống.
  //
  // Chưa ai đau vì cổng chưa từng chạy thật trên prod (MANUAL_REVIEW do nó = 0), nhưng
  // mọi đơn có giảm giá thanh toán bằng QR sẽ đau.
  //
  // Thay cho cổng này là DẤU VẾT, không phải khoảng trống: `lib/orders/price-guard.ts`
  // + AuditLog `ORDER_CREATED` ghi trong cùng transaction tạo đơn.
  // Ngưỡng đối khớp = số tiền phải thu NGAY (đợt 1 nếu khách chọn 2 đợt), không
  // phải tổng đơn — nếu không, mọi ca trả góp đều rơi vào "trả thiếu → xử lý tay"
  // và luồng tự xác nhận coi như không tồn tại với khách đóng 2 đợt.
  const expected = input.dueNow?.amount ?? order.totalAmount;
  if (amount < expected) {
    return {
      action: "MANUAL",
      reason: `Số tiền ${amount} nhỏ hơn số phải thu ${expected}`,
    };
  }
  return { action: "CONFIRM", orderId: order.id, amount, soDot: input.dueNow?.soDot ?? null };
}

// ═══════════════════════════════════════════════════════════════════════════
// XÁC THỰC WEBHOOK
//
// 12/08 — SỰ CỐ: 19 lần SePay gọi về prod đều 401, 4 giao dịch thật của phụ
// huynh (06→08/08, ~26,8tr) không vào được hệ thống. Env `SEPAY_WEBHOOK_API_KEY`
// CÓ trên Vercel Production từ 03/08 và đã qua nhiều lần deploy ⇒ hỏng ở khâu SO
// KHỚP chuỗi, không phải thiếu cấu hình. Đúng rủi ro đã ghi trong
// docs/checklist-nghiem-thu-0308.md:359 ("chưa đối chứng thì chưa biết key có
// đúng cái SePay đang gửi hay không") — và vì đường từ chối KHÔNG ghi lại gì nên
// 6 ngày trôi qua không ai biết.
//
// Hai nguyên tắc của bản vá:
//  1. THA sai lệch định dạng vô hại (nháy bao ngoài, tiền tố scheme dán nhầm,
//     hoa/thường của scheme, header tên khác) — những thứ này KHÔNG làm giảm an
//     toàn vì vẫn phải khớp đúng key.
//  2. Từ chối phải NÓI ĐƯỢC hỏng ở đâu (thiếu env / không gửi header / sai key,
//     lệch bao nhiêu ký tự) mà TUYỆT ĐỐI không lộ key ra log.
// ═══════════════════════════════════════════════════════════════════════════

/** Các header có thể mang key — SePay dùng `Authorization`, các cổng khác hay dùng phần còn lại. */
const AUTH_HEADER_NAMES = ["authorization", "x-api-key", "apikey", "api-key", "x-apikey"] as const;

/** Tiền tố scheme cần bóc. PHẢI có dấu phân cách nên key kiểu "tokenABC" không bị cắt oan. */
const SCHEME_PREFIX = /^(apikey|api-key|bearer|token)[\s:]+/i;

/**
 * Đưa một chuỗi key về dạng so khớp: bỏ khoảng trắng/xuống dòng, bỏ nháy bao
 * ngoài (dán từ file .env vào ô giá trị trên dashboard rất hay dính), bỏ tiền tố
 * scheme (`Apikey `/`Bearer `) — lặp tối đa 2 lần cho ca dán chồng "Apikey Apikey x".
 *
 * KHÔNG đụng tới chữ hoa/thường: key vẫn so khớp phân biệt hoa thường.
 */
export function normalizeSepayKey(raw: string | null | undefined): string {
  let s = (raw ?? "").trim();
  for (let i = 0; i < 2; i++) {
    const quoted = s.match(/^(["'])([\s\S]*)\1$/);
    if (!quoted) break;
    s = (quoted[2] ?? "").trim();
  }
  for (let i = 0; i < 2 && SCHEME_PREFIX.test(s); i++) {
    s = s.replace(SCHEME_PREFIX, "").trim();
  }
  return s;
}

export type SepayAuthCheck =
  /** `via` = nguồn đọc được key, để log biết SePay đang gửi kiểu nào. */
  | { ok: true; via: string }
  | { ok: false; code: "NO_ENV" | "NO_HEADER" | "MISMATCH"; detail: string };

/** So sánh thời gian hằng — không rò độ dài tiền tố trùng qua thời gian phản hồi. */
function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Số ký tự trùng nhau tính từ đầu — chỉ dùng để mô tả độ lệch trong log. */
function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

type HeaderBag = { get(name: string): string | null };

/**
 * Xác thực webhook SePay. Thiếu env → từ chối TẤT CẢ (không mở cửa khi chưa
 * cấu hình). Trả về lý do CHẨN ĐOÁN ĐƯỢC, không chỉ true/false.
 *
 * ⚠️ `detail` sẽ được ghi vào IntegrationLog (admin đọc được) và KHÔNG bao giờ
 * được chứa key — chỉ độ dài, số ký tự trùng đầu, và nhận xét hoa/thường.
 */
export function checkSepayAuth(headers: HeaderBag): SepayAuthCheck {
  const expected = normalizeSepayKey(process.env.SEPAY_WEBHOOK_API_KEY);
  if (!expected) {
    return {
      ok: false,
      code: "NO_ENV",
      detail: "Chưa cấu hình SEPAY_WEBHOOK_API_KEY trên môi trường này",
    };
  }

  const seen: { name: string; scheme: string; key: string }[] = [];
  for (const name of AUTH_HEADER_NAMES) {
    const raw = headers.get(name);
    if (!raw || !raw.trim()) continue;
    const scheme = raw.trim().match(SCHEME_PREFIX)?.[1] ?? "(không scheme)";
    const key = normalizeSepayKey(raw);
    if (!key) continue;
    seen.push({ name, scheme, key });
    if (timingSafeEquals(key, expected)) return { ok: true, via: `${name}/${scheme}` };
  }

  if (seen.length === 0) {
    return {
      ok: false,
      code: "NO_HEADER",
      detail:
        "Request không mang key ở bất kỳ header nào (đã dò: " +
        AUTH_HEADER_NAMES.join(", ") +
        "). Bên SePay nhiều khả năng chưa bật kiểu xác thực API Key cho webhook này.",
    };
  }

  const best = seen[0]!;
  const sameIgnoringCase = best.key.toLowerCase() === expected.toLowerCase();
  const detail =
    `Key gửi lên không khớp. nguồn=${best.name} scheme=${best.scheme} ` +
    `độ dài nhận=${best.key.length} độ dài cấu hình=${expected.length} ` +
    `trùng ${commonPrefixLength(best.key, expected)} ký tự đầu` +
    (sameIgnoringCase ? " — CHỈ khác hoa/thường" : "") +
    (best.key.length === expected.length && !sameIgnoringCase
      ? " — cùng độ dài nhưng khác nội dung (nhiều khả năng là hai key khác nhau)"
      : "");
  return { ok: false, code: "MISMATCH", detail };
}

/**
 * Bản boolean giữ cho đường gọi cũ / test cũ. Code mới dùng `checkSepayAuth` để
 * có lý do từ chối.
 */
export function isValidSepayAuth(authHeader: string | null): boolean {
  return checkSepayAuth({ get: (n) => (n === "authorization" ? authHeader : null) }).ok;
}
