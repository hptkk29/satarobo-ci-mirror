// lib/finance/payment-markers.ts — SỔ ĐĂNG KÝ MARKER của `Payment.note`.
//
// MỘT chỗ trả lời câu "dòng Payment này do AI sinh ra, và ai được phép dọn nó".
//
// ═══ VÌ SAO FILE NÀY TỒN TẠI (13/09/2026) ═══════════════════════════════════════
// `Payment` KHÔNG có cột nào nói nguồn gốc của một khoản. Quyền sở hữu được suy ra
// bằng cách SO CHUỖI trong `note`, và trước bản vá này phép so đó rải ở 3 nơi độc lập
// với 3 luật khác nhau. Hai lỗi tiền thật sinh ra từ đúng chỗ đó:
//
//  · DS-03 — `lib/orders/installments.ts` xoá mềm khoản cũ bằng `note contains "[auto:"`,
//    ý định là dọn khoản do CHÍNH kế hoạch đợt sinh ra. Nhưng `lib/payments/payos-ingest.ts`
//    ghi TIỀN THẬT TỪ NGÂN HÀNG với marker `[auto:<provider>:<txn>]` — cũng khớp tiền tố đó.
//    ⇒ bấm "Lưu kế hoạch" lần nữa trên đơn đã nhận chuyển khoản là xoá mềm dòng ledger
//    DUY NHẤT của khoản khách đã chuyển. Mọi phép đọc tiền lọc `deletedAt: null` nên tiền
//    rơi khỏi công nợ, trong khi `PaymentAllocation` ở sổ mới vẫn còn ⇒ hai sổ lệch nhau.
//
//  · R-01 — `[backfill-import]` (`lib/crm/backfill-order.ts`) nằm NGOÀI cả phép xoá mềm
//    lẫn phép tra idempotency của `ensureOrderPaymentRecorded` ⇒ lưu kế hoạch trên đơn
//    nhập lịch sử sinh thêm một khoản bằng đúng số khách đã đóng.
//
// ⚠️ HAI LỖI NÀY PHẢI VÁ CÙNG LƯỢT. Thu hẹp phép xoá mềm (vá DS-03) làm khoản cổng và
// khoản backfill SỐNG SÓT — mà khoản sống sót rơi thẳng vào cái bẫy của R-01. Vá DS-03
// một mình là đổi "mất tiền" thành "cộng đôi tiền". Vế thứ hai là `phanConPhaiGhi`.
//
// THUẦN — không Prisma, không DB, không server-only: test chạy không cần DB, và cả
// `lib/crm`, `lib/orders`, `lib/payments` đều import được cùng một luật.

// ─── BA HỌ MARKER ────────────────────────────────────────────────────────────

/** Khoản tự sinh khi XÁC NHẬN ĐƠN (không theo đợt). Do `ensureOrderPaymentRecorded`. */
export const AUTO_ORDER_CONFIRM_MARKER = "[auto:order-confirm]";

/** Tiền tố chung của mọi marker do KẾ HOẠCH ĐỢT sinh ra. */
const PLAN_INSTALLMENT_PREFIX = "[auto:order-installment:dot";

/**
 * Khoản tự sinh cho ĐỢT `soDot`.
 *
 * Nhận `number` bất kỳ chứ không phải `1 | 2`: PHA 3 bỏ trần 2 đợt, và nơi duy nhất
 * còn cứng "1 hoặc 2" là `OrderInstallment.soDot`. Đừng khoá thêm một chỗ nữa ở đây.
 */
export function installmentMarker(soDot: number): string {
  return `${PLAN_INSTALLMENT_PREFIX}${soDot}]`;
}

/**
 * Khoản ghi nhận TIỀN THẬT VỀ TỪ CỔNG THANH TOÁN.
 *
 * Dựng đúng như `lib/payments/payos-ingest.ts` đang làm (`[auto:${provider.toLowerCase()}:${txn}]`)
 * — đây là bản sao CÓ CHỦ ĐÍCH của công thức đó để test khoá được hình dạng chuỗi.
 * Sửa một bên mà quên bên kia thì `[MK-03]` đỏ.
 */
export function gatewayMarker(provider: string, providerTxnId: string): string {
  return `[auto:${provider.toLowerCase()}:${providerTxnId}]`;
}

/**
 * Khoản NHẬP LỊCH SỬ (khách cũ, tiền đã thu trước khi lên hệ thống).
 *
 * ⚠️ Chuỗi này là KHOÁ CHỐNG NHẬP TRÙNG của `lib/crm/backfill-order.ts` và bị ghim bởi
 * `tests/e2e/r7/bulk-convert.spec.ts`. Đổi giá trị = nhập trùng toàn bộ dữ liệu cũ.
 * `lib/crm/backfill-order.ts` re-export hằng này để các chỗ gọi cũ không phải sửa.
 */
export const BACKFILL_PAYMENT_MARKER = "[backfill-import]";

