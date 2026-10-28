// lib/payments/chia-phieu-gop.ts — QUYẾT ĐỊNH CÓ CHIA TIỀN VỀ HAY KHÔNG. Thuần.
//
// ⚠️ [22/10/2026] LUẬT BÊN DƯỚI CÒN ĐÚNG CHO `chiaTheoPhieuGop`, nhưng KHÔNG CÒN LÀ LUẬT DUY NHẤT: phiếu theo CON, nguồn chuyển khoản (không phải thẻ POS), cơ sở BẬT
// thu học phí linh hoạt đi qua `chiaTuRotNguyenKhoan` ở CUỐI tệp (thiếu ⇒ rót nguyên khoản theo thứ tự; dư ⇒ tiền chờ gắn). Điều kiện chọn luật ở `thuTheoPhieuGop`
// (`lib/finance/phieu-gop.ts`). Đừng «dọn» hàm cũ — thẻ POS, phiếu có dòng đợt đời cũ và cơ sở tắt cờ vẫn chạy nó.
//
// ─────────────────────────────────────────────────────────────────────────────
// LUẬT: ĐƯỢC ĂN CẢ HOẶC KHÔNG ĂN GÌ — chủ dự án chốt 16/09/2026 (chiều)
//
// *"QR luôn in sẵn số tiền của phiếu gộp. Không xây màn/nút nào cho sale xử lý tiền thừa/thiếu,
// không có luồng 'gắn phần dư vào đợt kế tiếp'. Webhook chỉ tự phân bổ khi: khớp phiếu OPEN VÀ
// số tiền = số còn phải thu của phiếu. Khi đó chia đích danh theo dòng, phiếu → PAID. Mọi
// trường hợp khác: KHÔNG phân bổ, KHÔNG từ chối webhook (vẫn 200). Toàn bộ tiền để chưa phân bổ
// trên BankTransaction, gắn orderId nếu khớp được phiếu, đánh dấu CAN_XU_LY + thông báo nội bộ
// cho kế toán. Kế toán xử lý duy nhất bằng hoàn tiền (có chứng từ). Không có đường phân bổ tay
// số lệch trong V1."*
//
// ─────────────────────────────────────────────────────────────────────────────
// ĐÂY LÀ BẢN VIẾT LẠI, VÀ BẢN CŨ SAI THEO MỘT CÁCH ĐÁNG GHI LẠI
//
// Bản đầu (sáng 16/09) làm đúng theo BA: thiếu thì LẤP DẦN theo thứ tự dòng, thừa thì đưa phần
// dư vào VÍ GIA ĐÌNH. Nghe hợp lý, và nó là thứ mọi hệ thống thanh toán đều làm.
//
// Nhưng nó đẻ ra một cái đuôi mà BA phải xây tiếp: ví có tiền ⇒ phải có màn chia ví (US-12) ⇒
// phải có quyền `billing:split-wallet` ⇒ phải có bất biến "chia ≤ còn nợ, Σ ≤ số dư" ⇒ phải có
// ca "gán nhầm gia đình thì đảo thế nào" ⇒ phải có báo cáo ai chia ví bao nhiêu (US-26). Năm
// story và bốn bất biến, tất cả chỉ để dọn hậu quả của việc CHẤP NHẬN một khoản tiền lệch số.
//
// Luật mới cắt cả cái đuôi đó: **không chấp nhận thì không phải dọn.** Phiếu in sẵn số, khách
// chuyển đúng số thì xong; chuyển sai thì tiền nằm nguyên ở `BankTransaction`, kế toán hoàn lại
// có chứng từ. Không màn nào cho sale, không ví trung gian, không phân bổ tay.
//
// ⚠️ Đánh đổi phải nói thẳng: khách chuyển THIẾU 1.000đ thì **không đợt nào được ghi nhận**, và
// kế toán phải hoàn cả khoản. Nghe khắc nghiệt, nhưng đó là đánh đổi có chủ đích — và chủ dự án
// đã ra luôn cách đo nó: *"đo sau 1 tháng chạy thật, số ca CAN_XU_LY theo loại. Nếu > 0 ca lệch
// số mỗi tháng thì báo lại, lúc đó mới xét mở thêm."* Đừng tự nới trước khi có số đó.

/** Vì sao một khoản tiền về KHÔNG được phân bổ — mã để đánh dấu `BankTransaction`. */
export type MaCanXuLy =
  /** Số tiền khác số còn phải thu của phiếu (thừa hoặc thiếu, kể cả 1đ). */
  | "LECH_SO"
  /** Khớp được phiếu nhưng phiếu không còn OPEN (đã PAID / đã VOID). */
  | "PHIEU_KHONG_MO"
  /** Không tra ra phiếu nào từ nội dung chuyển khoản. */
  | "KHONG_KHOP_PHIEU";

