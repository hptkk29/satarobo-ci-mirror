// lib/finance/no-theo-con.ts — CÔNG NỢ THEO TỪNG CON. Thuần, không chạm DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN A · Chủ dự án chốt 16/09/2026
//
//   *"Phải thu con = học phí thực của orderItem (sau giảm). Đã thu con = Σ Payment của
//   orderItem đó. Còn nợ con = phải thu − đã thu. Đơn = Σ các con."*
//
// Phần THUẦN nằm ở đây; phần đọc DB nằm ở `debt.ts` (nhà duy nhất của mọi phép cộng tiền).
// Tách đôi để mọi luật ở đây kiểm được không cần Postgres — `pnpm test:unit` CẤM chạm DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// TẬP TRẠNG THÁI `Payment` ĐƯỢC CỘNG — NÓI RÕ MỘT LẦN, DÙNG Ở MỌI CHỖ
//
// "Đã thu" ở đây là **TRỤC A**: `accountantStatus = CONFIRMED` và `deletedAt IS NULL`
// (`KHOAN_DA_XAC_NHAN` trong `debt.ts`). Không phải "mọi dòng Payment".
//
// Vì sao trục A chứ không phải "mọi khoản đã ghi nhận":
//   · Đây là con số đi vào câu "bé này còn nợ bao nhiêu" mà sale đọc cho phụ huynh. Một khoản
//     kế toán chưa xác nhận có thể bị TỪ CHỐI, và khi đó số nợ tăng lại — nói với phụ huynh
//     rằng họ hết nợ rồi sau đó gọi lại đòi tiếp là thứ không sửa được bằng một bản vá.
//   · Toàn bộ phần còn lại của repo đã cộng theo trục A (`KHOAN_DA_XAC_NHAN` dùng ở
//     `debt.ts`, `sumConfirmed`, `computeEnrollmentDebt`). Thêm một định nghĩa "đã thu" thứ
//     sáu là đúng thứ module này sinh ra để chấm dứt.
//
// Tiền ĐÃ VỀ mà kế toán chưa xác nhận KHÔNG biến mất — nó ra `choXacNhan`, một cột RIÊNG.
// Màn hình phải in cả hai; gộp chúng lại là làm mất đúng thông tin mà kế toán cần.

/** Một dòng hàng của đơn, đã có sẵn số tiền. Người gọi nạp từ DB. */
export type DongDon = {
  orderItemId: string;
  /** Tên hiển thị (tên con / tên sản phẩm) — `OrderItem.itemName`. */
  ten: string;
  /** Khoá học, nếu dòng là ghi danh. */
  khoa: string | null;
  /**
   * DANH TÍNH CON [25/09/2026] — `ten` ở trên là `OrderItem.itemName`, và trên đường tạo
   * đơn chính cột đó là tên KHOÁ HỌC. Hai con cùng khoá ⇒ hai dòng `ten` giống hệt nhau,
   * đúng câu chủ dự án hỏi: *"sao biết là đang giảm đơn cho con nào?"*
   *
   * Hai trường dưới là thứ phân biệt được. Chúng KHÔNG thay `ten` — `ten` vẫn là nhãn
   * KHOÁ/SẢN PHẨM và vẫn phải hiện; cách dựng nhãn người xem nằm ở MỘT chỗ:
   * `lib/orders/ten-con-tren-dong.ts`.
   */
  tenHocVien?: string | null;
  /** `OrderItem.metadata.leadChildId` — tra tên qua bản đồ do người gọi gom lô. */
  leadChildId?: string | null;
  /** Tạm tính TRƯỚC giảm: `unitPrice × quantity` (= `OrderItem.totalPrice`). */
  tamTinh: number;
  /** Giảm giá của RIÊNG dòng (`OrderItem.discountAmount`). */
  giam: number;
  /**
   * GIÁ TRỊ QUYẾT TOÁN khi bé này đã DỪNG HỌC — `OrderItem.usedValue` [PHIÊN D, 21/09/2026].
   *
   * `null` = bé còn đang học ⇒ phải thu vẫn là `tamTinh − giam` như trước. Có số ⇒ **phải
   * thu của bé là ĐÚNG số này**, vì bé chỉ còn phải trả phần đã dùng.
   *
   * ⚠️ Đây là cột DUY NHẤT làm đổi `phaiThu`, và nó cố ý KHÔNG sửa `tamTinh`/`giam`: hai số
   * kia là lời khai lúc BÁN (`Order.subtotal` = Σ `totalPrice`, cổng soát giá so `unitPrice`
   * với giá niêm yết). Giữ cả ba là giữ được câu trả lời cho *"đã bớt cho bé bao nhiêu vì
   * nghỉ giữa chừng"* — một phép trừ, không phải một cuộc khảo cổ.
   *
   * ⚠️ `0` KHÁC `null`: `TRUNG_TAM_HUY` cho ra đúng `0` (bé không phải trả gì), và nó phải
   * đè lên học phí gốc chứ không được rơi về nó. Dùng `??` chứ đừng dùng `||`.
   */
  daDung?: number | null;
};