/**
 * DẤU ĐỊNH DANH MỘT DÒNG SHEET — chống nhập đôi khi bấm lại.
 *
 * Nhập giao dịch cũ là thao tác người ta sẽ chạy nhiều lần: nhập thử, sửa file, nhập
 * lại. Không có dấu này thì mỗi lượt cộng thêm một lần tiền, và số dư phình lên mà
 * không ai biết lượt nào là thừa.
 *
 * ⚠️ Dấu này ĐỨNG CẠNH `BACKFILL_PAYMENT_MARKER`, KHÔNG thay nó và KHÔNG nhét vào trong
 * nó. Mọi câu tra hiện có tìm chuỗi `[backfill-import]` bằng `contains` — viết thành
 * `[backfill-import:...]` là làm nút xác nhận hàng loạt ở /payments không thấy khoản nào
 * nữa, mà không có lỗi nào báo ra.
 *
 * Tên sheet bị rút gọn về chữ-số để dấu không chứa dấu cách/ký tự lạ khiến `contains`
 * khớp lem sang dòng khác.
 */
export function dauDongSheet(sheet: string, dong: number): string {
  const gon = sheet.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]/g, "");
  return `[sheet:${gon}#${Math.trunc(dong)}]`;
}

// ─── HỎI: KHOẢN NÀY CỦA AI ───────────────────────────────────────────────────

/**
 * Khoản này có phải do KẾ HOẠCH ĐỢT tự sinh không — tức kế hoạch có quyền dọn nó không.
 *
 * ⚠️ Hàm này chỉ trả lời về CHUỖI. Nó KHÔNG phải câu trả lời đầy đủ cho "được xoá mềm
 * khoản này chưa": kế toán gõ tay có thể chép nhầm cả marker vào ghi chú. Đường ghi
 * PHẢI gác thêm `enrollmentId: null` + `accountantStatus: "PENDING"` + `receipts: none`
 * — xem `lib/orders/installments.ts`. Ba điều kiện đó mới là thứ phân biệt "khoản nháp
 * của kế hoạch" với "khoản đã vào sổ kế toán của người thật".
 */
export function isPlanOwnedNote(note: string | null | undefined): boolean {
  if (!note) return false;
  return note.includes(AUTO_ORDER_CONFIRM_MARKER) || note.includes(PLAN_INSTALLMENT_PREFIX);
}

/**
 * Khoản này có phải TIỀN THẬT VỀ TỪ CỔNG không.
 *
 * Không cứng danh sách provider: `payos-ingest` dựng marker từ biến `provider`, nên cổng
 * mới thêm sau này phải nhận ra được mà không sửa hàm. Lookahead `(?!order-)` loại đúng
 * hai marker của kế hoạch, vì cả hai đều bắt đầu bằng `order-`.
 */