/** Một dòng của phiếu gộp, kèm tình trạng hiện tại của phiếu thu nó trỏ tới. */
export type DongPhieuGop = {
  paymentRequestId: string;
  /** Thứ tự rót đã CHỤP LẠI lúc phát phiếu (`PaymentBillLine.sortOrder`). */
  sortOrder: number;
  /** Phần của phiếu gộp dành cho dòng này (`PaymentBillLine.amount`). */
  amount: number;
  /** Tổng phải thu của phiếu thu đó (`PaymentRequest.amountDue`). */
  amountDue: number;
  /** Đã rót được bao nhiêu vào phiếu thu đó rồi (Σ `PaymentAllocation.amount`). */
  daRot: number;
  /**
   * Phần THIẾU đã được THA theo dung sai làm tròn (Σ `PaymentAllocation.roundingWaived`).
   *
   * BẮT BUỘC (luật 7) — rà vòng 5 (30/09/2026): đợt đủ tiền nhờ dung sai là PAID theo
   * `deriveStatus` (`allocated + waived >= amountDue`), nhưng phép "còn thiếu" ở đây từng chỉ trừ
   * `daRot` ⇒ phiếu gộp chứa đợt đó còn đòi đúng phần đã tha: QR in 2.000đ cho một đợt ĐÃ ĐỦ,
   * phiếu không bao giờ thành "0đ" nên kẹt OPEN chặn phát phiếu cho cả đơn, và khách quét thì bị
   * thu lại phần được tha (ca `[V5-50]`). Quên `select` cột này là lỗi biên dịch, không lỗi câm.
   */
  daTha: number;
};

export type PhieuGopDeChia = {
  billId: string;
  /** `CLOSED` cố ý KHÔNG nằm trong luồng mới — xem chú thích enum ở `schema.prisma`. */
  trangThai: "OPEN" | "PAID" | "VOID" | "CLOSED";
  dong: readonly DongPhieuGop[];
};

export type QuyetDinhChia =
  | {
      chia: true;
      billId: string;
      /** Rót vào từng phiếu thu, theo đúng thứ tự dòng của PHIẾU. */
      lines: { paymentRequestId: string; amount: number }[];
      /** Σ `lines` — luôn bằng số tiền về. */
      tongRot: number;
    }
  | {
      chia: false;
      ma: MaCanXuLy;
      /** Số còn phải thu của phiếu (để in vào thông báo cho kế toán). `null` khi không có phiếu. */
      conPhaiThu: number | null;
      /** Câu tiếng Việt cho kế toán đọc — nêu số về, số cần, và lệch bao nhiêu. */
      moTa: string;
    };

const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");
const tron = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);

/**
 * Phần còn thiếu của MỘT dòng phiếu: không quá phần đã hứa, không quá phần phiếu thu còn nợ.
 * "Còn nợ" = `amountDue − daRot − daTha` — CÙNG vế `deriveStatus` dùng để gọi một đợt là PAID.
 */
function conThieuCuaDong(d: DongPhieuGop): number {
  return Math.min(tron(d.amount), Math.max(0, tron(d.amountDue) - tron(d.daRot) - tron(d.daTha)));
}

/**
 * Số CÒN PHẢI THU của phiếu gộp — số in lên mã QR.
 *
 * "Còn", không phải "tổng": một dòng của phiếu có thể đã được lấp từ đường khác (vd tiền dư của
 * em nghỉ học bù sang), và khi đó QR phải in số nhỏ hơn. Đây cũng chính là con số mà tiền về
 * phải khớp TỪNG ĐỒNG.
 *
 * ⚠️ Tính ở đúng MỘT chỗ. Hai phép cộng ở hai nơi là cách chắc chắn nhất để một ngày nào đó QR
 * in một số còn cổng đối khớp so với số khác — và khi đó KHÁCH NÀO CŨNG chuyển sai.
 */
export function conPhaiThuCuaPhieu(dong: readonly DongPhieuGop[]): number {
  return dong.reduce((s, d) => s + conThieuCuaDong(d), 0);
}

