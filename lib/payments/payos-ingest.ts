import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
// Chốt đơn thu đủ + cấp TK phụ huynh + biên nhận — MỘT hàm dùng chung với handler phiếu gộp
// (`lib/payments/sau-da-chia.ts`) [GĐ1 POS · 06/10/2026]. Lưới `[POS1-EV-08]`.
import { sauKhiDonThuDu } from "@/lib/payments/don-thu-du";
import { extractOrderCode, normalizeContent } from "@/lib/payments/sepay";
import { qrConRotDuocTien, locDonNhanTien } from "@/lib/payments/don-nhan-tien";
// Quy tắc "khoản này thuộc ghi danh nào" — MỘT chỗ duy nhất, dùng chung với màn sửa tay
// ở /admin/payments. Xem khối chú thích tại chỗ gọi (ghi sổ cũ) để biết vì sao.
import { chonGhiDanhChoKhoan } from "@/lib/finance/gan-ghi-danh-khoan";
// Cổng "tiền vào ⇒ lead lên Đã đăng ký" — MỘT chỗ duy nhất, dùng chung với đường ghi tay
// của kế toán (`recordPayment`) và đường xác nhận đơn (`ensureOrderPaymentRecorded`).
// Ở `@/lib/leads/**`, KHÔNG phải `@/lib/finance/payment` — lưới `[GGW-04]` cấm tệp này
// import module đó, và lệnh cấm ấy đúng; xem đầu tệp mới để biết vì sao.
// Xem khối chú thích tại chỗ gọi để biết vì sao đường tiền TỰ ĐỘNG trước đây không có nó.
import { maybeAdvanceLeadToRegistered } from "@/lib/leads/tien-vao-day-pheu";
import { thuTheoPhieuGop } from "@/lib/finance/phieu-gop";
// `conDongThuGiuTien`: phép kiểm trùng trước khi ghi sổ cũ — dùng chung với đường phiếu gộp.
// Xem tại chỗ gọi.
import {
  khoaGiaoDichTrongTx,
  TIEN_TO_GO_GAN,
  conDongThuGiuTien,
} from "@/lib/finance/ghi-tien-don";
import { ngayThuCuaGiaoDich } from "@/lib/payments/pos/ngay-thu";
import { phoneVariants } from "@/lib/phone";
import {
  transferContentPartsForOrder,
  MAX_TRANSFER_CONTENT,
  VIETQR_ADDINFO_MAX,
  type TransferContentParts,
} from "@/lib/payments/vietqr";
import {
  planAllocation,
  deriveStatus,
  isOrderSettled,
  outstandingOf,
  type AllocTarget,
  type RequestStatus,
} from "./allocation";
import { PAYOS_PROVIDER } from "./payos";

// =============================================================================
// 03/08 — THÂN XỬ LÝ webhook payOS: tiền về → ghi sổ → phân bổ theo waterfall.
// Route `app/api/public/webhook/payos/route.ts` chỉ còn vỏ (verify chữ ký + gọi
// hàm này) để test được ở tầng service, không phải dựng HTTP.
//
// ⚠️ BẤT BIẾN (vi phạm là tái tạo đúng con bug đang sửa):
//  1. `QrSession.expiresAt` TUYỆT ĐỐI KHÔNG phải điều kiện đối khớp. QR hết hạn
//     30 phút mà tiền vẫn về thì tiền đó VẪN phân bổ bình thường — hạn dùng chỉ
//     để hiển thị đếm ngược và chặn 2 QR ACTIVE ở màn sale.
//  2. SỐ TIỀN không phải khoá đối khớp — chỉ dùng để phân bổ. Thiếu → PARTIAL,
//     dư → CreditBalance. Không bao giờ từ chối vì lệch tiền.
//  3. Ngoại lệ THẬT duy nhất rơi vào xử lý tay = không tra ra phiếu thu nào
//     (UNMATCHED). Tiền vẫn nằm nguyên trong `BankTransaction`, không mất.
//  4. KHÔNG gọi API ngoài (email/ZNS/cấp tài khoản) BÊN TRONG transaction.
//  5. 20/08 — nội dung CK đổi sang dạng người đọc (`NguyenVanA_84987654321_Sata4`),
//     đối khớp thêm nhánh (d) theo SĐT. Nhánh này chỉ rót khi ra ĐÚNG MỘT đơn
//     đang chờ thu; nhập nhằng thì trả null kèm lý do — rót nhầm đơn tệ hơn nhiều
//     so với để kế toán gán tay. Đây KHÔNG mâu thuẫn với "không từ chối nhận tiền":
//     tiền vẫn ghi sổ đầy đủ ở `BankTransaction`, chỉ là chưa phân bổ.
// =============================================================================

/** Payload `data` của webhook payOS (chỉ khai field ta dùng; cổng gửi thêm nhiều). */
export type PayosWebhookData = {
  orderCode?: number | string;
  amount?: number | string;
  description?: string;
  accountNumber?: string;
  reference?: string;
  transactionDateTime?: string;
  currency?: string;
  paymentLinkId?: string;
  code?: string;
  desc?: string;
  counterAccountBankId?: string | null;
  counterAccountBankName?: string | null;
  counterAccountName?: string | null;
  counterAccountNumber?: string | null;
  virtualAccountName?: string | null;
  virtualAccountNumber?: string | null;
  [k: string]: unknown;
};

/** Câu nhật ký khi cổng "vừa gỡ gắn" chặn tự khớp lại — dùng chung ingest + route SePay. */
export const LY_DO_DA_GO_GAN = "Đã gỡ gắn — không tự khớp lại";
/**
 * Câu nhật ký khi webhook gửi lại một giao dịch ĐÃ BỎ QUA (IGNORED — kế toán bấm "Bỏ qua", hoặc thẻ
 * đã hủy/hoàn). Rà vòng 5 (`[V5-60]`, nhánh anh em của `[V3-13]`): trước đây nó ra DUPLICATE trơn ⇒
 * route SePay ghi "MATCH_TXN SUCCESS" và màn nhật ký in "Đã khớp phiếu thu" cho một khoản đã hoàn.
 */
export const LY_DO_DA_BO_QUA = "Giao dịch đã được bỏ qua — không tự khớp lại";

/** DUPLICATE mang lý do ⇒ giao dịch KHÔNG ở MATCHED — người gọi không được ghi "đã khớp". */
export type LyDoKhongKhopLai = "DA_GO_GAN" | "DA_BO_QUA";

/** Câu nhật ký cho từng lý do — dùng chung ingest + route SePay. */
export const CAU_LY_DO_KHONG_KHOP_LAI: Record<LyDoKhongKhopLai, string> = {
  DA_GO_GAN: LY_DO_DA_GO_GAN,
  DA_BO_QUA: LY_DO_DA_BO_QUA,
};

export type IngestOutcome =
  /**
   * Giao dịch đã ghi nhận trước đó → không làm gì thêm (cổng retry là chuyện thường).
   * `lyDo: "DA_GO_GAN"` — giao dịch KẾ TOÁN VỪA GỠ GẮN (đang UNMATCHED ở hàng chờ), cổng chặn tự
   * khớp lại. Người gọi PHẢI phân biệt: ghi "đã khớp" cho nó là nói dối (rà vòng 4, `[V3-13]`).
   */
  | { status: "DUPLICATE"; bankTransactionId: string; lyDo?: LyDoKhongKhopLai }
  /** Không tra ra phiếu thu → chờ kế toán xử lý tay. Tiền đã ghi sổ. */
  | { status: "UNMATCHED"; bankTransactionId: string; reason: string }
  | {
      status: "MATCHED";
      bankTransactionId: string;
      orderId: string;
      paymentRequestId: string;
      /** Tổng đã rót vào các phiếu thu trong lần này. */
      allocated: number;
      /** Tiền dư → CreditBalance. */
      credit: number;
      /** Phần thiếu được tha theo dung sai làm tròn. */
      waived: number;
      settled: boolean;
      orderConfirmed: boolean;
    }
  /** Payload không phải giao dịch tiền vào hợp lệ (ping đăng ký webhook, số tiền ≤ 0…). */
  | { status: "IGNORED"; reason: string }
  | { status: "ERROR"; reason: string };

// ── Log ─────────────────────────────────────────────────────────────────────
/**
 * ⚠️ `provider` PHẢI truyền theo cổng thật đang chạy. Hàm này dùng chung cho cả
 * payOS lẫn SePay; đóng cứng `PAYOS_PROVIDER` thì nhật ký của SePay bị gắn nhãn
 * payOS ⇒ biến mất khỏi khối lịch sử SePay ở /admin/bien-dong-so-du (lọc
 * `provider: "SEPAY"`) và hiện sai tên ở /admin/tich-hop.
 */
export async function logPayos(params: {
  provider?: string;
  action: string;
  status: "SUCCESS" | "SKIPPED" | "FAILED";
  payload: unknown;
  response?: unknown;
  error?: string;
}): Promise<void> {
  await db.integrationLog
    .create({
      data: {
        provider: params.provider ?? PAYOS_PROVIDER,
        direction: "PULL",
        action: params.action,
        status: params.status,
        requestPayload: (params.payload ?? {}) as Prisma.InputJsonValue,
        responsePayload: (params.response ?? undefined) as Prisma.InputJsonValue | undefined,
        errorMessage: params.error ?? null,
      },
    })
    .catch(() => {});
}

// ── Trích khoá đối khớp (THUẦN) ─────────────────────────────────────────────
/**
 * Ứng viên `matchKey` lấy từ payload, THEO THỨ TỰ ƯU TIÊN:
 *  1. `virtualAccountNumber` — VA cấp riêng cho phiếu thu (đường bền nhất).
 *  2. `reference` — mã tham chiếu giao dịch.
 *  3. Nội dung chuyển khoản: cả chuỗi, rồi từng token ≥ 6 ký tự (ngân hàng hay
 *     chèn thêm chữ vào nội dung).
 * `matchKey` là @unique nên dò theo danh sách này không sợ đụng nhầm phiếu khác.
 */