/** Một khoản tiền đã gắn vào dòng. Người gọi đã lọc theo tập trạng thái. */
export type KhoanCuaDong = {
  orderItemId: string | null;
  amount: number;
};

/**
 * Một khoản **ĐÃ VỀ** của đơn — tập dùng cho VẾ ĐƠN của cổng tạo đợt.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO TẬP NÀY RỘNG HƠN TRỤC A, VÀ VÌ SAO HAI VẾ CỦA CỔNG DÙNG HAI ĐỊNH NGHĨA
 *
 * Chủ dự án chốt 18/09/2026: *"cổng này chỉ giới hạn số tiền được ĐÒI THÊM, nên đếm rộng;
 * đòi thiếu còn thu lại được, đòi thừa là phụ huynh mất tiền."*
 *
 * Hai vế trả lời hai câu hỏi khác nhau, nên **cố ý** đếm hai tập khác nhau:
 *
 *   · **Vế CON** — *"bé này còn nợ bao nhiêu?"* → **TRỤC A** (`accountantStatus = CONFIRMED`).
 *     Con số này sale đọc cho phụ huynh nghe. Một khoản kế toán chưa xác nhận có thể bị TỪ
 *     CHỐI, và khi đó nợ tăng lại — nói với phụ huynh "hết nợ rồi" xong gọi lại đòi tiếp là
 *     thứ không sửa được bằng một bản vá. Vế con **giữ nguyên trục A**.
 *
 *   · **Vế ĐƠN** — *"đơn này còn được phép ĐÒI THÊM bao nhiêu?"* → **tập RỘNG** dưới đây.
 *     Tiền đã về tài khoản thì nó đã về, bất kể kế toán đã đối soát chưa. Không trừ nó ra là
 *     hệ thống in QR đòi lại phần phụ huynh vừa chuyển.
 *
 * Hai vế lệch nhau KHÔNG phải mâu thuẫn — sai số giữa chúng chính là "tiền đã về mà chưa
 * xác nhận", và đó là một trạng thái có thật của nghiệp vụ, không phải lỗi làm tròn.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LỌC GÌ, VÀ VÌ SAO ĐÚNG BA ĐIỀU KIỆN ĐÓ
 *
 *   1. `deletedAt IS NULL`      — khoản xoá mềm không còn là tiền.
 *   2. **KHÔNG lọc `accountantStatus`** (PENDING vẫn tính) — đó là điểm khác trục A.
 *   3. **TRỪ `REJECTED`** — kế toán đã từ chối thì tiền ấy không về (séc trượt / chuyển nhầm
 *      / khai khống). Còn là nợ thật, nên KHÔNG được trừ vào phần đòi thêm.
 *
 * ⚠️ **`REFUNDED` thì VẪN TÍNH, và đó không phải sơ suất.** `refundPayment` tạo một dòng
 * `amount` ÂM riêng (`lib/payments/payment.ts:1075`) chứ không sửa dòng gốc, nên cộng cả hai
 * lại là tự triệt tiêu — đúng. Loại `REFUNDED` ra sẽ bỏ mất dòng gốc mà giữ dòng âm, tức
 * khoản hoàn bị tính HAI lần. Ghi chú gốc ở `lib/finance/hai-truc-theo-don.ts`.
 *
 * ⚠️ **KHÔNG lọc `paymentType`** — bút toán `ADJUSTMENT` (bản đảo của `goGanTheoCon`) mang
 * `amount` âm và phải được trừ ra. Lọc nó đi là giữ lại tiền đã bị gỡ.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUAN HỆ VỚI TRỤC B (`KHOAN_DA_GHI_NHAN`) — GẦN GIỐNG, KHÔNG PHẢI MỘT
 *
 * Trục B lọc `saleStatus IN (RECORDED, COLLECT_CONFIRMED)` + `deletedAt IS NULL`. Enum
 * `PaymentSaleStatus` chỉ có ĐÚNG HAI giá trị ấy, nên vế `saleStatus` là phép so luôn đúng
 * ⇒ trục B thực chất = `deletedAt IS NULL`, **kể cả khoản `REJECTED`**. Đó là nợ đã đo và
 * ghim ở `lib/finance/hai-truc-theo-don.test.ts` ca `[HT-05]` (`it.fails`), cố ý CHƯA vá vì
 * trục B còn nuôi bốn đường tiền khác (QR · ngưỡng SePay · ZNS học phí · cổng chốt lead).
 *
 * ⚠️ Nên **tập này và trục B lệch nhau đúng bằng Σ khoản `REJECTED`** — và tôi KHÔNG sửa
 * trục B ở đây. Hệ quả phải biết: khi đơn có khoản `REJECTED`, khối *"Công nợ đơn hàng"*
 * (trục B) sẽ báo "còn thiếu" ÍT HƠN cổng này cho phép đòi. Cổng đúng, khối kia là cái nợ
 * `[HT-05]`. Đừng "sửa cho hai chỗ giống nhau" bằng cách nới cổng.
 */
