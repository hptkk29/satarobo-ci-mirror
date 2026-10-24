// lib/payments/khai-da-thu.ts — hai câu hỏi quanh Ô "ĐÃ THU" của kế hoạch đợt.
//
// ═══ VÌ SAO FILE NÀY TỒN TẠI (14/09/2026) ═══════════════════════════════════════
//
// Ô "đã thu" trên form kế hoạch là ĐƯỜNG GHI TIỀN: tích nó rồi bấm Lưu là
// `recordInstallmentPlan` gọi `ensureOrderPaymentRecorded` và một dòng `Payment`
// (Ledger-A) ra đời. Nhưng cho tới hôm nay **không ai hỏi tiền đó có thật không** —
// giá trị mặc định của ô là hằng `true`, và không có cổng nào ở đường ghi.
//
// ĐO ĐƯỢC, chạy hàm thật trên `satarobo_local`, đơn `ORD-260913-000001`:
//   · tổng đơn 8.000.000đ, sổ Khoản thu có ĐÚNG 1 dòng 1.000.000đ
//     (`saleStatus=RECORDED`, note `[backfill-import]`);
//   · chưa có kế hoạch ⇒ `dotsBanDau` trả `[{ amount: 8.000.000, daThu: TRUE }]`;
//   · mở đơn lên, KHÔNG đổi gì, bấm "Lưu" ⇒ `phanBoGhiTheoDot([8tr], 1tr)` = `[7tr]`
//     ⇒ MỘT `Payment` 7.000.000đ KHỐNG ra đời;
//   · `recomputeOrder` lật `Order.status = CONFIRMED` + `paidAt`;
//   · màn đơn in "Đã thu 8.000.000đ · còn thiếu 0đ" trong khi két có 1.000.000đ.
// 193/496 đơn đang ở đúng hình dạng đó (116 trong số đó CHƯA THU ĐỒNG NÀO).
//
// Cổng R-02 (`plan-money-guard.ts`) KHÔNG che ca này và **không hở**: nó nằm trong
// nhánh `if (coDotChuaThu)`, mà kế hoạch một đợt "đã thu đủ" thì `coDotChuaThu = false`
// nên nhánh đó không chạy. Đã chạy thử hàm thật để chắc:
//   `keHoachLamMatTien({fullOrderAllocated:0, recordedPaid:3tr, allocated:0, tienCacDotDaThu:10tr})`
//   → `{ chan: false }` — nhánh (b) CỐ Ý tha ca `khai > recordedPaid` để không khoá cứng
//   nghiệp vụ sale thu tiền mặt hằng ngày. Đừng nới R-02 để vá chỗ này.
//
// THUẦN — không DB, không Prisma, không `server-only`: dùng được CẢ ở component client
// (`order-payment-section.tsx`, nơi dựng mặc định form) lẫn ở đường ghi server
// (`lib/orders/installments.ts`, nơi gác). Hai bên phải cùng một luật; luật nằm ở đây.
// ═════════════════════════════════════════════════════════════════════════════════
import { formatVndPlain } from "@/lib/format/money";