const GATEWAY_MARKER_RE = /\[auto:(?!order-)[a-z0-9._-]+:/;

export function isGatewayNote(note: string | null | undefined): boolean {
  if (!note) return false;
  return GATEWAY_MARKER_RE.test(note);
}

// ─── ĐIỀU KIỆN CHO ĐƯỜNG GHI ─────────────────────────────────────────────────

/** Một mảnh điều kiện `note contains` — khớp hình dạng Prisma mà không import Prisma. */
export type NoteContainsFilter = { note: { contains: string } };

/**
 * Các mảnh `OR` cho phép xoá mềm khoản do kế hoạch tự sinh.
 *
 * LIỆT KÊ TƯỜNG MINH từng marker, CỐ Ý không dùng tiền tố `"[auto:"`. Tiền tố đó chính
 * là DS-03: nó quét luôn `[auto:sepay:…]` / `[auto:payos:…]`. `[MK-04]` khoá điều này —
 * nếu ai đó "tối ưu" lại thành một mảnh tiền tố thì test đỏ ngay.
 *
 * `soDots` là các đợt của kế hoạch ĐANG lưu. Truyền đúng danh sách đợt thay vì đoán
 * `[1, 2]`, để PHA 3 (n đợt) không phải sửa hàm này.
 */
export function planOwnedNoteOr(soDots: number[]): NoteContainsFilter[] {
  return [
    { note: { contains: AUTO_ORDER_CONFIRM_MARKER } },
    ...soDots.map((d) => ({ note: { contains: installmentMarker(d) } })),
  ];
}

/**
 * R-01 — SỐ TIỀN CÒN PHẢI GHI vào Ledger-A cho đợt 1.
 *
 * Bất biến mà `recordInstallmentPlan` luôn muốn giữ: "tổng Payment còn sống của đơn =
 * số tiền đợt 1 đã thu". Trước bản vá nó giữ bằng cách XOÁ SẠCH rồi ghi lại nguyên
 * `dot1Amount` — cách đó chỉ đúng khi phép xoá thực sự quét sạch mọi thứ, và chính vì
 * nó quét sạch nên nó cuốn cả tiền ngân hàng (DS-03).
 *
 * Sau khi thu hẹp phép xoá, khoản cổng + khoản backfill SỐNG SÓT. Giữ bất biến cũ mà
 * không cộng đôi = chỉ ghi PHẦN CHÊNH.
 *
 * `daCoTrongSo > muonGhi` (khách chuyển dư, hoặc đợt 1 bị sửa xuống) → trả 0, KHÔNG
 * đẻ bút toán âm: bút toán âm là SỬA SỔ, và sửa sổ có đường riêng (`refundPayment` /
 * `adjustPayment`), không được lẫn vào đường ghi nhận.
 *
 * Đầu vào rác → 0 thay vì ném: đây nằm trong transaction của đường tiền, một `NaN`
 * lọt vào không được phép giết cả giao dịch.
 */
export function phanConPhaiGhi(muonGhi: number, daCoTrongSo: number): number {
  const can = Number.isFinite(muonGhi) ? Math.round(muonGhi) : 0;
  const co = Number.isFinite(daCoTrongSo) ? Math.round(daCoTrongSo) : 0;
  if (can <= 0) return 0;
  return Math.max(0, can - Math.max(0, co));
}

// ─── KHOẢN NÀY TỪ ĐÂU TỚI ────────────────────────────────────────────────────
//
// Thêm 14/09/2026. Ba hàm `isPlanOwnedNote` / `isGatewayNote` / so `BACKFILL_PAYMENT_MARKER`
// đã trả lời được từng vế, nhưng KHÔNG có chỗ nào trả lời câu người dùng thật sự hỏi khi
// nhìn một dòng tiền: "khoản này ở đâu ra?". Thiếu câu đó, màn hình chỉ còn cách LỌC THEO
// MỘT NGUỒN rồi coi đó là tất cả — và đó chính là con bug vừa đo:
// `khoanBiBoAction` lọc `note contains "[backfill-import]"` nên khoản do webhook cổng
// thanh toán sinh ra (`[auto:sepay:…]` / `[auto:payos:…]`) KHÔNG BAO GIỜ hiện ra để gắn
// ghi danh. Tiền thật đã về tài khoản, đã có dòng trong sổ, mà không thao tác nào đưa nó
// vào công nợ được.
//
// Để phép phân loại ở ĐÂY chứ không rải `note.includes(...)` trong action: sổ đăng ký
// marker chỉ có một, và marker mới (cổng thanh toán thứ ba chẳng hạn) phải tự động rơi
// đúng nhóm mà không ai phải nhớ đi sửa màn hình.

export const NGUON_KHOAN = {
  /** `[backfill-import]` — học phí khách cũ nhập từ sheet/Excel. */
  NHAP_LICH_SU: "NHAP_LICH_SU",
  /** `[auto:<provider>:<txn>]` — TIỀN THẬT về từ SePay/payOS qua webhook. */
  CONG_THANH_TOAN: "CONG_THANH_TOAN",
  /** `[auto:order-confirm]` / `[auto:order-installment:dotN]` — hệ tự sinh theo đơn/đợt. */
  TU_DONG_THEO_DON: "TU_DONG_THEO_DON",
  /** Không mang marker nào — Sale/kế toán gõ tay ở màn Thanh toán. */
  NGUOI_NHAP: "NGUOI_NHAP",
} as const;
export type NguonKhoan = (typeof NGUON_KHOAN)[keyof typeof NGUON_KHOAN];

/** Nhãn cho người vận hành đọc. Ngắn — nó đứng chung dòng với lý do vướng mắc. */
export const NHAN_NGUON_KHOAN: Record<NguonKhoan, string> = {
  NHAP_LICH_SU: "nhập từ file Excel",
  CONG_THANH_TOAN: "tiền về qua cổng thanh toán",
  TU_DONG_THEO_DON: "hệ thống tự sinh theo đơn",
  NGUOI_NHAP: "người dùng ghi nhận tay",
};

/**
 * Khoản mang `note` này do NGUỒN nào sinh ra.
 *
 * ⚠️ THỨ TỰ XÉT CÓ CHỦ ĐÍCH, đừng đảo:
 *  1. `[backfill-import]` trước — dấu dòng sheet `[sheet:X#12]` đứng CẠNH nó nên một
 *     note backfill có thể mang hai dấu; nhận ra nguồn nhập lịch sử phải là ưu tiên.
 *  2. cổng thanh toán trước kế hoạch đợt — `isGatewayNote` đã có lookahead `(?!order-)`
 *     nên hai họ không giẫm nhau, nhưng giữ thứ tự này thì đọc mã khỏi phải chứng minh lại.
 *  3. còn lại là người gõ tay. CỐ Ý để `NGUOI_NHAP` làm nhánh MẶC ĐỊNH (không phải
 *     "KHÔNG RÕ"): note trống/ghi chú tự do đúng là do người nhập, và gọi nó là "không
 *     rõ" sẽ đẩy người vận hành đi tìm một nguyên nhân không tồn tại.
 */
export function nguonKhoan(note: string | null | undefined): NguonKhoan {
  if (note && note.includes(BACKFILL_PAYMENT_MARKER)) return NGUON_KHOAN.NHAP_LICH_SU;
  if (isGatewayNote(note)) return NGUON_KHOAN.CONG_THANH_TOAN;
  if (isPlanOwnedNote(note)) return NGUON_KHOAN.TU_DONG_THEO_DON;
  return NGUON_KHOAN.NGUOI_NHAP;
}