export function collectMatchKeyCandidates(data: PayosWebhookData): string[] {
  const out: string[] = [];
  const push = (v: unknown, min = 4) => {
    if (typeof v !== "string") return;
    const s = v.trim();
    if (s.length >= min) out.push(s);
  };

  push(data.virtualAccountNumber);
  push(data.reference);

  const desc = typeof data.description === "string" ? data.description.trim() : "";
  if (desc) {
    push(desc);
    for (const tok of desc.split(/[^A-Za-z0-9_-]+/)) push(tok, 6);
    // Vòng tách THỨ HAI, rộng hơn — cắt cả `_` và `-` [14/09/2026].
    //
    // VÌ SAO: nội dung CK nay mang `matchKey` lên đầu (lib/payments/noi-dung-ck.ts)
    // để nhánh (a) sống lại. Mã QR nối bằng KHOẢNG TRẮNG nên vòng trên đủ, nhưng
    // phụ huynh GÕ TAY theo bản sale đọc rất hay gõ `ORD260913000001D1_NguyenV` —
    // mà `/[^A-Za-z0-9_-]+/` KHÔNG tách `_`, nên cả cụm ra MỘT token 25 ký tự,
    // không bằng `matchKey` nào, và tiền rơi xuống nhánh đoán y như cũ.
    //
    // An toàn vì `matchKey` là @unique và tra bằng SO BẰNG: thêm ứng viên chỉ tăng
    // cơ hội tìm ĐÚNG khoá; một mảnh tên người muốn khớp nhầm thì phải TRÙNG KHÍT
    // matchKey của phiếu khác. Thêm vòng chứ không SỬA vòng cũ: `virtualAccount`
    // và `reference` của cổng có thể mang `-`/`_` trong chính mã.
    for (const tok of desc.split(/[^A-Za-z0-9]+/)) push(tok, 6);
  }
  return [...new Set(out)];
}

/** Định danh giao dịch dùng làm khoá idempotency (@@unique[provider, providerTxnId]). */
export function resolveProviderTxnId(data: PayosWebhookData): string | null {
  const pick = (v: unknown): string | null => {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    return null;
  };
  // `reference` = mã giao dịch ngân hàng (bền nhất). Thiếu thì lùi về id link,
  // cuối cùng là orderCode (mỗi lần xuất QR một mã nên vẫn duy nhất).
  return pick(data.reference) ?? pick(data.paymentLinkId) ?? pick(data.orderCode);
}

/**
 * payOS gọi thử 1 phát khi ĐĂNG KÝ webhook URL (orderCode 123 / mô tả VQRIO123).
 * Nhận diện để khỏi đẻ giao dịch rác UNMATCHED mỗi lần cấu hình lại cổng.
 */
export function isPayosVerificationPing(data: PayosWebhookData): boolean {
  const desc = typeof data.description === "string" ? data.description : "";
  return String(data.orderCode ?? "") === "123" && /VQRIO123/i.test(desc);
}