/**
 * Có chia khoản tiền này hay không, và nếu có thì chia thế nào.
 *
 * KHÔNG ném với bất kỳ đầu vào nào: hàm chạy trong đường xử webhook, và một ngoại lệ ở đây làm
 * cả lượt nhận tiền thất bại — tiền đã vào tài khoản mà hệ thống không lưu được gì là ca tệ
 * nhất trong mọi ca. Đầu vào rác rơi vào nhánh `LECH_SO`, tức nhánh an toàn: không ghi gì.
 *
 * Việc CHỐNG TRÙNG (`bankTxnId` đã xử lý) KHÔNG ở đây — nó thuộc tầng gọi, vì nó là một câu tra
 * DB (`@@unique([provider, providerTxnId])` trên `BankTransaction`), không phải một phép tính.
 * Trùng thì bỏ qua hoàn toàn: không phân bổ, không đánh dấu, không thông báo.
 */
export function chiaTheoPhieuGop(
  soTienVe: number,
  phieu: PhieuGopDeChia | null,
): QuyetDinhChia {
  const ve = tron(soTienVe);

  if (phieu == null) {
    return {
      chia: false,
      ma: "KHONG_KHOP_PHIEU",
      conPhaiThu: null,
      moTa: `Tiền về ${vnd(ve)}đ không tra ra phiếu gộp nào từ nội dung chuyển khoản`,
    };
  }

  const conPhaiThu = conPhaiThuCuaPhieu(phieu.dong);

  // Thứ tự kiểm: TRẠNG THÁI trước, SỐ TIỀN sau. Phiếu đã PAID thì "còn phải thu" bằng 0, nên
  // nếu kiểm số trước thì một khoản 0đ sẽ lọt vào nhánh "khớp" — và quan trọng hơn: kế toán cần
  // biết lý do THẬT là "quét lại phiếu cũ", không phải "lệch số".
  if (phieu.trangThai !== "OPEN") {
    return {
      chia: false,
      ma: "PHIEU_KHONG_MO",
      conPhaiThu,
      moTa:
        `Tiền về ${vnd(ve)}đ khớp phiếu ${phieu.billId} nhưng phiếu đang ` +
        `${phieu.trangThai === "PAID" ? "ĐÃ THU ĐỦ" : phieu.trangThai === "VOID" ? "ĐÃ HUỶ" : "ĐÃ ĐÓNG"}`,
    };
  }

  if (ve !== conPhaiThu) {
    const lech = ve - conPhaiThu;
    return {
      chia: false,
      ma: "LECH_SO",
      conPhaiThu,
      moTa:
        `Tiền về ${vnd(ve)}đ ≠ số phải thu ${vnd(conPhaiThu)}đ của phiếu ${phieu.billId} ` +
        `(${lech > 0 ? "thừa" : "thiếu"} ${vnd(Math.abs(lech))}đ) — không phân bổ`,
    };
  }

  // Khớp TỪNG ĐỒNG ⇒ chia đích danh theo thứ tự dòng của PHIẾU (đã chụp lúc phát phiếu, nên
  // thứ tự trên tờ giấy khách đang cầm vẫn là thứ tự tiền đi). `paymentRequestId` làm khoá phụ
  // để hai dòng cùng `sortOrder` (dữ liệu hỏng) vẫn cho kết quả TẤT ĐỊNH — cùng một khoản tiền
  // phải chia giống nhau ở mọi lần chạy lại, kẻo không đối soát được.
  const theoThuTu = [...phieu.dong].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.paymentRequestId.localeCompare(b.paymentRequestId),
  );

  const lines: { paymentRequestId: string; amount: number }[] = [];
  for (const d of theoThuTu) {
    const rot = conThieuCuaDong(d);
    if (rot <= 0) continue; // dòng đã đủ tiền từ đường khác — không ghi dòng phân bổ 0đ
    lines.push({ paymentRequestId: d.paymentRequestId, amount: rot });
  }

  return { chia: true, billId: phieu.billId, lines, tongRot: ve };
}