export type KhoanDaVe = {
  /**
   * `Payment.id`.
   *
   * Cần vì tập này còn ra thẳng `khoanDaVeChiTiet` — danh sách màn đơn dùng để GẮN / BỎ GẮN
   * từng khoản. Không có id thì màn hình có số mà không có thứ để bấm.
   */
  id: string;
  orderItemId: string | null;
  amount: number;
  /** `Payment.accountantStatus` — CHỈ để hiển thị, KHÔNG tham gia phép cộng nào. */
  trangThaiKeToan: string;
  /**
   * `Payment.paymentType` — `PAYMENT` | `ADJUSTMENT`. CHỈ để hiển thị + lọc AFFORDANCE.
   *
   * ⚠️ **KHÔNG tham gia phép cộng nào**, và đừng dùng nó để lọc `tongDaVe`. Bút toán
   * `ADJUSTMENT` mang `amount` ÂM và phải được trừ ra — lọc nó đi là giữ lại tiền đã bị gỡ
   * (chú thích đầu tệp, mục "KHÔNG lọc `paymentType`").
   *
   * Việc DUY NHẤT của trường này: màn đơn không được mời người dùng "Gắn cho bé…" một bút
   * toán đảo. Một cái nút hứa điều nó không làm được là một lời hứa suông (luật 12).
   */
  loaiButToan: string;
  /**
   * Dòng này ĐÃ CÓ bút toán đảo còn sống trỏ vào (`adjustmentOfId = id`, chưa xoá mềm).
   *
   * Sinh ra cùng phép TÁCH KHOẢN [20/09/2026]: tách để lại dòng gốc NGUYÊN VẸN + một bút
   * toán đảo + n dòng mới. Cặp gốc/đảo cộng lại bằng 0 nên mọi TỔNG vẫn đúng, nhưng cả hai
   * vẫn mang `orderItemId = NULL` ⇒ nếu màn hình không biết trường này thì khối "chưa gắn
   * cho con nào" sẽ liệt kê một dòng `+9.530.000` và một dòng `−9.530.000`, kèm nút "Gắn cho
   * bé…" trên cả hai. Tổng in ra đúng (0đ) mà danh sách thì vô nghĩa.
   *
   * ⚠️ Cũng KHÔNG tham gia phép cộng nào. Lọc dòng đã bị đảo ra khỏi `tongDaVe` mà vẫn giữ
   * dòng đảo là trừ tiền HAI lần.
   */
  daDao: boolean;
};

/** Một đợt thu của dòng. */
export type DotCuaDong = {
  id: string;
  orderItemId: string | null;
  installmentNo: number;
  amountDue: number;
  dueDate: Date | null;
  /** `PaymentRequest.status`. */
  trangThai: "PENDING" | "PARTIAL" | "PAID" | "VOID";
  /** Σ `PaymentAllocation.amount` đã rót vào đợt này. */
  daRot: number;
};

export type NoCuaCon = {
  orderItemId: string;
  /** `OrderItem.itemName` — nhãn KHOÁ/SẢN PHẨM. KHÔNG phải tên bé, xem `DongDon`. */
  ten: string;
  khoa: string | null;
  /** Tên học viên thật, `null` khi dòng chưa gắn hồ sơ. Xem `DongDon.tenHocVien`. */
  tenHocVien: string | null;
  /** Con của lead, chưa có hồ sơ học viên. Xem `DongDon.leadChildId`. */
  leadChildId: string | null;
  /** Học phí thực của con = tạm tính − giảm giá của dòng. */
  phaiThu: number;
  /** TRỤC A — xem chú thích đầu file. */
  daThu: number;
  /** Tiền đã về mà kế toán CHƯA xác nhận. KHÔNG trừ vào `conNo`. */
  choXacNhan: number;
  /** `phaiThu − daThu`. Có thể ÂM (đóng thừa) — trả số thô, màn hình tự diễn giải. */
  conNo: number;
  /**
   * Σ tiền ĐÃ VỀ của riêng bé này, theo tập RỘNG (`KhoanDaVe`) — tức gồm cả khoản kế toán
   * chưa xác nhận, và KHÔNG gồm khoản đã bị TỪ CHỐI.
   *
   * ⚠️ Con số THỨ BA về "bé này đã đóng bao nhiêu", bên cạnh `daThu` (trục A) và
   * `choXacNhan` (B trừ A). Ba con số vì có ba câu hỏi khác nhau, không phải vì trùng lặp:
   *   · `daThu`      — kế toán đã xác nhận bao nhiêu (số nói với phụ huynh);
   *   · `choXacNhan` — đã về mà chưa đối soát (việc nội bộ);
   *   · `daVe`       — đã về, chấm hết (dùng để chặn ATTRIBUTION, xem `conCoTheNhan`).
   * `daVe` KHÁC `daThu + choXacNhan` đúng bằng Σ khoản `REJECTED` của bé — nợ `[HT-05]`.
   */
  daVe: number;
  /**
   * `max(0, phaiThu − daVe)` — bé này còn có thể NHẬN THÊM bao nhiêu tiền đã thu.
   *
   * Trần của phép TÁCH KHOẢN (`kiemTachKhoan`). Cố ý KHÁC `conNo`: `conNo` đo theo trục A
   * nên tách hai lần cho cùng một bé thì lần nào cũng thấy trần còn nguyên. Lý do đầy đủ ở
   * đầu `lib/finance/tach-khoan.ts`.
   *
   * ⚠️ Không âm — bé đóng thừa thì trần là 0, tức không nhận thêm được đồng nào.
   */
  conCoTheNhan: number;
  /** Các đợt CHƯA đóng xong của con (PENDING/PARTIAL), theo hạn rồi tới số đợt. */
  dotDangMo: DotCuaDong[];
  /** Σ `amountDue` của các đợt đang mở — dùng cho cổng "tạo đợt không vượt còn nợ". */
  tongDotDangMo: number;
};