/** Số tiền hợp lệ hay 0 — đầu vào rác KHÔNG được sinh tiền, cũng không được ném. */
function tien(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

// ─── (1) MẶC ĐỊNH CỦA FORM: SUY TỪ TIỀN THẬT, KHÔNG BỊA ──────────────────────

/** Một đợt lúc form vừa mở. Chỉ hai trường mang Ý NGHĨA TIỀN — phần còn lại là của UI. */
export type DotBanDau = {
  amount: number;
  /** Đợt này sale đã cầm tiền rồi. TRUE ở đây là một lời khai, và nó sinh ra Ledger-A. */
  daThu: boolean;
};

export type DotBanDauInput = {
  /** `Order.totalAmount` — tổng phải đóng sau giảm giá. */
  totalAmount: number;
  /**
   * Tiền đơn này ĐANG CÓ trong sổ, theo **TRỤC B** (`saleStatus = RECORDED`,
   * `deletedAt = null` — xem `lib/finance/ghi-nhan.ts`).
   *
   * ⚠️ TRỤC B, KHÔNG PHẢI TRỤC A — và đây là lựa chọn có chủ đích, không phải tiện tay:
   *  · Thứ ô này khai là **"SALE đã thu"**, không phải "kế toán đã xác nhận". Nhãn ngay
   *    cạnh nó trên màn cũng nói vậy ("Sale đã thu — chờ kế toán").
   *  · Đường GHI mà mặc định này dẫn tới đo bằng đúng trục B: `recordInstallmentPlan`
   *    cộng `KHOAN_DA_GHI_NHAN` cho `phanBoGhiTheoDot`, và R-02 cũng nhận `recordedPaid`
   *    theo trục đó. Mặc định đo một trục còn đường ghi đo trục kia là hai con số không
   *    bao giờ gặp nhau — bấm Lưu mà không đổi gì vẫn đẻ chênh lệch, tức đúng con bug
   *    đang vá, chỉ nhỏ hơn.
   *  · Lấy trục A (`accountantStatus = CONFIRMED`) thì mọi đơn vừa nhập lịch sử — khoản
   *    mang `[backfill-import]`, `accountantStatus: PENDING` — sẽ mặc định "chưa thu
   *    đồng nào", và sale được mời lập kế hoạch đòi lại số khách đã đóng.
   */
  daThuTheoSo: number;
};

/**
 * Dựng các đợt lúc form vừa mở cho đơn CHƯA CÓ kế hoạch.
 *
 * ⚠️ BẤT BIẾN 1 — Σ `amount` === `totalAmount`. Lệch một đồng là lệch giữa số phải thu
 * của đơn và tổng phiếu thu, và `kiemKeHoachDot` sẽ chặn Lưu với một câu khó hiểu.
 *
 * ⚠️ BẤT BIẾN 2 (thứ file này sinh ra để giữ) — Σ `amount` của các đợt `daThu = true`
 * KHÔNG BAO GIỜ vượt `daThuTheoSo`. Mặc định không được khai nhiều tiền hơn sổ đang có;
 * mọi đồng vượt lên là một đồng `Payment` khống nếu người dùng bấm Lưu mà không đọc.
 *
 * BA HÌNH DẠNG, theo đúng ba hiện trạng thật của 496 đơn:
 *  · sổ trống (116 đơn)   → 1 đợt = cả đơn, **CHƯA THU**. Form sẽ đòi ngày hẹn đóng
 *                           (`save()` chặn khi thiếu hạn) — đó là hành vi đúng: chưa ai
 *                           đóng gì thì đây là một khoản nợ có hạn, không phải tiền đã về.
 *  · thu một phần (77 đơn) → 2 đợt: đợt 1 = ĐÚNG số đang có trong sổ (đã thu), đợt 2 =
 *                           phần còn lại (chưa thu). Đây là hình dạng DUY NHẤT lưu được:
 *                           một đợt "chưa thu" bằng cả đơn sẽ bị R-02 chặn
 *                           (`boSot = daThu − max(0, 0) > 0`), còn một đợt "đã thu" bằng
 *                           cả đơn thì mint tiền. Mặc định phải dẫn người dùng tới chỗ
 *                           lưu được, chứ không tới chỗ bị chặn.
 *  · thu đủ / vượt (303)  → 1 đợt = cả đơn, ĐÃ THU. Không có gì mới được ghi:
 *                           `phanBoGhiTheoDot([tổng], sổ≥tổng)` trả `[0]`.
 *
 * ⚠️ KHÔNG ĐẶT `dueDate` Ở ĐÂY, và cố ý không nhận `moc: Date`. Hàm này chạy trong
 * `useState(() => …)` của một component client — Next vẫn dựng nó ở server trước, nên
 * một `new Date()` ở đây cho hai giá trị khác nhau giữa lần render server và lần hydrate
 * (và luật 19 cấm test đọc đồng hồ). Để trống hạn thì `save()` nói thẳng "Đợt 2 chưa thu
 * — chọn ngày hẹn đóng": bịa một cái hạn cũng là bịa, chỉ khó thấy hơn bịa tiền.
 */
export function dotsBanDauTuTien(input: DotBanDauInput): DotBanDau[] {
  const tong = tien(input.totalAmount);
  const daThu = tien(input.daThuTheoSo);

  // Đơn 0đ: không còn gì để thu. Đánh "chưa thu" ở đây chỉ khoá nút Lưu sau một ô ngày
  // hẹn cho một khoản nợ 0đ. Bất biến 2 vẫn nguyên: Σ đợt đã thu = 0 ≤ sổ.
  if (tong <= 0) return [{ amount: 0, daThu: true }];

  if (daThu <= 0) return [{ amount: tong, daThu: false }];
  if (daThu >= tong) return [{ amount: tong, daThu: true }];

  return [
    { amount: daThu, daThu: true },
    { amount: tong - daThu, daThu: false },
  ];
}

// ─── (2) CỔNG Ở ĐƯỜNG GHI: LỜI KHAI KHÔNG ĐƯỢC VƯỢT SỔ ───────────────────────

export type KhaiDaThuState = {
  /** Σ số tiền của MỌI đợt mà kế hoạch sắp lưu nhận là "đã thu". */
  tienCacDotDaThu: number;
  /**
   * Σ `Payment` còn sống `saleStatus = RECORDED` của đơn, **ĐO SAU** lượt xoá mềm khoản
   * do CHÍNH kế hoạch sinh ra (`planOwnedNoteOr`) và **TRƯỚC** vòng `ensureOrderPaymentRecorded`.
   *
   * Thứ tự đó là toàn bộ giá trị của cổng này. Đo sau vòng ghi thì vòng ghi vừa tạo đúng
   * phần còn thiếu ⇒ `khai === daCoTrongSo` ⇒ cổng không bao giờ nổ, và trông y hệt một
   * cổng đang làm việc.
   *
   * Đo sau lượt xoá mềm cũng có chủ đích: khoản do kế hoạch lần trước sinh ra không phải
   * "tiền người khác đã ghi", nó là nháp của chính kế hoạch và sắp được dựng lại.
   */
  daCoTrongSo: number;
};

export type KhaiDaThuVerdict = {
  chan: boolean;
  /** Câu nói cho người bấm nút — phải nêu SỐ TIỀN và VIỆC PHẢI LÀM. */
  lyDo?: string;
  /** Phần tiền sắp bị ghi khống, để ghi nhật ký và hiện lên màn. */
  soTien?: number;
};

/**
 * Kế hoạch sắp lưu có khai "đã thu" nhiều hơn sổ của đơn không.
 *
 * ═══ VÌ SAO SỔ TRỐNG THÌ KHÔNG CHẶN ═══════════════════════════════════════════
 * Đây là phần phải đọc kỹ, vì nó trông như một lỗ hổng và nó là một ĐÁNH ĐỔI đã cân.
 *
 * Tích ô "đã thu" CHÍNH LÀ cách sale ghi nhận tiền mặt thu tại quầy — tiền mặt không
 * sinh được `PaymentAllocation` (FK `bankTransactionId` bắt buộc, và `BankTransaction`
 * chỉ ra đời ở webhook `payos-ingest.ts:787`), nên đường này là đường DUY NHẤT hôm nay.
 * Chặn thẳng "khai > sổ" là xoá ô đó khỏi mọi đơn mới — thứ chủ dự án đã dặn ĐỪNG làm
 * trong lượt này, và là thứ sẽ làm ~15 chỗ gọi trong bộ e2e (`tests/e2e/r6`, `r7`, `fl`:
 * tạo đơn mới rồi `recordInstallmentPlan({dot1Amount})` ngay) đỏ trên required check.
 *
 * Cái phân biệt được hai ca, và là thứ cổng này đo: **sổ của đơn đã có tiền của NGƯỜI
 * KHÁC hay chưa.**
 *  · sổ trống  → lần lưu này LÀ lần ghi đầu tiên. Không có sổ nào để mâu thuẫn.
 *                Lưới chắn ca này là mặc định trung thực ở `dotsBanDauTuTien` phía trên.
 *  · sổ có tiền→ đơn đang được ghi chép thật (tiền cổng `[auto:<provider>:…]`, khoản nhập
 *                lịch sử `[backfill-import]`, hoặc kế toán gõ tay — ba họ SỐNG SÓT qua
 *                lượt xoá mềm). Khai nhiều hơn số đó là đúc thêm tiền ĐÈ LÊN một lịch sử
 *                thanh toán có thật, mà không chứng từ nào đỡ. Đó đúng là hình dạng của
 *                `ORD-260913-000001`: sổ 1.000.000đ, kế hoạch khai 8.000.000đ, chênh
 *                7.000.000đ.
 *
 * Đánh đổi đã biết và chấp nhận: sale thu thêm TIỀN MẶT trên một đơn đã nhận chuyển
 * khoản qua cổng sẽ bị chặn ở đây. Câu trả lời không phải "nới cổng" mà là ghi khoản
 * tiền mặt đó ở sổ Khoản thu (`/admin/payments`, `recordPaymentAction`) — đường đó có
 * thật, có chứng từ, và `lyDo` bên dưới chỉ thẳng tới nó.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * KHÔNG tự sửa/di chuyển một đồng nào — chỉ trả lời có chặn hay không. Người gọi `throw`
 * để rollback cả transaction: lúc cổng này trả lời thì `orderInstallment.deleteMany` và
 * lượt xoá mềm `Payment` ĐÃ chạy trong cùng transaction, nên trả cờ là để phần phá hoại
 * commit (cùng lý do R-02 phải `throw`).
 */
export function khaiDaThuVuotSo(state: KhaiDaThuState): KhaiDaThuVerdict {
  const khai = tien(state.tienCacDotDaThu);
  const so = tien(state.daCoTrongSo);

  if (so <= 0) return { chan: false };

  const ghiKhong = khai - so;
  if (ghiKhong <= 0) return { chan: false };

  return {
    chan: true,
    soTien: ghiKhong,
    lyDo:
      `Kế hoạch khai đã thu ${formatVndPlain(khai, false)} nhưng sổ Khoản thu của đơn ` +
      `chỉ có ${formatVndPlain(so, false)} — chênh ${formatVndPlain(ghiKhong, false)} ` +
      `không có chứng từ nào và sẽ được ghi thành tiền đã thu. Ghi nhận khoản đó ở sổ ` +
      `Khoản thu trước, hoặc sửa số tiền các đợt "đã thu" cho khớp sổ.`,
  };
}
