// lib/payments/plan-money-guard.ts — R-02: cổng chặn việc lưu kế hoạch đợt LÀM MẤT DẤU
// tiền khách đã đóng.
//
// THUẦN — không DB. Người gọi đo bốn con số rồi hỏi; luật nằm ở một chỗ, test không cần DB.

import { formatVndPlain } from "@/lib/format/money";

export type PlanMoneyState = {
  /** Σ allocation đang nằm trên phiếu "thu toàn đơn" CÒN SỐNG của đơn. */
  fullOrderAllocated: number;
  /** Σ `Payment` còn sống, `saleStatus = RECORDED`, ĐO SAU lượt xoá mềm của chính kế hoạch. */
  recordedPaid: number;
  /** Σ `PaymentAllocation` của đơn (mọi phiếu). */
  allocated: number;
  /**
   * Σ số tiền của MỌI đợt mà kế hoạch sắp lưu nhận là "đã thu".
   *
   * ⚠️ ĐỔI TÊN 14/09/2026 (`dot1Amount` → `tienCacDotDaThu`) khi kế hoạch chuyển từ 2 đợt
   * sang n đợt. Không phải đổi tên cho đẹp: với n đợt, truyền `dots[0].amount` (cách đọc
   * tự nhiên của tên cũ) là CHẶN OAN mọi kế hoạch có ≥2 đợt đã thu — nhánh (b) đo
   * `boSot = daThu − max(tienCacDotDaThu, daRot)`, mà `daThu` lúc đó là Σ của mọi đợt.
   * Còn truyền Σ TẤT CẢ các đợt (kể cả chưa thu) thì `boSot` luôn ≤ 0 và CỔNG TẮT HẲN.
   * Tên cũ mời cả hai cách đọc sai, nên nó phải đổi.
   */
  tienCacDotDaThu: number;
};

export type PlanMoneyVerdict = {
  chan: boolean;
  /** Câu nói cho người bấm nút — phải nêu SỐ TIỀN và VIỆC PHẢI LÀM. */
  lyDo?: string;
  /** Số tiền đang bị đe doạ, để ghi nhật ký và hiện lên màn. */
  soTien?: number;
};