export type NoTheoConKetQua = {
  con: NoCuaCon[];
  /** Σ các con. KHÔNG đọc `Order.totalAmount` — xem chú thích dưới. */
  tongPhaiThu: number;
  tongDaThu: number;
  tongChoXacNhan: number;
  tongConNo: number;
  /**
   * Tiền đã vào đơn nhưng CHƯA gắn dòng nào (`Payment.orderItemId IS NULL`).
   *
   * ⚠️ KHÔNG cộng vào `tongDaThu`, và đó là chủ ý: khoản chưa gắn con thì không nói được
   * bé nào hết nợ. Cộng nó vào tổng sẽ làm tổng đơn "đúng" trong khi từng con vẫn sai — đúng
   * kiểu số liệu khiến người ta tin nhầm. Đây chính là 24 khoản / 178.544.000đ trên prod, và
   * màn hình phải HIỆN nó ra như một việc cần làm.
   */
  chuaGanCon: number;
  /**
   * Đợt ĐANG MỞ mà `orderItemId` là NULL — đợt của LUỒNG CŨ (mọi đơn trước 16/09).
   *
   * ⚠️ Trường này thêm ở PHIÊN B sau khi đo ra một lỗ: `con[].dotDangMo` lọc theo
   * `x.orderItemId === d.orderItemId`, nên đợt NULL KHÔNG thuộc bé nào và rơi khỏi kết quả
   * HOÀN TOÀN. Màn gắn tiền dựng danh sách đợt từ `con[]` ⇒ đơn cũ hiện ra 0 đợt để chia, và
   * cổng `kiemChiaTheoCon` từ chối chúng với câu "đợt không thuộc đơn này".
   *
   * Nghĩa là trước bản vá này, **24 giao dịch UNMATCHED của đơn cũ không gắn được bằng màn
   * mới** — đúng tập việc mà PHIÊN B sinh ra để dọn.
   */
  dotChuaGanCon: DotCuaDong[];
  /**
   * Còn nợ của **CẢ ĐƠN** = `tongPhaiThu − (tongDaThu + chuaGanCon)`.
   *
   * ⚠️ KHÁC `tongConNo`: `tongConNo` là Σ còn nợ từng con và **cố ý** không trừ khoản chưa
   * gắn con (xem chú thích `chuaGanCon`). Số đó đúng cho câu *"bé này còn nợ bao nhiêu"* và
   * SAI cho câu *"đơn này còn được phép thu thêm bao nhiêu"*. Hai câu hỏi khác nhau nên phải
   * là hai con số khác nhau — gộp lại là chỗ bug tiền nằm.
   *
   * Có thể ÂM (đơn đã đóng thừa). Trả số thô.
   */
  conNoDon: number;
  /**
   * Σ `amountDue` của **mọi** đợt đang mở của đơn, **KỂ CẢ** đợt `orderItemId` NULL.
   *
   * ⚠️ Không phải `Σ con[].tongDotDangMo` — vế đó bỏ mất đợt của luồng cũ, mà đơn trước 16/09
   * thì đợt nào cũng NULL. Dùng vế thiếu ấy làm cổng là mở toang đúng tập đơn cũ.
   */
  tongDotDangMoDon: number;
  /**
   * Σ **tiền đã về** của đơn — định nghĩa RỘNG, xem `KhoanDaVe`.
   *
   * Đây là số trừ vào `conNoDon`. Nó KHÁC `tongDaThu` (trục A, theo con) và KHÁC
   * `chuaGanCon` (trục A, phần không thuộc con nào) — ba con số, ba câu hỏi.
   */
  tongDaVe: number;
  /**
   * TỪNG khoản đã về của đơn — chi tiết đứng sau `tongDaVe`.
   *
   * Màn đơn dùng nó cho CẢ HAI việc, tự lọc theo `orderItemId`:
   *   · `== null` ⇒ khoản chờ gắn, hiện nút "Gắn cho bé…";
   *   · `!= null` ⇒ khoản của bé đó, hiện nút "Bỏ gắn".
   *
   * ⚠️ MỘT danh sách, không phải hai. Tách thành `khoanChoGan` + `khoanCuaCon` là hai trường
   * cùng mô tả một tập — và hai trường thì có ngày lệch nhau.
   *
   * ⚠️ Lấy từ tập RỘNG, không phải trục A. Đó là điểm mấu chốt: 4 khoản của
   * `ORD-260917-000001` đều `PENDING`, nên nếu lọc trục A thì danh sách này RỖNG và màn hình
   * không có gì để gắn — đúng tình trạng trước bản vá này, khi tiền có thật trong DB mà
   * không đường nào chạm tới được.
   *
   * ⚠️ KHÁC `chuaGanCon` (một con SỐ, trục A) và khác `dotChuaGanCon` (danh sách ĐỢT). Ba
   * thứ tên gần giống nhau vì chúng nói cùng một vấn đề ở ba tầng: tiền · số · phiếu.
   */
  khoanDaVeChiTiet: KhoanDaVe[];
};