// ─────────────────────────────────────────────────────────────────────────────
// TỰ RÓT NGUYÊN KHOẢN — chủ dự án chốt 22/10/2026, ĐÈ lên «ăn cả hoặc không ăn gì» ở CẤP PHIẾU
//
// *"Phiếu gộp một QR chuyển thiếu: tự rót tiền theo thứ tự khoản phải thu của từng con. Một khoản
// của con chỉ được coi là đã thu khi nhận đủ toàn bộ số phải thu. Khi số dư không đủ cho khoản kế
// tiếp thì dừng; không tạo khoản thu một phần. Tiền dư sau các khoản đã đủ vẫn là «tiền chờ gắn»
// trong Biến động số dư. Giữ nguyên tính nguyên tử «ăn cả hoặc không ăn gì» cho TỪNG KHOẢN của từng
// con."*
//
// Luật 16/09 ở đầu tệp VẪN ĐÚNG cho mọi phiếu KHÔNG đủ điều kiện của luật này (`chiaTheoPhieuGop`,
// giữ nguyên từng chữ): thẻ POS, phiếu có dòng không thuộc con nào (đợt đời cũ), cơ sở tắt cờ thu
// học phí linh hoạt. Hàm dưới đây chỉ được gọi khi người gọi đã kiểm các điều kiện đó — nó KHÔNG tự
// biết cờ hay nguồn tiền, vì cả hai là câu tra DB.
//
// Ba quy tắc, mỗi quy tắc có một ca khoá (`[CTR-*]`):
//  1. ĐÚNG SỐ ⇒ y hệt `chiaTheoPhieuGop` (không đổi hành vi của đường đang chạy tốt).
//  2. THIẾU ⇒ đi theo `sortOrder` của PHIẾU, rót NGUYÊN khoản cho tới khi gặp khoản đầu tiên mà số dư
//     không đủ thì DỪNG. KHÔNG nhảy cóc sang khoản nhỏ hơn phía sau: 3tr cho [5tr, 2tr] là không rót
//     gì — nhảy cóc là bỏ qua thứ tự phụ huynh đã được in trên tờ QR, và khoản bị bỏ qua sẽ không bao
//     giờ tới lượt.
//  3. THỪA ⇒ rót đủ MỌI khoản còn thiếu; phần dư không thuộc khoản nào ⇒ `conLai > 0` (tiền chờ gắn).
// ─────────────────────────────────────────────────────────────────────────────

export type QuyetDinhTuRot =
  | {
      chia: true;
      billId: string;
      /** Rót vào từng phiếu thu, NGUYÊN khoản, theo thứ tự dòng của PHIẾU. Luôn ≥ 1 dòng. */
      lines: { paymentRequestId: string; amount: number }[];
      /** Σ `lines`. Bằng số tiền về khi `conLai = 0`. */
      tongRot: number;
      /** Phần KHÔNG rót được — tiền chờ gắn. `soTienVe − tongRot`, luôn ≥ 0. */
      conLai: number;
      /** Mọi khoản còn thiếu của phiếu đã được rót đủ ⇒ phiếu có thể PAID. */
      hetPhieu: boolean;
    }
  | Extract<QuyetDinhChia, { chia: false }>;

/**
 * Quyết định tự rót nguyên khoản. Cùng bảo đảm với `chiaTheoPhieuGop`: KHÔNG ném với bất kỳ đầu vào
 * nào, đầu vào rác rơi vào nhánh không chia.
 */
export function chiaTuRotNguyenKhoan(soTienVe: number, phieu: PhieuGopDeChia | null): QuyetDinhTuRot {
  const ve = tron(soTienVe);
  const macDinh = chiaTheoPhieuGop(ve, phieu);

  // Đúng số: đường cũ, bất biến. (Không phiếu / phiếu không mở thì `macDinh.chia` luôn false.)
  if (macDinh.chia) {
    return { chia: true, billId: macDinh.billId, lines: macDinh.lines, tongRot: macDinh.tongRot, conLai: 0, hetPhieu: true };
  }

  // Không phiếu / phiếu không mở: lý do giữ NGUYÊN (kế toán cần biết "quét lại phiếu cũ").
  if (phieu == null || phieu.trangThai !== "OPEN") return macDinh;

  const conPhaiThu = conPhaiThuCuaPhieu(phieu.dong);
  if (ve <= 0 || conPhaiThu <= 0) return macDinh;

  const theoThuTu = [...phieu.dong].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.paymentRequestId.localeCompare(b.paymentRequestId),
  );

  const lines: { paymentRequestId: string; amount: number }[] = [];
  let du = ve;
  let dungSom = false;
  for (const d of theoThuTu) {
    const can = conThieuCuaDong(d);
    if (can <= 0) continue; // đã đủ từ đường khác — không phải «khoản không vừa», không dừng ở đây
    if (du < can) {
      dungSom = true; // khoản đầu tiên không vừa ⇒ DỪNG, kể cả khi khoản sau nhỏ hơn
      break;
    }
    lines.push({ paymentRequestId: d.paymentRequestId, amount: can });
    du -= can;
  }

  // Không khoản nào vừa (thiếu ngay khoản đầu): y hệt luật cũ — không rót, tiền nằm nguyên.
  if (lines.length === 0) return macDinh;

  return { chia: true, billId: phieu.billId, lines, tongRot: ve - du, conLai: du, hetPhieu: !dungSom };
}