function parseTransferredAt(raw: unknown): Date {
  if (typeof raw === "string" && raw.trim()) {
    const d = new Date(raw.trim());
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// ── Tra đích phân bổ ────────────────────────────────────────────────────────
export type MatchTarget = {
  paymentRequestId: string;
  orderId: string;
  /** `manual` = kế toán tự gán ở /admin/bien-dong-so-du, không phải máy tra ra. */
  via: "matchKey" | "qrSession" | "orderCode" | "phone" | "manual";
  qrSessionId?: string;
};

/** Kết quả tra đích kèm LÝ DO khi không chốt được — `note` đi thẳng vào `unmatchedNote`. */
export type ResolveOutcome = {
  target: MatchTarget | null;
  /** Chỉ có khi target = null VÀ ta biết vì sao (vd khớp SĐT nhưng nhiều đơn). */
  note?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Phép bóc SĐT khỏi nội dung CK nay sống ở `lib/payments/sdt-trong-memo.ts` — module THUẦN,
// không `server-only`, nên script chạy ngoài Next dùng lại được ĐÚNG phép bóc này thay vì
// chép một bản thứ hai. Xuất lại ở đây để mọi đường gọi cũ (và mọi ca test cũ) giữ nguyên
// chỗ import.
import {
  extractVnPhoneCandidates,
  extractVnPhone,
} from "@/lib/payments/sdt-trong-memo";
export { extractVnPhoneCandidates, extractVnPhone };

/**
 * (d) Đối khớp theo SĐT phụ huynh — nhánh SINH RA CÙNG định dạng nội dung CK mới.
 *
 * Nguyên tắc: SĐT chỉ THU HẸP tập ứng viên, không tự nó quyết định. Ra đúng 1 đơn
 * đang chờ thu mới rót tiền; còn nhập nhằng thì TRẢ NULL kèm lý do — rót nhầm đơn
 * tệ hơn nhiều so với để kế toán gán tay (tiền vẫn nằm nguyên trong BankTransaction).
 */
async function resolveByPhone(data: PayosWebhookData): Promise<ResolveOutcome> {
  const content = typeof data.description === "string" ? data.description : "";

  // Nội dung TỰ KHAI mã đơn ⇒ nhánh (c) đã thử và trượt (đơn không tồn tại, hoặc
  // đơn đó không còn phiếu nào chờ thu). Suy ra đơn khác từ SĐT lúc này là ĐOÁN:
  // đúng thứ mà chủ dự án cấm. Để kế toán gán tay.
  if (extractOrderCode(content)) return { target: null };

  const phones = extractVnPhoneCandidates(content);
  if (phones.length === 0) return { target: null };

  const amount = Math.round(Number(data.amount ?? 0));
  const lookups: PhoneLookup[] = [];
  for (const phone of phones) {
    lookups.push({ phone, orders: await findPendingOrdersByPhone(phone) });
  }
  return decideByPhoneCandidates(lookups, content, amount);
}

/** Tập ứng viên đã nạp sẵn cho MỘT số điện thoại — đầu vào của phần quyết định THUẦN. */
export type PhoneLookup = { phone: string; orders: PhoneCandidate[] };

/**
 * Phần QUYẾT ĐỊNH của nhánh (d), tách hẳn khỏi DB để test được không cần Postgres.
 *
 * Đơn thắng xét theo TỪNG số rồi gom theo orderId: hai số khác nhau cùng dẫn về
 * MỘT đơn (SĐT mẹ ở đơn, SĐT bố trong nội dung) vẫn là một ứng viên, không phải
 * nhập nhằng.
 */
export function decideByPhoneCandidates(
  lookups: PhoneLookup[],
  content: string,
  amount: number,
): ResolveOutcome {
  const winners = new Map<string, PhoneCandidate>();
  const notes: string[] = [];

  for (const { phone, orders } of lookups) {
    const picked = pickOrderForPhone(phone, orders, content, amount);
    if (picked.order) winners.set(picked.order.id, picked.order);
    if (picked.note) notes.push(picked.note);
  }

  if (winners.size === 0) {
    return { target: null, note: notes.join("; ") || undefined };
  }

  // ⚠️ ≥2 ĐƠN KHÁC NHAU cùng "hợp lệ" ⇒ KHÔNG rót. Nội dung CK có nhiều số (số
  // người gửi + số phụ huynh) là ca thật; chọn bừa một đơn là rót tiền nhà này vào
  // nợ nhà khác rồi tự động chốt đơn + gửi biên nhận — hỏng theo cách rất khó phát
  // hiện. Tiền vẫn nằm nguyên ở BankTransaction, kế toán gán tay.
  if (winners.size > 1) {
    const phones = lookups.map((l) => l.phone);
    const detail = [...winners.values()].map(describeCandidate).join(", ");
    return {
      target: null,
      note:
        `Nội dung CK chứa ${phones.length} số điện thoại (${phones.join(", ")}) dẫn tới ` +
        `${winners.size} đơn khác nhau (${detail}) — cần gán tay`,
    };
  }

  const chosen = [...winners.values()][0]!;
  // Neo vào phiếu chưa đóng đủ SỚM NHẤT y hệt nhánh (c): nội dung CK mới KHÔNG
  // phân biệt được đợt 1 với đợt 2 (cùng một chuỗi), nên waterfall lo phần còn lại.
  const first = chosen.paymentRequests[0];
  if (!first) return { target: null };
  return { target: { paymentRequestId: first.id, orderId: chosen.id, via: "phone" } };
}

/** Đơn đang chờ thu gắn với MỘT số điện thoại (người mua / phụ huynh của học viên). */
async function findPendingOrdersByPhone(phone: string): Promise<PhoneCandidate[]> {
  // DB còn lẫn `0…` (dữ liệu cũ) lẫn `84…` (đường ghi mới) → phải nở cả 2 dạng,
  // đúng lý do `phoneVariants` tồn tại.
  const variants = phoneVariants(phone);
  return db.order.findMany({
    where: {
      // Đơn đã huỷ/hoàn tiền không phải đích rót tự động. DRAFT cũng KHÔNG: đó là
      // đơn sale ĐANG SOẠN DỞ (vẫn kịp có phiếu thu PENDING) — rót tiền vào đó là
      // chốt giùm một đơn chưa ai duyệt, và đơn thật của khách vẫn nợ. Nếu đơn bị
      // loại là ứng viên DUY NHẤT thì ta ra 0 đơn → UNMATCHED → kế toán quyết,
      // đúng ý đồ.
      //
      // PHIÊN B — trước đây nhánh này gõ tay `["DRAFT", "CANCELLED", "REFUNDED"]`, tức bản
      // sao thứ hai của danh sách. Nay dùng chung mảnh lọc với nhánh (a) và (c).
      ...locDonNhanTien(),
      paymentRequests: { some: { status: { in: ["PENDING", "PARTIAL"] } } },
      OR: [
        { customerPhone: { in: variants } },
        { student: { parentPhone: { in: variants } } },
        { student: { parentUser: { phone: { in: variants } } } },
      ],
    },
    select: {
      id: true,
      code: true,
      customerName: true,
      // ⚠️ PHẢI có: chuỗi đối chiếu được TÁI DỰNG bằng đúng công thức bên phát
      // (transferContentPartsForOrder), mà công thức đó lấy SĐT từ chính đơn —
      // không phải từ số vừa bóc ra khỏi nội dung CK.
      customerPhone: true,
      student: { select: { name: true } },
      items: { orderBy: { createdAt: "asc" }, take: 1, select: { itemName: true } },
      paymentRequests: {
        where: { status: { in: ["PENDING", "PARTIAL"] } },
        orderBy: [{ sortOrder: "asc" }, { installmentNo: "asc" }],
        // KHÔNG `take: 1` nữa: tiêu chí phụ theo số tiền (bên dưới) cần phần CÒN
        // THIẾU của CẢ ĐƠN, mà phần đó là tổng của mọi phiếu chưa đóng đủ.
        select: {
          id: true,
          amountDue: true,
          sortOrder: true,
          status: true,
          allocations: { select: { amount: true } },
        },
      },
    },
    // Trần an toàn: một SĐT ra vài chục đơn là dữ liệu bất thường, đã chắc chắn
    // phải xử lý tay — không cần kéo hết về chỉ để đếm.
    take: 20,
  });
}

/**
 * Chuẩn hoá để SO TÊN: đưa `đ/Đ` về `d/D` TRƯỚC khi `normalizeContent` xoá ký tự lạ.
 *
 * ⚠️ Bỏ bước này là hỏng thật, đã đo: `normalizeContent("Trần Đức Anh")` ra
 * "TRANUCANH" — chữ Đ (U+0110, không phân rã NFD được) bị xoá THẲNG — trong khi
 * nội dung CK do chính ta sinh ra là "TranDucAnh". Hai vế không bao giờ "chứa"
 * nhau, nên mọi tên có chữ Đ ở giữa mất khả năng thu hẹp.
 */
function normalizeForCompare(s: string | null | undefined): string {
  return normalizeContent(
    String(s ?? "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D"),
  );
}

/** Phiếu thu chờ thu của một đơn ứng viên — đủ số liệu để tính phần CÒN THIẾU. */
type CandidateRequest = {
  id: string;
  amountDue: number;
  sortOrder: number;
  status: string;
  allocations: { amount: number }[];
};

export type PhoneCandidate = {
  id: string;
  code: string;
  customerName: string;
  customerPhone: string | null;
  student: { name: string } | null;
  items: { itemName: string }[];
  paymentRequests: CandidateRequest[];
};

/** Phần CÒN THIẾU của MỘT phiếu thu ứng viên. */
function outstandingOfRequest(r: CandidateRequest): number {
  return outstandingOf({
    id: r.id,
    amountDue: r.amountDue,
    allocated: r.allocations.reduce((s, a) => s + a.amount, 0),
    sortOrder: r.sortOrder,
    status: r.status as RequestStatus,
  });
}

/**
 * Phần CÒN THIẾU của cả đơn = tổng phần còn thiếu của mọi phiếu chưa đóng đủ.
 *
 * ⚠️ CHỈ dùng để MÔ TẢ đơn cho kế toán trong note. KHÔNG dùng để so với số tiền
 * giao dịch — xem `narrowByAmount`, hai vế đó khác đơn vị.
 */
function outstandingOfOrder(o: PhoneCandidate): number {
  return o.paymentRequests.reduce((sum, r) => sum + outstandingOfRequest(r), 0);
}

const vnd = (n: number): string => `${n.toLocaleString("vi-VN")}đ`;

/** Mô tả một đơn ứng viên cho kế toán: mã đơn + phần còn thiếu (để chọn nhanh). */
function describeCandidate(o: PhoneCandidate): string {
  return `${o.code} (còn thiếu ${vnd(outstandingOfOrder(o))})`;
}

/**
 * Chuỗi mà hệ thống THỰC SỰ PHÁT RA cho đơn này, ở trần của mã QR.
 *
 * ⚠️ Dựng bằng CHÍNH `transferContentPartsForOrder` chứ không ghép tay: bên phát
 * (bảng phiếu thu, hộp QR, ảnh VietQR) và bên đối khớp phải chung một công thức,
 * lệch nhau là tiền rơi vào đối soát tay mà không ai biết.
 *
 * VÌ SAO ở trần 25: đó là trần của trường "purpose of transaction" (EMVCo) — chuỗi
 * đi vào mã QR, tức chuỗi phụ huynh quét và ngân hàng gửi lại. Đây là bản dùng cho
 * mọi so-mảnh (tầng 2), vì mảnh ở bản 25 luôn là TIỀN TỐ của mảnh ở bản 80.
 */
function expectedPartsFor(
  o: PhoneCandidate,
  maxLength: number = VIETQR_ADDINFO_MAX,
): TransferContentParts {
  return transferContentPartsForOrder(
    {
      studentName: o.student?.name ?? null,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      courseName: o.items[0]?.itemName ?? null,
    },
    maxLength,
  );
}

/**
 * CẢ HAI chuỗi hệ thống phát ra cho đơn này — bản 25 (nhúng vào mã QR) và bản 80
 * (sale đọc qua điện thoại, phụ huynh gõ tay).
 *
 * ⚠️ VÌ SAO PHẢI THỬ CẢ HAI: bản 25 KHÔNG phải chuỗi con của bản 80 khi tên con bị
 * cắt — nhát cắt rơi vào GIỮA chuỗi nên tính liền mạch đứt (`NguyenV_849…` không
 * nằm trong `NguyenVanA_849…`). Chỉ tái dựng bản 25 thì mọi phụ huynh GÕ TAY theo
 * bản sale đọc đều trượt tầng 1, tụt xuống tầng 2 (bằng chứng yếu hơn, và tầng 2
 * chỉ nhận khi ra đúng một đơn) — mất bằng chứng mạnh một cách vô cớ.
 *
 * Thử thêm bản 80 chỉ có thể THÊM khớp, không thể khớp nhầm: nó chứa NHIỀU thông
 * tin hơn bản 25 (tên con đầy đủ), tức là điều kiện CHẶT hơn.
 */
function expectedContentsFor(o: PhoneCandidate): string[] {
  const short = expectedPartsFor(o, VIETQR_ADDINFO_MAX).content;
  const long = expectedPartsFor(o, MAX_TRANSFER_CONTENT).content;
  return short === long ? [short] : [short, long];
}

/**
 * Chọn đơn cho MỘT số điện thoại — hoặc trả lý do vì sao không chọn được.
 *
 * ⚠️ LUẬT LÕI (vá 20/08): SĐT KHÔNG BAO GIỜ đủ để rót tiền, KỂ CẢ khi chỉ có đúng
 * một đơn ứng viên. Phải có BẰNG CHỨNG PHỤ trong nội dung CK.
 *
 * Vì sao bỏ lối tắt "một ứng viên thì khỏi kiểm" (đã đo, hỏng thật): bà ngoại
 * chuyển hộ, ngân hàng ghi "CT tu 0912345678 NGUYEN THI B chuyen tien
 * TranMinhAnh_84905111222_Sata2" — số ĐẦU TIÊN là số người gửi. Nếu người gửi tình
 * cờ cũng là phụ huynh và có đúng 1 đơn đang chờ thu thì tiền nhà A rót vào đơn nhà
 * B, đơn B tự CONFIRMED + gửi biên nhận + cấp tài khoản phụ huynh, còn đơn A vẫn nợ.
 *
 * ⚠️ SỬA 20/08 (vòng 3) — BẰNG CHỨNG PHỤ SO VỚI CÁI GÌ. Bản trước đòi nội dung CK
 * chứa TÊN HỌC VIÊN ĐẦY ĐỦ hoặc TÊN KHOÁ ĐẦY ĐỦ. Sai chuẩn: chuỗi nhúng vào QR bị
 * cắt còn 25 ký tự (VIETQR_ADDINFO_MAX), mà ngân sách tên con = 25 − (len(tên
 * khoá) + 13) nên với khoá tên dài thì tên con MẤT SẠCH và tên khoá cũng cụt. Đo
 * trên danh mục thật: 8/11 khoá không bao giờ khớp ⇒ mọi giao dịch hợp lệ rơi vào
 * đối soát tay, im lặng. Nay so với **chuỗi hệ thống thực sự phát ra**:
 *
 * (Từ 20/08 vòng 4, `shortCourseToken` rút tên khoá về MÃ NGẮN 5 ký tự nên tên con
 * quay lại chuỗi 25 ở cả 11/11 khoá. Lợi ích phụ đáng kể cho chính hàm này: hai
 * anh em ruột cùng phụ huynh cùng khoá không còn sinh chuỗi giống hệt nhau ⇒ tầng
 * 1 hết hoà ⇒ bớt phải trông vào tiêu chí phụ theo số tiền.)
 *
 *  Tầng 1 — nội dung CHỨA trọn chuỗi tái dựng của đơn đó, thử CẢ HAI trần 25 và 80
 *    (xem `expectedContentsFor`). Bằng chứng mạnh nhất (gồm cả SĐT lẫn phần
 *    tên/khoá sống sót) và không thể khớp nhầm sang nhà khác.
 *  Tầng 2 — nội dung chứa TIỀN TỐ tên con (≥4 ký tự) HOẶC phần tên khoá sống sót
 *    (≥3 ký tự): phủ ca phụ huynh gõ tay bản 80 ký tự, hoặc ngân hàng cắt bớt.
 *    Chỉ nhận khi tầng này ra ĐÚNG MỘT đơn — nhiều đơn thì rơi xuống tầng 3.
 *  Tầng 3 — không đủ bằng chứng ⇒ null + note liệt kê đơn cho kế toán chọn.
 *
 * Luôn so kiểu "CHỨA" (không phải "BẰNG") vì ngân hàng chèn thêm chữ đầu/cuối
 * ("CT tu …", "GD …"), trên chuỗi đã bỏ dấu + viết hoa + bỏ ký tự lạ.
 */
function pickOrderForPhone(
  phone: string,
  orders: PhoneCandidate[],
  content: string,
  amount: number,
): { order: PhoneCandidate | null; note?: string } {
  if (orders.length === 0) {
    return {
      order: null,
      note: `Nội dung CK có SĐT ${phone} nhưng không có đơn nào đang chờ thu gắn với số này`,
    };
  }

  const norm = normalizeForCompare(content);
  const contains = (piece: string, min: number): boolean => {
    const n = normalizeForCompare(piece);
    return n.length >= min && norm.includes(n);
  };

  // ── Tầng 1 — khớp trọn chuỗi tái dựng ─────────────────────────────────────
  // ⚠️ Đơn KHÔNG có cả tên lẫn khoá thì chuỗi tái dựng chỉ còn mỗi SĐT; "khớp"
  // lúc đó chính là khớp bằng SĐT trần — đúng cái lỗ hổng "bà ngoại chuyển hộ".
  // Nên loại thẳng: đơn đó không có bằng chứng phụ nào để xác thực.
  const exact = orders.filter((o) => {
    const p = expectedPartsFor(o);
    if (!p.name && !p.course) return false;
    return expectedContentsFor(o).some((c) => contains(c, 4));
  });
  if (exact.length === 1) return { order: exact[0]! };
  if (exact.length > 1) {
    // Hoà ở tầng mạnh nhất = hai đơn CÙNG con, CÙNG khoá, CÙNG số (ghi danh lại).
    // Chỉ ở đây mới dùng tới số tiền — xem ghi chú "TIÊU CHÍ PHỤ" bên dưới.
    const byAmount = narrowByAmount(exact, amount);
    if (byAmount) return { order: byAmount };
    return { order: null, note: ambiguousNote(phone, exact, amount) };
  }

  // ── Tầng 2 — khớp mảnh ────────────────────────────────────────────────────
  // Ngưỡng 4 (tên) / 3 (khoá): dưới ngưỡng thì mảnh quá ngắn, khớp bừa mọi chuỗi.
  const partial = orders.filter((o) => {
    const p = expectedPartsFor(o);
    return contains(p.name, 4) || contains(p.course, 3);
  });
  // ⚠️ CHỈ nhận khi ra ĐÚNG MỘT đơn. Bằng chứng ở tầng này yếu (một mảnh chữ),
  // dùng số tiền để tách hoà là biến số tiền thành khoá đối khớp — cấm (bất biến #2).
  if (partial.length === 1) return { order: partial[0]! };

  // ── Tầng 3 — không đủ bằng chứng ──────────────────────────────────────────
  if (partial.length === 0) {
    const detail = orders.map(describeCandidate).join(", ");
    return {
      order: null,
      note:
        `Khớp SĐT ${phone} với ${orders.length} đơn ${detail} nhưng nội dung CK không ` +
        `nhắc tên học viên hay tên khoá của đơn nào — cần gán tay`,
    };
  }
  return { order: null, note: ambiguousNote(phone, partial, amount) };
}

/**
 * ⚠️ TIÊU CHÍ PHỤ — số tiền. Đây KHÔNG phải khoá đối khớp (bất biến #2 của file:
 * không bao giờ từ chối/quyết định NHẬN tiền vì lệch số). Nó chỉ THU HẸP ở bước
 * cuối, sau khi SĐT và bằng chứng chuỗi đã lọc, cho ca "hai đơn cùng con cùng
 * khoá" vốn tắc vĩnh viễn. Không tách được thì vẫn nhường cho gán tay.
 *
 * ⚠️ VÁ 20/08 — SO ĐÚNG ĐƠN VỊ: phần còn thiếu của TỪNG PHIẾU THU, KHÔNG phải của
 * cả đơn. Mọi mã QR đều phát theo PHIẾU (`_qr-core.ts` lấy `outstandingOfRequest`,
 * màn chi tiết đơn lấy `dueNow.amount` của đợt đang tới hạn), nên `amount` mà ngân
 * hàng gửi về luôn ở đơn vị "một phiếu". So với tổng của cả đơn là so hai đại
 * lượng khác nhau, và nó rót tiền vào SAI ĐƠN chứ không chỉ trượt:
 *
 *   Đơn A trả góp 2 đợt, còn thiếu 10tr (đợt 1 = 5tr) · Đơn B trọn gói còn 5tr,
 *   cùng SĐT + cùng tên con + cùng khoá nên hoà ở tầng 1. Phụ huynh quét QR đợt 1
 *   của A, chuyển 5tr → bản cũ thấy A(10tr)≠5tr, B(5tr)==5tr ⇒ "đúng một đơn" ⇒
 *   rót hết vào B, B tự CONFIRMED + gửi biên nhận + cấp tài khoản phụ huynh, còn A
 *   vẫn nợ. Bản này: A có phiếu 5tr, B có phiếu 5tr ⇒ 2 đơn ⇒ trả null, gán tay.
 *
 * Vẫn GIỮ tie-break (thay vì bỏ hẳn) vì sau khi tên con quay lại chuỗi 25 ký tự,
 * hoà ở tầng 1 chỉ còn xảy ra với hai đơn CÙNG con CÙNG khoá (ghi danh lại, hoặc
 * anh em trùng 7 ký tự đầu của tên) — ca hiếm mà bỏ tie-break là tắc vĩnh viễn.
 */
function narrowByAmount(pool: PhoneCandidate[], amount: number): PhoneCandidate | null {
  if (amount <= 0) return null;
  const hit = pool.filter((o) => o.paymentRequests.some((r) => outstandingOfRequest(r) === amount));
  return hit.length === 1 ? hit[0]! : null;
}

/** Note tầng 3: kế toán cần mã đơn + phần còn thiếu để chọn tay cho nhanh. */
function ambiguousNote(phone: string, pool: PhoneCandidate[], amount: number): string {
  const detail = pool.map(describeCandidate).join(", ");
  return (
    `Khớp SĐT ${phone} và nội dung CK nhưng còn ${pool.length} đơn đang chờ thu ` +
    `${detail} — số tiền ${vnd(amount)} không tách được đơn nào, cần chọn tay`
  );
}

/**
 * Tìm phiếu thu đích: (a) `matchKey` → (b) `providerOrderCode` → QrSession → phiếu
 * → (c) mã đơn trong nội dung → (d) SĐT phụ huynh trong nội dung.
 *
 * ⚠️ Nhánh (b) KHÔNG được lọc theo `expiresAt`/`status` của QrSession. Sale xuất
 * lại QR 5 lần thì có 5 session cùng trỏ 1 phiếu thu; PH quét cái nào, hết hạn
 * bao lâu, tiền cũng phải về đúng phiếu đó.
 *
 * ⚠️ THỨ TỰ LÀ HỢP ĐỒNG HỒI QUY: (a)(b)(c) phải chạy TRƯỚC (d) thì mọi QR/nội dung
 * CK phát trước 20/08 (còn mang `ORD…D1`) mới tiếp tục khớp y như cũ.
 */
export async function resolvePaymentTargetDetailed(
  data: PayosWebhookData,
): Promise<ResolveOutcome> {
  const candidates = collectMatchKeyCandidates(data);
  if (candidates.length > 0) {
    const rows = await db.paymentRequest.findMany({
      // PHIÊN A — hai vế lọc THÊM so với bản cũ, và cả hai đều là tiền:
      //  · phiếu VOID không còn là đích rót (huỷ đợt xong mà QR cũ vẫn khớp là rót vào chỗ đã bỏ);
      //  · đơn DRAFT/CANCELLED/REFUNDED không nhận tiền tự động — xem hằng ở trên.
      where: {
        matchKey: { in: candidates },
        status: { not: "VOID" },
        order: locDonNhanTien(),
      },
      select: { id: true, orderId: true, matchKey: true },
    });
    for (const c of candidates) {
      const hit = rows.find((r) => r.matchKey === c);
      if (hit) {
        return { target: { paymentRequestId: hit.id, orderId: hit.orderId, via: "matchKey" } };
      }
    }
  }

  const orderCode = data.orderCode != null ? String(data.orderCode).trim() : "";
  if (orderCode) {
    const session = await db.qrSession.findUnique({
      where: { providerOrderCode: orderCode },
      select: {
        id: true,
        paymentRequest: {
          select: {
            id: true,
            orderId: true,
            status: true,
            order: { select: { status: true, deletedAt: true } },
          },
        },
      },
    });
    // PHIÊN A — cùng hai vế lọc như nhánh (a). Ở đây phải lọc SAU khi tra (không phải trong
    // `where`) vì `findUnique` khoá theo `providerOrderCode`; thêm điều kiện vào `where` của
    // `findUnique` là lỗi kiểu, không phải lựa chọn.
    const phieuCuaQr = session?.paymentRequest ?? null;
    const qrConHieuLuc = qrConRotDuocTien(phieuCuaQr);
    if (session && phieuCuaQr && qrConHieuLuc) {
      return {
        target: {
          paymentRequestId: session.paymentRequest.id,
          orderId: session.paymentRequest.orderId,
          via: "qrSession",
          qrSessionId: session.id,
        },
      };
    }
  }

  // (c) Chỉ ra được MÃ ĐƠN, không ra đợt — nội dung CK của khách chuyển tay, hoặc
  // QR cũ in trước khi có định danh theo đợt. Vẫn phải nhận tiền: neo vào phiếu
  // chưa đóng đủ sớm nhất của đơn rồi để waterfall lo phần còn lại. Không map
  // được đợt KHÔNG phải lý do đẩy sang xử lý tay.
  for (const c of collectMatchKeyCandidates(data)) {
    const code = extractOrderCode(c);
    if (!code) continue;
    // PHIÊN B — `findFirst` chứ không `findUnique`, chỉ để CHỖ NÀY nhận thêm được mảnh lọc
    // (`findUnique` chỉ nhận đúng khoá). `code` vẫn là cột `@unique` nên kết quả không đổi
    // nghĩa: vẫn là "đơn mang mã này", chỉ thêm "và đơn ấy còn nhận tiền tự động được".
    //
    // TRƯỚC BẢN VÁ: nhánh này tra mã đơn rồi rót vào phiếu chưa đóng sớm nhất, KHÔNG hỏi đơn
    // đang ở trạng thái nào — đơn DRAFT (sale soạn dở, đã kịp có phiếu PENDING), đơn CANCELLED
    // và đơn REFUNDED đều hút được tiền. Đây là nhánh của nội dung CK đời cũ `ORD…D<số>`, tức
    // nhánh mà dữ liệu thật đang đi qua nhiều nhất, và PHIÊN A đã bỏ sót đúng nó.
    //
    // (Đơn XOÁ MỀM thì chưa bao giờ lọt ở đây: `Order` ∈ `SOFT_DELETE_MODELS` nên tầng base của
    // `lib/db.ts` tự chèn `deletedAt: null`. Vế ấy trong `locDonNhanTien()` giữ cho câu `where`
    // tự nói đủ luật — nhánh (a) mới là chỗ nó thật sự gánh việc.)
    const order = await db.order.findFirst({
      where: { code, ...locDonNhanTien() },
      select: {
        id: true,
        paymentRequests: {
          where: { status: { in: ["PENDING", "PARTIAL"] } },
          orderBy: [{ sortOrder: "asc" }, { installmentNo: "asc" }],
          select: { id: true },
          take: 1,
        },
      },
    });
    const first = order?.paymentRequests[0];
    if (order && first) {
      return { target: { paymentRequestId: first.id, orderId: order.id, via: "orderCode" } };
    }
  }

  // (d) Nội dung CK dạng người đọc `HoTenCon_SdtPH_TenKhoa` (chốt 20/08) — không
  // còn mã đơn để bám, tra ngược từ SĐT phụ huynh.
  return resolveByPhone(data);
}

/** Bản gọn giữ cho đường gọi cũ/test cũ — bỏ phần lý do, chỉ lấy đích. */
export async function resolvePaymentTarget(data: PayosWebhookData): Promise<MatchTarget | null> {
  return (await resolvePaymentTargetDetailed(data)).target;
}

// ── Thân xử lý ──────────────────────────────────────────────────────────────
type TxResult =
  | { kind: "DUPLICATE" }
  | {
      kind: "MATCHED";
      allocated: number;
      credit: number;
      waived: number;
      settled: boolean;
    };

/**
 * Giao dịch đang ở hàng chờ VÌ KẾ TOÁN VỪA GỠ GẮN nó (`goGanTheoCon` ghi `unmatchedNote` bắt đầu
 * bằng `TIEN_TO_GO_GAN`). Webhook gửi lại của chính giao dịch này không được tự khớp — xem chỗ gọi.
 */
function laGiaoDichVuaGoGan(txn: { status: string; unmatchedNote: string | null }): boolean {
  return txn.status === "UNMATCHED" && (txn.unmatchedNote ?? "").startsWith(TIEN_TO_GO_GAN);
}

/**
 * Ghi nhận + phân bổ MỘT giao dịch tiền về. Idempotent theo `providerTxnId`.
 * Gọi được thẳng từ test (không cần HTTP) — route chỉ là vỏ.
 *
 * `provider` tham số hoá vì hai cổng dùng CHUNG đường này: payOS (khi đã xác thực
 * doanh nghiệp xong) và SePay (đang chạy thật). Khác nhau chỉ ở khâu đọc payload
 * — phần ghi sổ, phân bổ, chống đua, side-effect sau commit là một.
 */
export async function ingestPayosWebhook(
  data: PayosWebhookData,
  provider: string = PAYOS_PROVIDER,
): Promise<IngestOutcome> {
  if (isPayosVerificationPing(data)) {
    return { status: "IGNORED", reason: "Ping xác thực webhook của payOS" };
  }

  const amount = Math.round(Number(data.amount ?? 0));
  if (!Number.isFinite(amount) || amount <= 0) {
    await logPayos({
      provider,
      action: "INGEST_TXN",
      status: "SKIPPED",
      payload: data,
      error: "Số tiền không hợp lệ",
    });
    return { status: "IGNORED", reason: "Số tiền không hợp lệ" };
  }

  const providerTxnId = resolveProviderTxnId(data);
  if (!providerTxnId) {
    await logPayos({
      provider,
      action: "INGEST_TXN",
      status: "FAILED",
      payload: data,
      error: "Thiếu định danh giao dịch (reference/paymentLinkId/orderCode)",
    });
    return { status: "IGNORED", reason: "Thiếu định danh giao dịch" };
  }

  const where = { provider_providerTxnId: { provider, providerTxnId } };

  // ── Bước 2: upsert BankTransaction (khoá idempotency) ─────────────────────
  let txn = await db.bankTransaction.findUnique({ where });
  if (txn && txn.status !== "UNMATCHED") {
    // Đã xử lý xong rồi → trả ngay, KHÔNG phân bổ lần 2. IGNORED ≠ "đã ghi nhận" (rà vòng 5, `[V5-60]`).
    if (txn.status === "IGNORED") {
      await logPayos({ provider, action: "INGEST_TXN", status: "SKIPPED", payload: data, error: LY_DO_DA_BO_QUA });
      return { status: "DUPLICATE", bankTransactionId: txn.id, lyDo: "DA_BO_QUA" };
    }
    await logPayos({ provider, action: "INGEST_TXN", status: "SKIPPED", payload: data, error: "Đã ghi nhận" });
    return { status: "DUPLICATE", bankTransactionId: txn.id };
  }
  // Giao dịch vừa được KẾ TOÁN GỠ GẮN (kèm lý do) mà nhà cung cấp gửi lại webhook của CHÍNH nó
  // (tự thử lại / ai đó bấm "Gửi lại") ⇒ KHÔNG tự khớp lại, KHÔNG ghi đè lý do gỡ. Trước bản vá,
  // lượt gửi lại khớp đúng phiếu vừa mở lại và đảo ngược lượt gỡ im lặng — kế toán đã hoàn tiền
  // thì sổ lại báo đã thu (rà vòng 3, ca `[V3-10]` phiếu gộp, `[V3-11]` mã đời cũ). Cùng luật với
  // thẻ POS (`nhap-lo-pos.ts`, nhánh "vừa gỡ gắn"). Gắn tay lại vẫn làm được — đường đó không qua đây.
  if (txn && laGiaoDichVuaGoGan(txn)) {
    await logPayos({ provider, action: "INGEST_TXN", status: "SKIPPED", payload: data, error: LY_DO_DA_GO_GAN });
    return { status: "DUPLICATE", bankTransactionId: txn.id, lyDo: "DA_GO_GAN" };
  }
  if (!txn) {
    const createData = {
      provider,
      providerTxnId,
      amount,
      transferredAt: parseTransferredAt(data.transactionDateTime),
      accountNumber:
        (typeof data.accountNumber === "string" ? data.accountNumber : null) ??
        (typeof data.virtualAccountNumber === "string" ? data.virtualAccountNumber : null),
      referenceCode: typeof data.reference === "string" ? data.reference : null,
      content: typeof data.description === "string" ? data.description : null,
      rawPayload: data as Prisma.InputJsonValue,
    };
    try {
      txn = await db.bankTransaction.create({ data: createData });
    } catch (err) {
      if (!isUniqueViolation(err)) {
        const message = err instanceof Error ? err.message : "Unknown";
        await logPayos({ provider, action: "INGEST_TXN", status: "FAILED", payload: data, error: message });
        return { status: "ERROR", reason: message };
      }
      // Hai webhook cùng giao dịch chạy song song → cái thua đọc lại bản của cái thắng.
      txn = await db.bankTransaction.findUnique({ where });
      if (!txn) return { status: "ERROR", reason: "Không đọc lại được giao dịch vừa tạo" };
      if (laGiaoDichVuaGoGan(txn)) {
        return { status: "DUPLICATE", bankTransactionId: txn.id, lyDo: "DA_GO_GAN" };
      }
      if (txn.status === "IGNORED") {
        return { status: "DUPLICATE", bankTransactionId: txn.id, lyDo: "DA_BO_QUA" };
      }
      if (txn.status !== "UNMATCHED") {
        return { status: "DUPLICATE", bankTransactionId: txn.id };
      }
    }
  }
  const bankTransactionId = txn.id;

  // ── Bước 3½: THỬ ĐƯỜNG PHIẾU GỘP TRƯỚC  [PHIÊN C · 20/09/2026] ────────────
  //
  // Mã 5 ký tự trong nội dung CK nói thẳng "phiếu nào", nên nó phải được hỏi TRƯỚC mọi phép
  // suy đoán của đường cũ (orderCode / VA / SĐT). Hỏi sau là để một phép đoán theo SĐT có cơ
  // hội cướp một giao dịch đã biết đích.
  //
  // ⚠️ `thuTheoPhieuGop` NHƯỜNG (`xuLy: false`) khi không tra ra phiếu gộp nào — kể cả khi
  // memo có một khối 5 ký tự qua checksum. Checksum lọc 26/27 khối rác chứ không lọc hết, nên
  // một memo ĐỜI CŨ vẫn có ~1/27 cơ hội chứa khối qua checksum; nuốt ca đó là đẩy ~1/27 giao
  // dịch đời cũ xuống UNMATCHED không lý do. Lý lẽ đầy đủ ở đầu hàm.
  const gop = await thuTheoPhieuGop({
    bankTransactionId,
    provider,
    providerTxnId,
    noiDung: typeof data.description === "string" ? data.description : null,
    soTienVe: amount,
    // Webhook chuyển khoản: ngày thu = lúc nhận webhook (giữ nguyên hành vi trước 29/09/2026).
    ngayThu: new Date(),
  });
  if (gop.xuLy) {
    if (gop.ketQua === "TRUNG") {
      await logPayos({ provider, action: "INGEST_TXN", status: "SKIPPED", payload: data, error: "Đã ghi nhận" });
      return { status: "DUPLICATE", bankTransactionId };
    }
    if (gop.ketQua === "CHUA_CHIA") {
      await logPayos({ provider, action: "MATCH_TXN", status: "FAILED", payload: data, error: gop.ghiChu });
      return { status: "UNMATCHED", bankTransactionId, reason: gop.ghiChu };
    }
    await logPayos({ provider, action: "MATCH_TXN", status: "SUCCESS", payload: data });
    // ⚠️ `paymentRequestId` là ĐÍCH ĐẦU TIÊN của phiếu — một phiếu thu CÓ THẬT vừa nhận tiền,
    // không phải số giả. Phiếu gộp có n đích, nên ai cần đủ thì đọc `billId` rồi tra
    // `PaymentBillLine`. Nới `IngestOutcome` thành mảng sẽ chạm mọi đường gọi đời cũ mà không
    // đường nào trong số đó đọc trường này.
    //
    // `settled: false` · `orderConfirmed: false` là SỰ THẬT CỦA LƯỢT NÀY: đường phiếu gộp không chốt
    // đơn TRONG lượt nhận webhook. [SỬA chú thích 06/10/2026 — F4 của docs/pos-gd1-thiet-ke.md] Lý do
    // cũ ("chốt đơn thuộc đường cũ vì cổng giảm giá chưa duyệt") đã CHẾT: cổng ấy gỡ từ 14/09. Từ GĐ1
    // POS, `thuTheoPhieuGop` phát sự kiện `phieu-gop.da-chia` và handler (`lib/payments/sau-da-chia.ts`)
    // chốt đơn thu đủ SAU commit bằng CHÍNH `sauKhiDonThuDu` mà `allocateToOrder` dùng — bất đồng bộ.
    return {
      status: "MATCHED",
      bankTransactionId,
      orderId: gop.orderId,
      paymentRequestId: gop.paymentRequestIds[0] ?? "",
      allocated: gop.tong,
      credit: 0,
      waived: 0,
      settled: false,
      orderConfirmed: false,
    };
  }

  // ── Bước 4: tra đích phân bổ ──────────────────────────────────────────────
  const resolved = await resolvePaymentTargetDetailed(data);
  const target = resolved.target;
  if (!target) {
    const note =
      `Không tra ra phiếu thu. orderCode=${data.orderCode ?? "-"}, ` +
      `VA=${data.virtualAccountNumber ?? "-"}, ref=${data.reference ?? "-"}, ` +
      `nội dung="${data.description ?? "-"}"` +
      // Lý do CỤ THỂ (vd "khớp SĐT … nhưng có 2 đơn đang chờ thu") là thứ kế toán
      // cần để gán tay ở /admin/bien-dong-so-du — không có nó thì họ phải tự dò.
      (resolved.note ? `. ${resolved.note}` : "");
    await db.bankTransaction.update({
      where: { id: bankTransactionId },
      data: { status: "UNMATCHED", unmatchedNote: note },
    });
    await logPayos({ provider, action: "MATCH_TXN", status: "FAILED", payload: data, error: note });
    return { status: "UNMATCHED", bankTransactionId, reason: note };
  }

  const order = await db.order.findUnique({
    where: { id: target.orderId },
    select: {
      id: true,
      code: true,
      status: true,
      centerId: true,
      orgUnitId: true,
      studentId: true,
      leadId: true,
      student: { select: { id: true, parentUserId: true } },
    },
  });
  if (!order) {
    const note = `Phiếu thu ${target.paymentRequestId} trỏ tới đơn không tồn tại`;
    await db.bankTransaction.update({
      where: { id: bankTransactionId },
      data: { status: "UNMATCHED", unmatchedNote: note },
    });
    await logPayos({ provider, action: "MATCH_TXN", status: "FAILED", payload: data, error: note });
    return { status: "UNMATCHED", bankTransactionId, reason: note };
  }

  // Từ đây là phần DÙNG CHUNG với đối soát tay ở /admin/bien-dong-so-du —
  // xem `allocateToOrder`. Hai đường phải rót tiền y hệt nhau, nếu không thì
  // giao dịch gán tay và giao dịch webhook để lại hai loại dấu vết khác nhau
  // trong sổ, và không ai đối chiếu nổi.
  return allocateToOrder({ bankTransactionId, order, amount, provider, providerTxnId, target, data });
}

/**
 * Phần của ĐƠN mà việc rót tiền cần đọc. Khai tường minh (thay vì suy từ Prisma)
 * để đường gán tay biết chính xác phải `select` những cột nào — thiếu `orgUnitId`
 * là dung sai làm tròn đọc nhầm cấu hình, thiếu `student` là không cấp được tài
 * khoản phụ huynh sau khi đơn chốt.
 */
export type AllocationOrder = {
  id: string;
  code: string;
  status: string;
  centerId: string | null;
  orgUnitId: string | null;
  studentId: string | null;
  student: { id: string; parentUserId: string | null } | null;
  /**
   * Lead của đơn — cần để đẩy phễu lên "Đã đăng ký" khi tiền về.
   *
   * ⚠️ BẮT BUỘC, cố ý không cho `?`. Đây là luật 7 của repo (CLAUDE.md): trường tuỳ chọn ở
   * đây nghĩa là chỗ gọi nào quên `select: { leadId: true }` thì nhận `undefined`, cổng phễu
   * im lặng không chạy, và KHÔNG lỗi nào báo — đúng lớp lỗi câm mà cả phiên I sinh ra để vá.
   * Để nó bắt buộc thì `tsc` liệt kê đủ chỗ gọi: mắt thấy 1, trình biên dịch thấy 2.
   */
  leadId: string | null;
};

/**
 * RÓT một giao dịch đã ghi sổ vào phiếu thu của MỘT đơn — thân chung của cả hai
 * đường: webhook cổng thanh toán (`ingestPayosWebhook`) và ĐỐI SOÁT TAY của kế
 * toán (`/admin/bien-dong-so-du`).
 *
 * ⚠️ VÌ SAO PHẢI DÙNG CHUNG. Rót tiền không chỉ là ghi `PaymentAllocation`: còn
 * phải khoá đơn (advisory lock), đọc lại trạng thái trong khoá để hai luồng song
 * song không rót hai lần, tính lại trạng thái phiếu TỪ SỔ, ghi tiền dư sang
 * `CreditBalance`, ghi song song sổ CŨ (`Payment` marker) vì công nợ hiển thị vẫn
 * đọc ở đó, rồi mới tới side-effect sau commit (chốt đơn, cấp tài khoản phụ
 * huynh, gửi biên nhận). Viết bản thứ hai cho đường gán tay là chắc chắn bỏ sót
 * vài bước, và bỏ sót ở đây nghĩa là tiền vào sổ mới mà công nợ không đổi.
 *
 * Idempotent: đọc lại `BankTransaction.status` TRONG khoá, khác `UNMATCHED` thì
 * rút lui với `DUPLICATE`. Nhờ vậy kế toán bấm hai lần cũng chỉ rót một lần.
 */
export async function allocateToOrder(params: {
  bankTransactionId: string;
  order: AllocationOrder;
  amount: number;
  provider: string;
  providerTxnId: string;
  target: MatchTarget;
  /** Payload gốc — chỉ dùng để ghi nhật ký. Đường gán tay truyền bản tóm tắt. */
  data: PayosWebhookData;
}): Promise<IngestOutcome> {
  const { bankTransactionId, order, amount, provider, providerTxnId, target, data } = params;
  // Dung sai làm tròn — đọc TRƯỚC transaction (getSetting tự truy vấn DB riêng,
  // gọi trong transaction là mời deadlock pool).
  const tolerance = await getSetting("payment.roundingToleranceVnd", {
    orgUnitId: order.orgUnitId,
  }).catch(() => 5_000);

  // ── Bước 3/5/6/7: transaction + advisory lock theo đơn ────────────────────
  let result: TxResult;
  try {
    result = await db.$transaction(async (tx) => {
      // ⚠️ PHẢI $executeRaw, KHÔNG $queryRaw: `pg_advisory_xact_lock()` trả kiểu
      // `void`, Prisma sẽ ném "Failed to deserialize column of type 'void'"
      // (đúng con bug PR #76 — test hồi quy tests/e2e/a0/zalo-token-lock.spec.ts).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${order.id})::bigint)`;
      // Khoá DÒNG giao dịch trước khi đọc trạng thái — khoá đơn không chặn lượt gắn cùng giao
      // dịch vào ĐƠN KHÁC (xem `khoaGiaoDichTrongTx`).
      await khoaGiaoDichTrongTx(tx, bankTransactionId);

      // Trong khoá mới đọc lại trạng thái giao dịch: hai webhook cùng txn chạy
      // song song thì cái vào sau thấy MATCHED và rút lui, không rót tiền 2 lần.
      const fresh = await tx.bankTransaction.findUnique({
        where: { id: bankTransactionId },
        // `provider` + `transferredAt`: ngày thu của `Payment` — nguồn thẻ POS lấy giờ quẹt
        // (`ngayThuCuaGiaoDich`), chuyển khoản giữ `new Date()`.
        select: { status: true, provider: true, transferredAt: true },
      });
      if (!fresh || fresh.status !== "UNMATCHED") return { kind: "DUPLICATE" as const };

      const rows = await tx.paymentRequest.findMany({
        where: { orderId: order.id },
        select: {
          id: true,
          amountDue: true,
          sortOrder: true,
          status: true,
          allocations: { select: { amount: true, roundingWaived: true } },
        },
        orderBy: { sortOrder: "asc" },
      });
      if (rows.length === 0) {
        // Phiếu vừa bị xoá giữa chừng — coi như không tra ra.
        throw new NoRequestError();
      }

      const targets: AllocTarget[] = rows.map((r) => ({
        id: r.id,
        amountDue: r.amountDue,
        // Rà vòng 5 (nhánh anh em của `[V5-50]`): cộng cả phần ĐÃ THA theo dung sai — cùng phép
        // `getOrderPaymentRequests` (DS-01) và `deriveStatus`. Chỉ cộng tiền thật thì đợt PAID nhờ
        // dung sai vẫn "còn thiếu" đúng phần tha ⇒ khoản tiền sau rót thêm vào đó (thu lại phần tha).
        allocated: r.allocations.reduce((s, a) => s + a.amount + a.roundingWaived, 0),
        sortOrder: r.sortOrder,
        status: r.status as RequestStatus,
      }));

      const plan = planAllocation(amount, targets, target.paymentRequestId, tolerance);

      if (plan.lines.length > 0) {
        await tx.paymentAllocation.createMany({
          data: plan.lines.map((l) => ({
            bankTransactionId,
            paymentRequestId: l.paymentRequestId,
            amount: l.amount,
            // PHẢI lưu phần tha: `deriveStatus` cần nó mới coi phiếu là PAID. Không
            // lưu thì mọi lần tính lại trạng thái sau này (recomputeRequestStatuses)
            // truyền waived=0 và ghi đè PAID về PARTIAL — dung sai chỉ đúng 1 lần.
            roundingWaived: l.roundingWaived,
            centerId: order.centerId,
          })),
          skipDuplicates: true,
        });
      }

      // Tính lại status TỪ SỔ (không cộng nhẩm): đọc tổng phân bổ + tổng phần tha
      // thực tế sau ghi, để kết quả trùng khớp với mọi lần recompute về sau.
      const affected = plan.lines.map((l) => l.paymentRequestId);
      const sums =
        affected.length > 0
          ? await tx.paymentAllocation.groupBy({
              by: ["paymentRequestId"],
              where: { paymentRequestId: { in: affected } },
              _sum: { amount: true, roundingWaived: true },
            })
          : [];
      const rowOf = (id: string) => sums.find((s) => s.paymentRequestId === id);
      const sumOf = (id: string) => rowOf(id)?._sum.amount ?? 0;
      const waivedOf = (id: string) => rowOf(id)?._sum.roundingWaived ?? 0;

      const statusById = new Map<string, RequestStatus>(
        targets.map((t) => [t.id, t.status]),
      );
      for (const line of plan.lines) {
        const row = rows.find((r) => r.id === line.paymentRequestId)!;
        const next = deriveStatus(
          row.amountDue,
          sumOf(line.paymentRequestId),
          waivedOf(line.paymentRequestId),
          row.status as RequestStatus,
        );
        statusById.set(line.paymentRequestId, next);
        if (next !== row.status) {
          // Rà vòng 5: ghi CÓ ĐIỀU KIỆN `status ≠ VOID`. `row.status` là ẢNH CHỤP đầu transaction;
          // một đường VOID đợt (huỷ đơn, lưu kế hoạch…) commit giữa lúc đọc và lúc ghi thì `update`
          // trần làm đợt đã huỷ SỐNG LẠI thành PAID. Mọi đường VOID đã lấy khoá đơn (cùng khoá ở
          // trên) — đây là lớp phòng thủ, không phải cơ chế chính.
          await tx.paymentRequest.updateMany({
            where: { id: line.paymentRequestId, status: { not: "VOID" } },
            data: { status: next },
          });
        }
      }

      await tx.bankTransaction.update({
        where: { id: bankTransactionId },
        data: { status: "MATCHED", centerId: order.centerId, unmatchedNote: null },
      });

      // QR đã dùng → đánh dấu CONSUMED (chỉ để hiển thị; KHÔNG bao giờ là điều
      // kiện đối khớp — session CONSUMED/EXPIRED vẫn tra ra phiếu như thường).
      if (target.qrSessionId) {
        await tx.qrSession.updateMany({
          where: { id: target.qrSessionId, status: { not: "CONSUMED" } },
          data: { status: "CONSUMED" },
        });
      }

      if (plan.credit > 0) {
        await tx.creditBalance.create({
          data: {
            parentUserId: order.student?.parentUserId ?? null,
            studentId: order.studentId,
            orderId: order.id,
            bankTransactionId,
            centerId: order.centerId,
            amount: plan.credit,
            note: `Tiền dư từ giao dịch ${provider} ${providerTxnId} (đơn ${order.code})`,
          },
        });
      }

      const allocated = plan.lines.reduce((s, l) => s + l.amount, 0);
      const waived = plan.lines.reduce((s, l) => s + l.roundingWaived, 0);

      // ── Ghi SỔ CŨ song song (giai đoạn trước cutover) ───────────────────────
      // Cờ PAYMENT_LEDGER_V2 còn TẮT ⇒ công nợ hiển thị (màn /cong-no, học phí của
      // phụ huynh, dashboard) VẪN đọc `Payment`. Không ghi sang đó thì đơn thanh
      // toán qua payOS hiện ra "chưa đóng đồng nào" ở mọi màn tiền — đúng cái bẫy
      // sẽ nổ nếu bật payOS trước khi cutover.
      //
      // Marker RIÊNG `[auto:payos:<txn>]`, KHÔNG dùng lại [auto:order-confirm] /
      // [auto:order-installment:dotN]: hai marker đó idempotent theo (orderId, soDot)
      // nên lần đóng thứ hai vào CÙNG một đợt (trả thiếu rồi trả bù) sẽ bị nuốt →
      // sổ cũ thiếu tiền. Neo theo mã giao dịch thì mỗi lần tiền về là một dòng,
      // và webhook retry vẫn idempotent vì cùng providerTxnId.
      //
      // ⚠️ PHÉP KIỂM TRÙNG hỏi "còn DÒNG THU nào của giao dịch này đang GIỮ TIỀN không", KHÔNG
      // hỏi "có dòng nào mang marker không" [vá 28/09/2026]. Gỡ gắn (`goGanTheoCon`) giữ dòng
      // gốc + đẻ bút toán đảo rồi đưa giao dịch về UNMATCHED; hỏi kiểu cũ thì lượt gắn lại vào
      // CÙNG đơn thấy dòng gốc đã đảo và bỏ qua ⇒ phân bổ nói đã thu, sổ cũ nói 0. Luật đầy đủ
      // ở `conDongThuGiuTien`; ca `[GGL-01]` (`tests/finance/go-gan-gan-lai.test.ts`).
      if (allocated > 0) {
        const marker = `[auto:${provider.toLowerCase()}:${providerTxnId}]`;
        // Cùng lỗ đó trên đường thẻ POS: gỡ gắn rồi "Rót vào đơn" lại ghi phân bổ + MATCHED mà
        // KHÔNG ghi `Payment` — sổ B đã thu, sổ A ròng = 0 (ca `[POS-DB-21]`). Nhánh SmartPOS
        // từng vá bằng "dòng gốc chưa có bút toán con nào" — bản rút gọn mà `conDongThuGiuTien`
        // cấm (`[GGL-04]`); gộp 01/10/2026 dùng một hàm cho cả hai.
        const daGhiSoCu = await conDongThuGiuTien(tx, { orderId: order.id, marker });
        if (!daGhiSoCu) {
          // ── GẮN GHI DANH cho khoản tiền về (14/09/2026) ───────────────────────
          //
          // ĐO ĐƯỢC: `confirmPayment` (lib/finance/payment.ts) mở đầu bằng
          // `if (!existing.enrollmentId) return fail(...)`. Khoản do webhook sinh ra
          // trước đây KHÔNG mang `enrollmentId` (grep `enrollmentId` trong tệp này ra
          // 0 kết quả) ⇒ kế toán KHÔNG BAO GIỜ xác nhận được nó ⇒ TRỤC A
          // (`accountantStatus: CONFIRMED`) không bao giờ cộng ⇒ `/cong-no` và cổng
          // phụ huynh KHÔNG giảm nợ cho MỌI đồng tiền về qua QR. Tiền thật đã vào tài
          // khoản mà màn hình vẫn báo nợ nguyên.
          //
          // Thêm tầng thứ hai: cổng phụ huynh cộng tiền theo QUAN HỆ
          // `Enrollment.payments` (lib/portal/billing-student.ts, dashboard.ts) — khoản
          // `enrollmentId = null` thì dù có xác nhận được cũng không trừ vào công nợ
          // của ghi danh nào.
          //
          // ⚠️ KHÔNG gọi `ensureOrderPaymentRecorded` để "dùng lại sẵn": hàm đó đóng
          // dấu `[auto:order-confirm]` / `[auto:order-installment:dotN]`, mà
          // `lib/orders/installments.ts` XOÁ MỀM đúng hai họ marker đó mỗi lần ai bấm
          // "Lưu kế hoạch" ⇒ tiền ngân hàng sẽ bị xoá mềm ở lần lưu kế hoạch kế tiếp.
          // Marker riêng `[auto:<provider>:<txn>]` ở dưới GIỮ NGUYÊN — chỉ CHÉP QUY
          // TẮC gắn ghi danh, không chép marker.
          //
          // ── HAI NGUỒN ỨNG VIÊN, THEO THỨ TỰ CHẮC CHẮN GIẢM DẦN ────────────────
          //
          // (1) Ghi danh mà CHÍNH ĐƠN NÀY trỏ tới (`OrderItem.enrollmentId`). Đây là
          //     bằng chứng TRỰC TIẾP — bản thân đơn khai nó đang thu tiền cho ghi danh
          //     nào — chứ không phải suy đoán.
          // (2) Lùi về luật của `ensureOrderPaymentRecorded` (lib/finance/payment.ts):
          //     học viên của đơn có ĐÚNG MỘT ghi danh còn sống. Giữ nhánh này để hai
          //     đường ghi vào cùng bảng `Payment` quy kết giống nhau cho đơn không có
          //     dòng ghi danh nào.
          //
          // ⚠️ VÌ SAO KHÔNG CHỈ DÙNG NGUỒN (2) — ĐO TRÊN satarobo_local 14/09/2026,
          //    496 đơn còn sống:
          //      · nguồn (2) một mình:  32 đơn gắn được ·   3 đơn không có học viên ·
          //                            461 đơn MƠ HỒ (6,5% gắn được)
          //      · nguồn (1) trước:    493 đơn gắn được ·   0 đơn trỏ ≥2 ghi danh ·
          //                              3 đơn không có dòng ghi danh (99,4%)
          //    Phân bố ghi danh/học viên nói rõ vì sao: 168/250 em có ≥2 ghi danh còn
          //    sống, đa số vì `COMPLETED` KHÔNG bị xoá mềm (191 dòng) — học xong Sata1
          //    rồi lên Sata2 là đã "mơ hồ" theo nguồn (2). Chỉ chép nguồn (2) là vá
          //    xong mà 93% tiền về qua QR vẫn không xác nhận được, tức chưa vá.
          //    Kiểm chéo an toàn của nguồn (1): 0 đơn có item trỏ ghi danh của em KHÁC,
          //    0 đơn có item trỏ ghi danh đã xoá mềm.
          //
          // MƠ HỒ THÌ ĐỂ NULL. Bốn ca biên, cả hai nguồn đều đi qua đúng một luật ở
          // `lib/finance/gan-ghi-danh-khoan.ts` (dùng lại, không viết hàm thứ hai):
          //  · đơn KHÔNG có `studentId` (đơn tạo ở /orders/new) → nguồn (1) vẫn tra
          //    được theo dòng hàng; hết dòng thì nguồn (2) không chạy (không biết em
          //    nào) → để null.
          //  · học viên có ≥2 ghi danh còn sống (combo / học lại / hai khoá) → nguồn
          //    (2) trả về 2 ⇒ null. Chia tiền cho nhiều ghi danh phải theo `finalPrice`
          //    (đúng phép chia của `linkRecordedPaymentsToEnrollments`); đoán hộ ở đây
          //    là cộng tiền vào công nợ của khoá khác và KHÔNG AI BIẾT.
          //  · ghi danh đã `deletedAt` → bị loại ở `where` của CẢ HAI nguồn.
          //  · đơn có nhiều `OrderItem` trỏ nhiều ghi danh → nguồn (1) trả ≥2 ⇒ null,
          //    và KHÔNG lùi sang (2) (lùi là lấy một ghi danh mà đơn còn chưa chọn nổi).
          //
          // Nguồn (1) khoá thêm theo `order.studentId` khi đơn có: item trỏ ghi danh
          // của em KHÁC thì đó là dữ liệu hỏng, và gắn vào là rót tiền sang sổ nhà khác.
          const dongHangCoGhiDanh = await tx.orderItem.findMany({
            where: {
              orderId: order.id,
              enrollmentId: { not: null },
              enrollment: {
                deletedAt: null,
                ...(order.studentId ? { studentId: order.studentId } : {}),
              },
            },
            select: { enrollmentId: true },
          });
          // Gộp trùng: đơn hay có nhiều dòng hàng cùng trỏ MỘT ghi danh (học phí +
          // giáo cụ). Không gộp thì đơn chắc chắn nhất lại bị đếm thành "≥2" ⇒ null.
          const idTheoDon = [...new Set(dongHangCoGhiDanh.map((d) => d.enrollmentId!))];

          // `take: 2` chứ không phải `take: 1`: chỉ cần biết "có nhiều hơn một hay
          // không". Lấy 1 là biến ca mơ hồ thành ca chắc chắn và gắn bừa vào ghi danh
          // đầu bảng.
          const ungVienGhiDanh =
            idTheoDon.length > 0
              ? idTheoDon.map((id) => ({ id }))
              : order.studentId
                ? await tx.enrollment.findMany({
                    where: { studentId: order.studentId, deletedAt: null },
                    select: { id: true },
                    take: 2,
                  })
                : [];
          const chonGhiDanh = chonGhiDanhChoKhoan(
            ungVienGhiDanh.map((e) => ({
              id: e.id,
              // Ba trường dưới chỉ phục vụ MÀN CHỌN TAY (hiện tên lớp cho người bấm).
              // Đường webhook không có người bấm nên không tra thêm — tra thêm là gánh
              // hai join nữa bên trong transaction đang giữ advisory lock của đơn.
              tenLop: null,
              tenKhoa: null,
              finalPrice: null,
            })),
          );

          // ─────────────────────────────────────────────────────────────────
          // PHIÊN B — ĐƠN MỘT CON thì gắn luôn `orderItemId`.
          //
          // Đơn có đúng MỘT dòng hàng ⇒ tiền không thể của ai khác, không có gì để đoán.
          // Đơn từ HAI dòng trở lên (khớp bằng mã đời cũ `ORD…D<số>`, thứ không nói con nào)
          // thì để NULL và màn công nợ hiện "chưa chia con" — sale chia ở
          // `/admin/bien-dong-so-du`. Đoán hộ ở đây là bé A hết nợ còn bé B vẫn bị gọi đòi
          // tiền, và không có dấu vết nào để lần ra vì sao.
          //
          // `take: 2` chứ không `findMany` đủ: chỉ cần biết "có nhiều hơn một hay không".
          // Lấy 1 là biến ca mơ hồ thành ca chắc chắn — đúng lỗi mà `chonGhiDanhChoKhoan`
          // ngay trên được dựng ra để tránh.
          const dongCuaDon = await tx.orderItem.findMany({
            where: { orderId: order.id },
            select: { id: true },
            take: 2,
          });
          const dongDuyNhat = dongCuaDon.length === 1 ? (dongCuaDon[0]?.id ?? null) : null;

          await tx.payment.create({
            data: {
              orderId: order.id,
              // null khi mơ hồ — xem khối chú thích ngay trên.
              enrollmentId: chonGhiDanh.ghiDanhId,
              orderItemId: dongDuyNhat,
              amount: allocated,
              method: provider.toLowerCase(),
              // Chỉ nguồn CARD_POS đổi (giờ quẹt thẻ); chuyển khoản vẫn là `new Date()`.
              paidDate: ngayThuCuaGiaoDich(fresh, new Date()),
              note: `Tiền về qua ${provider} ${providerTxnId} ${marker}`,
              saleStatus: "RECORDED",
              accountantStatus: "PENDING",
              recordedById: null,
              centerId: order.centerId,
            },
          });
        }

        // ── TIỀN VÀO ⇒ LEAD LÊN "ĐÃ ĐĂNG KÝ" [I-1 · 22/09/2026] ─────────────────
        //
        // ĐO ĐƯỢC (phiên I, `docs/thanh-toan-linh-hoat/i-ai-doc-so-nao.md`): cổng này chỉ
        // có ở HAI đường — `ensureOrderPaymentRecorded` và `recordPayment` (kế toán ghi
        // TAY). Đường tiền TỰ ĐỘNG không gọi nó: `grep -i lead lib/payments/payos-ingest.ts`
        // ra **0 dòng**.
        //
        // Vì sao nhánh cũ không cứu được: webhook SePay chỉ đi nhánh CONFIRM (nơi có
        // `ensureOrderPaymentRecorded`) khi tra ra đơn theo MÃ ĐƠN trong nội dung CK — mà
        // nội dung CK **bỏ mã đơn từ 20/08/2026** (`lib/payments/vietqr.ts`, chủ dự án đảo
        // quy ước). Nên `extractOrderCode` luôn `null` với giao dịch thật ⇒ nhánh ấy không
        // chạy ⇒ cổng phễu chưa từng nổ cho một đồng tiền nào về qua QR.
        //
        // ⚠️ Việc này KHÔNG chặn chốt lead và đừng mô tả nó như vậy: cả `convertLead` lẫn
        // `convertLeadV2` khoá theo `convertedAt IS NULL`, KHÔNG theo trạng thái (chú thích
        // "mở khoá convert" ở `lib/finance/payment.ts` đã lỗi thời từ GĐ5). Thứ hỏng là
        // **sổ đếm phễu** — gia đình đã chuyển tiền mà lead vẫn nằm ở "Chờ quyết định" — và
        // **vết trong nhật ký**: không có dòng `source: "payment"` nào để QLCS lần ra.
        //
        // ĐẶT Ở ĐÂY, trong `if (allocated > 0)` và TRONG transaction:
        //  · `allocated > 0` = tiền THẬT SỰ rót được vào phiếu của đơn. Tiền rơi hết sang
        //    ví (`allocated === 0 && credit > 0`) nghĩa là mọi phiếu đã PAID từ trước, tức
        //    gia đình đã trả xong trước đó và cổng này đã nổ ở lượt ấy rồi.
        //  · NGOÀI `if (!daGhiSoCu)` — và đó KHÔNG chỉ là phòng xa. [SỬA 28/09/2026] Chú
        //    thích cũ ở đây nói phép kiểm trùng "chỉ khác null khi cùng một `providerTxnId`
        //    vào lần hai, mà lượt ấy đã bị cổng `fresh` chặn". ĐÚNG với webhook retry, SAI với
        //    gỡ → gắn lại: `goGanTheoCon` đưa giao dịch về UNMATCHED nên cổng `fresh` MỞ, và
        //    lượt gắn lại tới được đây. Phép kiểm cũ còn trả "đã có" cho CHÍNH ca ấy — lỗ
        //    `[GGL-01]`, sổ cũ về 0 sau gắn lại; nay nó vẫn trả "đã có" khi dòng gốc chỉ được
        //    điều chỉnh một phần mà chưa đảo (`[GGL-04]`). Đặt cổng phễu bên trong thì những
        //    lượt ấy rót tiền mà phễu không được hỏi lại.
        //    Phép cấy 22/09 "không cắn" vì khi đó chưa có ca gỡ → gắn lại nào — đừng đọc nó
        //    như bằng chứng hai cách đặt tương đương.
        //  · TRONG transaction, cùng khoá với phép rót tiền: trạng thái phễu và số tiền
        //    phải cùng sống hoặc cùng chết, y như `ensureOrderPaymentRecorded` vẫn làm.
        //
        // Actor là `id: null` + tên nói RÕ NGUYÊN NHÂN. Đường gán tay của kế toán cũng đi
        // qua đây, nhưng thứ đẩy lead lên là TIỀN VỀ chứ không phải cú bấm — ghi tên người
        // bấm vào đây là để lại một vết nói sai chuyện đã xảy ra.
        if (order.leadId) {
          await maybeAdvanceLeadToRegistered(tx, {
            leadId: order.leadId,
            actor: {
              id: null,
              name: `Tiền về qua ${provider}`,
              centerId: order.centerId,
            },
          });
        }
      }
      return {
        kind: "MATCHED" as const,
        allocated,
        credit: plan.credit,
        waived,
        settled: isOrderSettled([...statusById.values()]),
      };
    });
  } catch (err) {
    if (err instanceof NoRequestError) {
      const note = "Đơn không còn phiếu thu nào để phân bổ";
      await db.bankTransaction
        .update({
          where: { id: bankTransactionId },
          data: { status: "UNMATCHED", unmatchedNote: note },
        })
        .catch(() => {});
      await logPayos({ provider, action: "MATCH_TXN", status: "FAILED", payload: data, error: note });
      return { status: "UNMATCHED", bankTransactionId, reason: note };
    }
    const message = err instanceof Error ? err.message : "Unknown";
    await logPayos({ provider, action: "ALLOCATE_TXN", status: "FAILED", payload: data, error: message });
    return { status: "ERROR", reason: message };
  }

  if (result.kind === "DUPLICATE") {
    return { status: "DUPLICATE", bankTransactionId };
  }

  // ── Bước 8: SAU commit mới tới side-effect (không API ngoài trong transaction) ──
  let orderConfirmed = false;
  if (result.settled) {
    orderConfirmed = await sauKhiDonThuDu({
      orderId: order.id,
      soTien: amount,
      providerTxnId,
      nguoiChot: "Cổng thanh toán (webhook)",
      // Đường cũ KHÔNG gọi recomputeRequestStatuses ⇒ đơn còn PENDING_PAYMENT tới đây: giữ nguyên.
      nhanDonChotNgam: false,
      // Đường cũ giữ NGUYÊN nhãn biên nhận (phương thức trên đơn / "Chuyển khoản (payOS)").
      nhanPhuongThuc: null,
    });
  }

  if (result.waived > 0) {
    await logPayos({
      provider,
      action: "ROUNDING_WAIVED",
      status: "SUCCESS",
      payload: data,
      response: {
        orderId: order.id,
        orderCode: order.code,
        waived: result.waived,
        tolerance,
        paymentRequestId: target.paymentRequestId,
      },
    });
  }

  await logPayos({
    provider,
    action: "MATCH_TXN",
    status: "SUCCESS",
    payload: data,
    response: {
      orderId: order.id,
      orderCode: order.code,
      via: target.via,
      paymentRequestId: target.paymentRequestId,
      allocated: result.allocated,
      credit: result.credit,
      waived: result.waived,
      settled: result.settled,
      orderConfirmed,
    },
  });

  return {
    status: "MATCHED",
    bankTransactionId,
    orderId: order.id,
    paymentRequestId: target.paymentRequestId,
    allocated: result.allocated,
    credit: result.credit,
    waived: result.waived,
    settled: result.settled,
    orderConfirmed,
  };
}

/** Đơn không còn phiếu thu (bị xoá giữa chừng) — rollback transaction rồi ghi UNMATCHED. */
class NoRequestError extends Error {
  constructor() {
    super("NO_PAYMENT_REQUEST");
  }
}