const tron = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);

/**
 * Tính công nợ từng con của một đơn. THUẦN.
 *
 * ⚠️ `tongPhaiThu` là Σ các dòng, KHÔNG phải `Order.totalAmount`. Hai số đó có thể lệch nhau
 * (header đơn đến từ đường ghi riêng ở `backfill-order.ts` / `ghi-giao-dich-cu.ts` và không
 * phải lúc nào cũng do các dòng sinh ra). Lấy Σ dòng là lấy con số mà TỪNG CON cộng lại ra —
 * nếu nó lệch `totalAmount` thì đó là một sự thật phải thấy, không phải thứ để che bằng cách
 * đọc header.
 */
export function tinhNoTheoCon(input: {
  dong: readonly DongDon[];
  khoanDaXacNhan: readonly KhoanCuaDong[];
  khoanChoXacNhan: readonly KhoanCuaDong[];
  /**
   * Tập RỘNG cho vế ĐƠN của cổng — xem `KhoanDaVe`. **BẮT BUỘC**, không mặc định.
   *
   * ⚠️ Không đặt `= []`: một mặc định rỗng ở đây làm `conNoDon` = trọn học phí đơn, tức vế
   * đơn nới hết cỡ và **không bao giờ cắn** — đúng cái lỗ mà trường này sinh ra để vá. Luật
   * 7: để `tsc` liệt kê mọi chỗ gọi thay vì để một chỗ quên rồi im lặng.
   */
  khoanDaVe: readonly KhoanDaVe[];
  dot: readonly DotCuaDong[];
}): NoTheoConKetQua {
  const cong = (ds: readonly KhoanCuaDong[], id: string) =>
    ds.reduce((s, k) => (k.orderItemId === id ? s + tron(k.amount) : s), 0);

  const con: NoCuaCon[] = input.dong.map((d) => {
    // PHIÊN D — bé đã dừng học thì phải thu là GIÁ TRỊ QUYẾT TOÁN, không phải học phí gốc.
    // `?? ` chứ không `||`: `TRUNG_TAM_HUY` ra đúng 0 và 0 phải thắng.
    const phaiThu =
      d.daDung != null
        ? Math.max(0, tron(d.daDung))
        : Math.max(0, tron(d.tamTinh) - tron(d.giam));
    const daThu = cong(input.khoanDaXacNhan, d.orderItemId);
    const choXacNhan = cong(input.khoanChoXacNhan, d.orderItemId);
    // Tập RỘNG, lọc theo chính bé này. Cộng CẢ bút toán đảo (âm) — một phần tách bị gỡ sau
    // này thì trần của bé phải mở lại đúng bằng phần đã gỡ.
    const daVe = input.khoanDaVe.reduce(
      (s, k) => (k.orderItemId === d.orderItemId ? s + tron(k.amount) : s),
      0,
    );
    const dotDangMo = input.dot
      .filter(
        (x) =>
          x.orderItemId === d.orderItemId &&
          (x.trangThai === "PENDING" || x.trangThai === "PARTIAL"),
      )
      // Hạn sớm trước; đợt không hạn xuống cuối (không phải "đầu" — đợt thiếu hạn là đợt
      // chưa ai xếp lịch, không phải đợt gấp nhất).
      .sort((a, b) => {
        const ha = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
        const hb = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
        return ha - hb || a.installmentNo - b.installmentNo;
      });

    return {
      orderItemId: d.orderItemId,
      ten: d.ten,
      khoa: d.khoa,
      tenHocVien: d.tenHocVien ?? null,
      leadChildId: d.leadChildId ?? null,
      phaiThu,
      daThu,
      choXacNhan,
      conNo: phaiThu - daThu,
      daVe,
      conCoTheNhan: Math.max(0, phaiThu - daVe),
      dotDangMo,
      tongDotDangMo: dotDangMo.reduce((s, x) => s + tron(x.amountDue), 0),
    };
  });

  const dotChuaGanCon = input.dot
    .filter((x) => x.orderItemId == null && (x.trangThai === "PENDING" || x.trangThai === "PARTIAL"))
    .sort((a, b) => {
      const ha = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
      const hb = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
      return ha - hb || a.installmentNo - b.installmentNo;
    });

  const tongPhaiThu = con.reduce((s, c) => s + c.phaiThu, 0);
  const tongDaThu = con.reduce((s, c) => s + c.daThu, 0);
  const chuaGanCon = input.khoanDaXacNhan.reduce(
    (s, k) => (k.orderItemId == null ? s + tron(k.amount) : s),
    0,
  );
  // Cộng TOÀN BỘ tập rộng, không lọc theo con: vế đơn hỏi "đơn còn đòi thêm được bao nhiêu",
  // nên tiền của bé nào cũng trừ như nhau — kể cả tiền chưa biết của bé nào.
  const tongDaVe = input.khoanDaVe.reduce((s, k) => s + tron(k.amount), 0);

  return {
    con,
    dotChuaGanCon,
    tongPhaiThu,
    tongDaThu,
    tongChoXacNhan: con.reduce((s, c) => s + c.choXacNhan, 0),
    tongConNo: con.reduce((s, c) => s + c.conNo, 0),
    chuaGanCon,
    tongDaVe,
    khoanDaVeChiTiet: [...input.khoanDaVe],
    // Cả đơn: trừ MỌI tiền đã về (định nghĩa rộng — `KhoanDaVe`), không phải chỉ trục A.
    //
    // ⚠️ Bản 18/09 sáng dùng `tongPhaiThu − (tongDaThu + chuaGanCon)`, tức cả hai vế đều
    // trục A. Đo trên đơn thật `ORD-260917-000001`: 4 khoản `PENDING` ⇒ cả hai vế = 0 ⇒
    // `conNoDon` = trọn 20.064.000đ, trong khi phụ huynh đã chuyển 4.836.000đ. Cổng cho tạo
    // thêm đúng 4.836.000đ ⇒ tổng đợt mở thành trọn đơn ⇒ QR đòi lại phần đã trả. Cùng một
    // kịch bản mà vế đơn sinh ra để chặn, chỉ khác đường vào.
    conNoDon: tongPhaiThu - tongDaVe,
    // Mọi đợt đang mở của đơn = đợt của các con + đợt NULL (luồng cũ).
    tongDotDangMoDon:
      con.reduce((s, c) => s + c.tongDotDangMo, 0) +
      dotChuaGanCon.reduce((s, x) => s + tron(x.amountDue), 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CỔNG TẠO ĐỢT
// ─────────────────────────────────────────────────────────────────────────────

export type KiemTaoDot =
  | { ok: true; soTien: number }
  | { ok: false; loi: string };

/**
 * Tạo được một đợt số tiền này cho con này không.
 *
 * Luật (chủ dự án chốt 17/09/2026 — **HAI VẾ**):
 *
 *     số tiền ≤ min( còn nợ con − Σ đợt mở của con ,
 *                    còn nợ ĐƠN − Σ đợt mở của cả đơn )
 *
 * với *còn nợ đơn* = Σ học phí thực các con − Σ **mọi** Payment đã thu của đơn, **kể cả khoản
 * chưa gắn con**. Không bắt lên lịch cả khoá, không trần số đợt.
 *
 * ⚠️ VẾ THỨ HAI THÊM 17/09 VÌ VẾ MỘT MÌNH KHÔNG ĐỦ — đo được, không phòng xa. `chuaGanCon` vốn
 * đã được tính từ PHIÊN A nhưng **chỉ để hiển thị**: hai màn in nó ra như một việc cần làm, và
 * không cổng nào đọc. Hệ quả trên đơn 2 con đã có 6.000.000đ vào mà chưa gắn bé nào: `conNo`
 * của từng bé không biết gì về 6 triệu ấy, nên sale tạo được các đợt cộng lại bằng TRỌN học
 * phí đơn, hệ thống phát QR đòi đủ số, và phụ huynh trả lần thứ hai phần họ đã trả.
 *
 * Đây là cùng một lớp lỗi với vế "Σ đợt đang mở" dưới đây: cổng đúng công thức nhưng **được
 * cho ăn một con số hẹp hơn sự thật**. Sửa bằng cách đưa thêm số vào cổng, không phải bằng
 * cách viết lại điều kiện ở chỗ gọi.
 *
 * ⚠️ Trừ **Σ đợt đang mở** chứ không chỉ so với còn nợ. Bỏ vế đó là sale tạo được hai đợt,
 * mỗi đợt bằng trọn số nợ — rồi hệ thống phát hai mã QR, mỗi mã đòi đủ tiền, và phụ huynh nào
 * quét cả hai thì trả gấp đôi. Đây là lỗi tiền im lặng: không cổng nào khác canh, và nó chỉ lộ
 * ra khi khách đã chuyển.
 *
 * ⚠️ KHÔNG có trần số đợt và KHÔNG bắt lên lịch cả khoá — đó là toàn bộ điểm khác của phiên
 * này so với kế hoạch trả góp cũ. Sale tạo một đợt khi phụ huynh nói sẽ đóng bao nhiêu, không
 * phải khai trước cả năm.
 */
/** Vì sao KHÔNG tạo được đợt cho một con. */
export type LyDoKhongTaoDuoc =
  | { duoc: true; toiDa: number }
  | { duoc: false; vi: "BE_HET_NO" | "DOT_CUA_BE_DA_PHU" | "KE_HOACH_DON_DA_PHU"; loi: string };

/**
 * Bé này còn tạo được đợt tối đa bao nhiêu — và nếu không thì VÌ SAO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO HÀM NÀY TỒN TẠI [25/09/2026]
 *
 * Chủ dự án hỏi, nhìn vào chính màn hình: *"ở dưới có kế hoạch thanh toán, ở trên có
 * từng đợt rồi, tại sao ở chỗ con vẫn có nút thêm đợt?"*
 *
 * Đo trên đơn thật (`ZZDEMO-CNC-01`, 2 con, kế hoạch 4 đợt phủ trọn 19.959.999đ):
 *
 *     vế CON : 9.879.992 − 0          = 9.879.992   ← giao diện in số này ra
 *     vế ĐƠN : 19.959.999 − 19.959.999 = 0          ← giao diện KHÔNG biết vế này
 *
 * Nút `+ Đợt` hiện ra, form in "tối đa 9.879.992đ", và `kiemTaoDot` TỪ CHỐI **mọi** số
 * tiền — thử 1 đồng cũng từ chối. Tức nút ấy là lời hứa suông và con số "tối đa" là con
 * số nói dối (luật 12).
 *
 * Gốc: `kiemTaoDot` có HAI vế, còn giao diện tự tính `c.conNo - c.tongDotDangMo` — đúng
 * MỘT vế. Đó là cùng một lớp lỗi mà chính `kiemTaoDot` đã sinh ra để chấm dứt: *"cổng
 * đúng công thức nhưng được cho ăn một con số hẹp hơn sự thật"*.
 *
 * ⚠️ ĐỪNG viết lại phép `Math.min` này tại chỗ gọi. Giao diện và cổng phải lấy trần từ
 * CÙNG một nguồn, nếu không thì màn hình lại hứa một số mà máy chủ không nhận.
 */
export function tranTaoDot(input: {
  conNo: number;
  tongDotDangMo: number;
  /** `NoTheoConKetQua.conNoDon`. */
  conNoDon: number;
  /** `NoTheoConKetQua.tongDotDangMoDon`. */
  tongDotDangMoDon: number;
  /** Số đợt đang mở của CẢ ĐƠN — chỉ để viết câu giải thích cho người đọc. */
  soDotDon: number;
}): LyDoKhongTaoDuoc {
  const vnd = (n: number) => tron(n).toLocaleString("vi-VN");
  const conNo = tron(input.conNo);
  const veCon = conNo - tron(input.tongDotDangMo);
  const veDon = tron(input.conNoDon) - tron(input.tongDotDangMoDon);

  if (conNo <= 0) {
    return { duoc: false, vi: "BE_HET_NO", loi: "Đã thu đủ — không cần tạo đợt." };
  }
  // Vế ĐƠN xét TRƯỚC vế con: khi cả hai cùng chặn, lý do của đơn mới là lý do người dùng
  // cần đọc — nói "đợt của bé đã phủ hết" trong khi bé chưa có đợt nào là nói sai.
  if (veDon <= 0) {
    return {
      duoc: false,
      vi: "KE_HOACH_DON_DA_PHU",
      loi:
        `Đơn đã có kế hoạch ${input.soDotDon} đợt phủ trọn ${vnd(input.tongDotDangMoDon)}đ — ` +
        `thu theo kế hoạch đó. Muốn thu riêng theo từng bé thì huỷ bớt đợt của đơn trước.`,
    };
  }
  if (veCon <= 0) {
    return {
      duoc: false,
      vi: "DOT_CUA_BE_DA_PHU",
      loi: `Các đợt đang mở của bé đã phủ hết ${vnd(conNo)}đ còn nợ.`,
    };
  }
  return { duoc: true, toiDa: Math.min(veCon, veDon) };
}

export function kiemTaoDot(input: {
  soTien: number;
  conNo: number;
  tongDotDangMo: number;
  tenCon: string;
  /**
   * Còn nợ của CẢ ĐƠN — `NoTheoConKetQua.conNoDon`, đã trừ khoản chưa gắn con.
   *
   * ⚠️ BẮT BUỘC, không mặc định (luật 7). Một mặc định ở đây — kể cả
   * `Number.POSITIVE_INFINITY` — biến vế đơn thành vế im lặng không bao giờ cắn, và không có
   * gì báo cho người gọi biết họ vừa bỏ nó.
   */
  conNoDon: number;
  /** Σ đợt đang mở của CẢ ĐƠN, kể cả đợt NULL — `NoTheoConKetQua.tongDotDangMoDon`. */
  tongDotDangMoDon: number;
}): KiemTaoDot {
  const vnd = (n: number) => tron(n).toLocaleString("vi-VN");
  const soTien = tron(input.soTien);
  if (!Number.isFinite(input.soTien) || soTien <= 0) {
    return { ok: false, loi: "Số tiền đợt phải lớn hơn 0" };
  }
  const conLaiCon = tron(input.conNo) - tron(input.tongDotDangMo);
  const conLaiDon = tron(input.conNoDon) - tron(input.tongDotDangMoDon);

  if (conLaiCon <= 0) {
    return {
      ok: false,
      loi:
        `${input.tenCon}: các đợt đang mở đã phủ hết phần còn nợ ` +
        `(còn nợ ${vnd(input.conNo)}đ, đang mở ${vnd(input.tongDotDangMo)}đ)`,
    };
  }
  // Vế ĐƠN phải báo lỗi bằng NGÔN NGỮ CỦA NGUYÊN NHÂN, không phải "tối đa X đồng". Sale nhìn
  // số nợ của bé trên màn hình rồi gõ đúng số đó, nên một câu "tối đa 2.976.000đ" trong khi
  // màn in "còn nợ 8.976.000đ" đọc như hệ thống bị lỗi. Phải nói ra chỗ tiền đang nằm.
  if (conLaiDon <= 0) {
    return {
      ok: false,
      loi:
        `Cả đơn không còn phần được thu thêm (còn nợ đơn ${vnd(input.conNoDon)}đ, ` +
        `đợt đang mở của đơn ${vnd(input.tongDotDangMoDon)}đ). ` +
        `Kiểm khoản đã thu chưa gắn cho bé nào trước khi tạo đợt mới.`,
    };
  }
  if (soTien > conLaiDon) {
    return {
      ok: false,
      loi:
        `Vượt phần còn được thu của CẢ ĐƠN: tối đa ${vnd(conLaiDon)}đ ` +
        `(còn nợ đơn ${vnd(input.conNoDon)}đ − đợt đang mở của đơn ${vnd(input.tongDotDangMoDon)}đ). ` +
        `Nếu số nợ của ${input.tenCon} trông lớn hơn, đơn đang có tiền đã thu chưa gắn cho bé nào.`,
    };
  }
  if (soTien > conLaiCon) {
    return {
      ok: false,
      loi:
        `${input.tenCon}: tối đa ${vnd(conLaiCon)}đ ` +
        `(còn nợ ${vnd(input.conNo)}đ − đợt đang mở ${vnd(input.tongDotDangMo)}đ)`,
    };
  }
  return { ok: true, soTien };
}

/**
 * Huỷ được đợt này không.
 *
 * Luật: *"Huỷ đợt chưa có tiền: được. Đợt đã có tiền: không huỷ."*
 *
 * ⚠️ "Có tiền" đo bằng `daRot` (Σ phân bổ THẬT), KHÔNG bằng `trangThai`. Trạng thái là thứ
 * tính lại được và có lúc chưa kịp tính; số tiền đã rót thì không nói dối. Một đợt còn
 * `PENDING` mà đã có 1đ rót vào vẫn là đợt có tiền.
 */
export function kiemHuyDot(dot: Pick<DotCuaDong, "trangThai" | "daRot">): KiemTaoDot {
  if (dot.trangThai === "VOID") return { ok: false, loi: "Đợt này đã huỷ rồi" };
  if (tron(dot.daRot) > 0) {
    return {
      ok: false,
      loi: `Đợt đã nhận ${tron(dot.daRot).toLocaleString("vi-VN")}đ — không huỷ được. Sửa bằng cách tạo đợt mới cho phần còn lại.`,
    };
  }
  return { ok: true, soTien: 0 };
}