/** Số tiền hợp lệ hay 0 — đầu vào rác KHÔNG được mở cổng, cũng không được ném. */
function tien(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * Lưu kế hoạch đợt lúc này có làm mất dấu tiền khách đã đóng không.
 *
 * HAI ĐƯỜNG HẠI, cùng hậu quả là ĐÒI KHÁCH TRẢ LẦN HAI:
 *
 * (a) Phiếu "thu toàn đơn" đã có tiền rót vào.
 *     `materializeInstallmentRequests` VOID nó VÔ ĐIỀU KIỆN (`payment-request.ts:289-294`
 *     — chỉ đọc `allocated` ở `:290` để ghi nhật ký rồi vẫn VOID). `outstandingOf` trả 0
 *     cho phiếu VOID (`allocation.ts:43`) ⇒ tiền rơi khỏi mọi phép tính còn-thiếu, còn
 *     phiếu đợt 1 mới sinh ở PENDING nên `_qr-core.ts:399-408` in QR đòi lại đúng khoản
 *     khách vừa đóng. Nhánh TỪ CHỐI kế hoạch (`revertInstallmentRequests:352-362`) đã gác
 *     đúng bằng `keptWithMoney` — cùng file, cùng luật, chỉ nhánh xuôi bị bỏ sót.
 *
 * (b) Ledger-A có nhiều tiền hơn phần kế hoạch nhận là "đợt 1 đã thu".
 *     Phần dư không được phiếu nào phản ánh ⇒ cũng bị đòi lại. Đây đúng hình dạng đơn
 *     prod `ORD-260808-000001`: 3.686.000đ ở `Payment`, **0** `PaymentAllocation` — nên
 *     cổng chỉ đo theo (a) sẽ để lọt đúng ca thật duy nhất đang có.
 *
 * ⚠️ VÌ SAO ĐIỀU KIỆN (b) PHẢI SO VỚI `dot1Amount`, KHÔNG PHẢI CHỈ `allocated < recordedPaid`:
 * sale thu tiền mặt rồi lưu kế hoạch với đợt 1 = đúng số đã thu là nghiệp vụ HÀNG NGÀY,
 * và ca đó luôn có `allocated(0) < recordedPaid`. Gác thô theo "đơn có tiền thì chặn" là
 * khoá cứng màn đơn. Chỉ phần tiền mà kế hoạch KHÔNG nhận (`recordedPaid − dot1Amount`)
 * mới là phần sắp bị đòi lại. `[R02-02]` khoá cả hai chiều: ca chặn và ca cho qua.
 *
 * KHÔNG tự sửa/di chuyển một đồng nào — chỉ trả lời có chặn hay không. Người gọi `throw`
 * để rollback cả transaction; trả cờ là vô dụng vì cả 3 chỗ gọi đều bỏ giá trị trả về và
 * transaction vẫn commit phần phá hoại.
 */
export function keHoachLamMatTien(state: PlanMoneyState): PlanMoneyVerdict {
  const fullAlloc = tien(state.fullOrderAllocated);
  const daThu = tien(state.recordedPaid);
  const daRot = tien(state.allocated);
  const dot1 = tien(state.tienCacDotDaThu);

  if (fullAlloc > 0) {
    return {
      chan: true,
      soTien: fullAlloc,
      lyDo:
        `Phiếu thu toàn đơn đã nhận ${formatVndPlain(fullAlloc, false)}. Chuyển sang thu ` +
        `theo đợt lúc này sẽ huỷ phiếu đang giữ số tiền đó và xuất mã QR đòi khách lần hai. ` +
        `Nhờ kế toán đối soát khoản này trước, rồi lập lại kế hoạch.`,
    };
  }

  // (b) — chỉ phần Ledger-A mà kế hoạch KHÔNG nhận, và chỉ khi sổ mới cũng chưa giữ dấu.
  if (daRot < daThu) {
    const boSot = daThu - Math.max(dot1, daRot);
    if (boSot > 0) {
      return {
        chan: true,
        soTien: boSot,
        lyDo:
          `Đơn đã ghi nhận ${formatVndPlain(daThu, false)} nhưng kế hoạch chỉ nhận ` +
          `${formatVndPlain(dot1, false)} cho đợt 1 — chênh ${formatVndPlain(boSot, false)} ` +
          `sẽ không nằm trong phiếu thu nào và khách bị đòi lại. Sửa số tiền đợt 1 cho khớp, ` +
          `hoặc nhờ kế toán đối soát khoản chênh trước.`,
      };
    }
  }

  return { chan: false };
}

/**
 * Ném khi lưu kế hoạch đợt sẽ làm mất dấu / ghi đè tiền khách đã đóng.
 *
 * ⚠️ DỜI TỪ `lib/orders/installments.ts` sang đây [15/09/2026]. Lý do là VÒNG NHẬP:
 * cổng A6 bên dưới phải chạy trong `materializeInstallmentRequests`
 * (`lib/payments/payment-request.ts`) để che CẢ BA đường gọi, mà tệp đó đã được
 * `installments.ts` nhập vào — nên nó không nhập ngược lại được. Tệp này thuần, không
 * phụ thuộc ai, nên là chỗ duy nhất cả hai bên với tới được. `installments.ts` nhập
 * lại và xuất lại để mọi chỗ gọi cũ không phải đổi.
 *
 * PHẢI là `throw`, KHÔNG được trả cờ: cả ba chỗ gọi `materializeInstallmentRequests`
 * đều BỎ QUA giá trị trả về, và quan trọng hơn, khi cổng bật thì
 * `orderInstallment.deleteMany` + xoá mềm `Payment` ở trên ĐÃ chạy trong cùng
 * transaction. Trả cờ thì transaction vẫn COMMIT phần phá hoại — chỉ `throw` mới
 * rollback được.
 */
export class InstallmentMoneyBlocked extends Error {
  readonly code = "INSTALLMENT_MONEY_BLOCKED" as const;
  constructor(
    message: string,
    readonly soTien: number,
  ) {
    super(message);
    this.name = "InstallmentMoneyBlocked";
  }
}

/**
 * ── A6 — `amountDue` CỦA PHIẾU ĐÃ CÓ TIỀN LÀ BẤT BIẾN ──────────────────────────
 *
 * Chốt của chủ dự án: *"KHÔNG sửa `amountDue` của phiếu đã có allocation. VOID + tạo
 * phiếu mới."* Và 15/09/2026: *"khi PH đã thanh toán thì ... phải khoá phần đã thu
 * lại, chỉ cho sửa các đợt sau đó với số tiền còn thiếu chưa thanh toán."* — cùng một
 * luật, phát biểu từ hai phía.
 *
 * ⚠️ ĐÂY KHÔNG PHẢI R-02, và R-02 không hở. `keHoachLamMatTien` canh tiền nằm ở phiếu
 * THU TOÀN ĐƠN (phiếu bị VOID vô điều kiện); nó CỐ Ý không canh phiếu theo đợt, vì
 * phiếu theo đợt đã được tha ở vòng VOID. Lỗ nằm ở vòng UPSERT, chỗ khác hẳn.
 *
 * Đo thật (nợ ghim `[PR-02d]`): phiếu đợt 1 đang giữ **6.000.000đ đã rót**; lưu lại kế
 * hoạch với đợt 1 = 1.000.000đ ⇒ `amountDue` thành 1.000.000đ, phiếu hoá **thu vượt
 * 5.000.000đ**, và mọi con số đọc từ phiếu lệch theo. Tiền KHÔNG mất (dòng
 * `PaymentAllocation` còn nguyên) nhưng sổ nói sai.
 *
 * ── VÌ SAO TỪ CHỐI, KHÔNG PHẢI ÂM THẦM GIỮ SỐ CŨ ──
 * Ca ghim `[PR-02d]` bản đầu kỳ vọng *giữ im lặng* (`amountDue` ở lại 6tr, lượt lưu
 * vẫn thành công). Đổi sang TỪ CHỐI [15/09/2026] vì giữ im lặng đẻ ra split-brain:
 * `OrderInstallment` ghi 1tr còn `PaymentRequest` giữ 6tr, hai sổ nói hai số cho cùng
 * một đợt và KHÔNG AI được báo. Đó đúng là lớp bug mà cả repo này đang chống.
 * Từ chối thì không có gì được ghi, và người bấm nút biết ngay.
 *
 * Luồng BÌNH THƯỜNG không chạm cổng này: sale sửa đợt 3/4 thì payload của đợt 1 giữ
 * nguyên số ⇒ không đổi ⇒ không chặn. Cổng chỉ bật khi ai đó THẬT SỰ đổi số của một
 * đợt đã có tiền — và màn hình vốn đã khoá ô đó lại.
 *
 * ⚠️ `dueDate` thì KHÔNG khoá: đổi hạn của một đợt đã đóng không đụng vào đồng nào.
 * A6 nói đúng về `amountDue`; nới cổng ra quá lời chốt là tự đặt thêm luật.
 *
 * ⚠️ Rót MỘT PHẦN cũng khoá (allocated 3tr/6tr ⇒ vẫn bất biến). A6 viết "phiếu đã có
 * allocation", không phải "đã đóng đủ"; và một đợt đang dở không phải "đợt sau" theo
 * lời chủ dự án. Muốn đổi số thì đối soát khoản đã rót trước.
 */
export function doiTienDotDaThu(input: {
  soDot: number;
  /** `PaymentRequest.amountDue` đang lưu. */
  tienHienTai: number;
  /** Số tiền kế hoạch mới muốn đặt. */
  tienMuonDat: number;
  /** Σ `PaymentAllocation` đã rót vào phiếu của đợt này. */
  daRot: number;
}): PlanMoneyVerdict {
  const daRot = tien(input.daRot);
  if (daRot <= 0) return { chan: false };
  if (Math.round(input.tienHienTai) === Math.round(input.tienMuonDat)) {
    return { chan: false };
  }
  return {
    chan: true,
    soTien: daRot,
    lyDo:
      `Đợt ${input.soDot} đã nhận ${formatVndPlain(daRot, false)} — số tiền của đợt đã thu ` +
      `không sửa được (đang ${formatVndPlain(tien(input.tienHienTai), false)}, muốn đổi thành ` +
      `${formatVndPlain(tien(input.tienMuonDat), false)}). Chỉ sửa được các đợt CHƯA thu; ` +
      `muốn đổi đợt này thì nhờ kế toán đối soát khoản đã nhận trước.`,
  };
}
