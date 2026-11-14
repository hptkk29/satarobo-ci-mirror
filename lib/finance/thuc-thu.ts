// lib/finance/thuc-thu.ts — B-02 · quyết định B3 (24/08/2026).
//
// MỘT công thức "thực thu" cho toàn hệ thống. Trước đây mỗi màn tự cộng một kiểu:
// màn kế toán và ROAS cộng `Order.totalAmount` (giá trị hợp đồng đã chốt — tiền có thể
// chưa về, và hoàn/điều chỉnh không bao giờ đụng tới nó), báo cáo doanh thu cộng
// `Payment` nhưng chỉ lấy CONFIRMED nên bút toán hoàn (âm) rơi ra ngoài. Kết quả: số
// doanh thu PHỒNG, và phồng im lặng.
//
// Luật đúng, bám đúng cách `lib/finance/payment.ts` ghi sổ:
//   • CONFIRMED — kế toán đã xác nhận. Đây là tiền thật.        → cộng
//   • REFUNDED  — refundPayment() ghi bút toán ÂM đối ứng,
//                 KHÔNG xoá bản gốc.                            → cộng (số âm ⇒ trừ ra)
//   • ĐIỀU CHỈNH — xem khối 🔴 ngay dưới: nay là DELTA, luôn được cộng, KHÔNG loại gốc.
//
// 🔴 ĐỔI MÔ HÌNH 07/09/2026 (migration `payment_type_tach_khoi_status`), áp khi hợp nhất
//    `main` → `test` ngày 16/09/2026.
//    TRƯỚC: `adjustPayment()` tạo một bút toán trạng thái `ADJUSTED` mang SỐ ĐÚNG, bản gốc
//      giữ số cũ ⇒ phải LOẠI bản gốc, không thì cộng đôi. Đó là lý do `WHERE_THUC_THU` cũ
//      có nhánh `adjustments.none` và `butToanThucThu()` có tập `daBiThayThe`.
//    NAY: `ADJUSTED` ĐÃ BỊ BỎ khỏi `PaymentAccountantStatus`. Bút toán điều chỉnh là dòng
//      `paymentType = "ADJUSTMENT"`, trạng thái vẫn `CONFIRMED`, và nó mang PHẦN CHÊNH
//      LỆCH chứ không mang số đúng. Bản gốc giữ số cũ, cộng cả hai mới ra số đúng.
//    ⇒ LOẠI bản gốc bây giờ là ĐẾM THIẾU đúng phần vừa được sửa — ngược hẳn lỗi cũ.
//    Luật này khai ở `lib/finance/debt.ts` ("KHÔNG lọc theo `paymentType`: bút toán
//    ADJUSTMENT LUÔN được cộng"); file này chỉ đi theo, không được nghĩ khác.
//
//    ⚠️ Con số "thực thu" sẽ ĐỔI so với bản cũ trên nhánh `test`. Đó là hệ quả bắt buộc
//    của việc đổi mô hình, không phải lỗi phép cộng ở đây.
//   • PENDING / REJECTED — chưa/không phải tiền thật.           → bỏ
//
// ⚠️ Số của kế toán và ROAS sẽ TỤT khi bản này lên prod — đó là mức phồng cũ bị gỡ,
// không phải mất doanh thu. Đo trước/sau bằng §B.6.8 trước khi thông báo.
import type { Prisma } from "@prisma/client";
import { nguonGiaoDich } from "./hoa-don/nguon-khoan";

/** Bút toán Payment phẳng — đủ dữ kiện để quyết định nó có được tính hay không. */
export type ThucThuButToan = {
  id: string;
  amount: number;
  /** PaymentAccountantStatus dạng chuỗi (nhận cả string thô từ query select). */
  accountantStatus: string;
  /** Trỏ về bút toán bị điều chỉnh / bị hoàn. */
  adjustmentOfId: string | null;
  /**
   * CHỈ báo cáo DOANH THU mới khai (`coBangChungNganHang(note)`) — xem khối «DOANH THU ≠ THỰC THU» cuối file.
   * Thiếu / `false` ⇒ hành vi cũ nguyên vẹn: hoa hồng, công nợ, nguồn lead không bao giờ khai cờ này.
   */
  coBangChungNganHang?: boolean;
};

/** Trạng thái kế toán tham gia phép tính thực thu (xem khối 🔴 ở đầu file). */
export const TRANG_THAI_THUC_THU = ["CONFIRMED", "REFUNDED"] as const;

/**
 * Mảnh `where` chuẩn cho MỌI query thực thu (`aggregate` / `groupBy` / `findMany`).
 * Đây là bản dịch SQL của đúng luật mà `butToanThucThu()` cài đặt:
 *   - `deletedAt: null`   — bỏ bút toán đã xoá mềm;
 *   - `accountantStatus`  — chỉ hai trạng thái trên.
 * KHÔNG còn nhánh `adjustments.none`, và KHÔNG được lọc `paymentType`: dòng điều chỉnh
 * mang phần chênh lệch nên phải nằm trong phép cộng.
 */
export const WHERE_THUC_THU = {
  deletedAt: null,
  accountantStatus: { in: [...TRANG_THAI_THUC_THU] },
} satisfies Prisma.PaymentWhereInput;

/**
 * THUẦN — lọc ra đúng những bút toán ĐƯỢC TÍNH vào thực thu (giữ nguyên dấu).
 * Dùng cho caller đã có sẵn mảng row (vd. gom theo tháng/ngày). Chạy sau
 * `WHERE_THUC_THU` thì không đổi kết quả — nó là lớp chắn, không phải bước thứ hai.
 */
export function butToanThucThu<T extends ThucThuButToan>(rows: T[]): T[] {
  // KHÔNG còn bước "loại bản gốc đã bị thay thế" — xem khối 🔴 đầu file. Dòng điều chỉnh
  // là DELTA nên bản gốc VẪN phải được cộng; loại nó đi là đếm thiếu.
  const hopLe: readonly string[] = TRANG_THAI_THUC_THU;
  return rows.filter((r) => hopLe.includes(r.accountantStatus) || laTienVeNganHangChuaXacNhan(r));
}

/**
 * THUẦN — dòng này là «tiền ĐÃ vào ngân hàng nhưng kế toán CHƯA xác nhận» (khai cờ `coBangChungNganHang`)?
 * Chỉ dòng thu gốc, còn PENDING, số dương. REJECTED không bao giờ vào (kế toán đã nói tiền đó không hợp lệ); bút toán đảo / điều chỉnh
 * không vào (chúng chỉ có nghĩa khi gốc đã CONFIRMED).
 */
function laTienVeNganHangChuaXacNhan(r: ThucThuButToan): boolean {
  return r.coBangChungNganHang === true && r.accountantStatus === "PENDING" && r.adjustmentOfId === null && r.amount > 0;
}

/** THUẦN — tổng thực thu của một mảng bút toán. */
export function tinhThucThu(rows: ThucThuButToan[]): number {
  return butToanThucThu(rows).reduce((s, r) => s + r.amount, 0);
}

/** Trường tối thiểu phải `select` khi caller muốn tự gom nhóm rồi lọc lại. */
export const SELECT_THUC_THU = {
  id: true,
  amount: true,
  accountantStatus: true,
  adjustmentOfId: true,
} as const;

// ── DOANH THU ≠ THỰC THU (07/11/2026) ─────────────────────────────────────────────────────────────────────────────────────
// Quyết định BGĐ 01–02/11/2026: tiền ĐÃ vào tài khoản ngân hàng (SePay, POS) là đã là DOANH THU; kế toán xác nhận chỉ để đúng quy định.
// `WHERE_THUC_THU` ở trên KHÔNG đổi — nó còn là nền của công nợ, hoa hồng, cổng phụ huynh (AC1: khoản chưa xác nhận không hiện tiền
// cho phụ huynh) và logic gắn nguồn lead, ~30 chỗ. Đổi hằng đó là đổi tiền trả cho nhân viên ở những chỗ chưa được duyệt.
//
// Báo cáo DOANH THU (theo ngày · theo bé · phễu/ROAS) dùng `WHERE_DOANH_THU` + cờ `coBangChungNganHang` ở dưới: ngoài CONFIRMED / REFUNDED
// còn cộng khoản PENDING CÓ BẰNG CHỨNG TIỀN VỀ NGÂN HÀNG. Bằng chứng = marker do HỆ THỐNG ghi, không phải chữ người gõ:
//   · `[auto:<provider>:<mã giao dịch>]`  — webhook cổng thanh toán đẩy tiền vào (loại `[auto:order-…]` là khoản kế hoạch TỰ SINH);
//   · `[gan-tay:<BankTransaction.id>]`    — kế toán gắn giao dịch ngân hàng THẬT vào khoản.
// KHÔNG tính: `[ma-gd:…]` (mã do người gõ khai — chưa phải bằng chứng), tiền mặt Sale tự khai, khoản nhập lịch sử / chuyển nội bộ, bút toán đảo,
// và khoản gốc ĐÃ bị điều chỉnh / tách / đảo bởi một dòng còn sống (số ròng của nó có thể khác, kể cả bằng 0 — xem `WHERE_DOANH_THU`).
// Khoản được kế toán xác nhận sau đó vẫn tính MỘT lần (nhánh CONFIRMED); bị từ chối thì rơi ra (REJECTED không bao giờ vào).
//
// TIỀN CỌC (chủ dự án 07/11/2026): đơn cọc (nút «Thu trước (cọc)») không vào doanh thu cho tới khi trả đủ, rồi vào ĐỦ số tiền theo ngày trả đủ — luật ở
// `lib/finance/doanh-thu-coc.ts`; ba báo cáo doanh thu gọi `dieuKienDoanhThu` ở đó, nó bọc `WHERE_DOANH_THU` này.
//
// ⚠️ GIỚI HẠN ĐÃ BIẾT: marker `[gan-tay:…]` không có khoá ngoại tới `BankTransaction` nên đây là bằng chứng của HỆ THỐNG ghi, không phải phép đối chiếu lại từng
// giao dịch. Khoản đã bị điều chỉnh một phần bị bỏ khỏi doanh thu (đếm THIẾU) thay vì tính theo số ròng.

/** THUẦN — `note` mang bằng chứng tiền về ngân hàng (webhook hoặc gắn tay), dùng ĐÚNG phép phân loại của hoá đơn (`nguonGiaoDich`). */
export function coBangChungNganHang(note: string | null | undefined): boolean {
  const loai = nguonGiaoDich(note).loai;
  return loai === "WEBHOOK" || loai === "GAN_TAY";
}

/**
 * Mảnh `where` cho truy vấn DOANH THU: `WHERE_THUC_THU` HOẶC khoản PENDING có bằng chứng ngân hàng. Bản dịch SQL CỦA `coBangChungNganHang`:
 * `contains` thô nên có thể lọt vài dòng mà hàm thuần loại (vd marker lịch sử) — mọi nơi nạp dòng PHẢI chạy `butToanThucThu` với cờ
 * `coBangChungNganHang: coBangChungNganHang(note)`; nơi chỉ `aggregate` thì chấp nhận phần lệch ở ca ghi chú mang hai marker (đếm THIẾU, không bao giờ thừa).
 * Có khoá `OR` ở tầng trên cùng: nơi nào gộp thêm điều kiện bằng spread phải KHÔNG đặt `OR` riêng (dùng `AND`).
 */
/**
 * NHÁNH «khoản CHỜ xác nhận nhưng tiền ĐÃ về ngân hàng» của `WHERE_DOANH_THU` — tách ra thành hằng để `tu-xac-nhan-ngan-hang.ts` (tự xác nhận, 08/11/2026) dùng
 * CHÍNH định nghĩa này: «khoản nào được tính doanh thu khi chưa xác nhận» và «khoản nào hệ thống tự xác nhận» là MỘT câu hỏi, hai nơi trả lời khác nhau là hai con số nói hai điều.
 * Không có `deletedAt` ở đây — `WHERE_DOANH_THU` đặt nó ở tầng trên cùng; nơi dùng riêng nhánh này PHẢI tự thêm `deletedAt: null`.
 */
export const WHERE_KHOAN_CHO_CO_BANG_CHUNG_NGAN_HANG = {
  accountantStatus: "PENDING",
  adjustmentOfId: null,
  amount: { gt: 0 },
  // CHƯA bị điều chỉnh / tách / đảo / hoàn bởi dòng nào còn sống. Đo prod 07/11: đơn ORD-261004-000007 có khoản gốc 5.016.000đ PENDING bị
  // «đảo để tách khoản» rồi cả hai phần tách cũng bị đảo hết — ròng bằng 0, mà bản gốc dương vẫn mang marker gắn tay. Không có điều kiện này
  // thì tính 10.032.000đ doanh thu đã được đảo sạch. Tính theo số RÒNG của khoản đã điều chỉnh là việc riêng; tới lúc đó đếm THIẾU, không bao giờ thừa.
  adjustments: { none: { deletedAt: null } },
  AND: [
    { OR: [{ note: { contains: "[auto:" } }, { note: { contains: "[gan-tay:" } }] },
    { NOT: { note: { contains: "[auto:order-" } } },
    { NOT: { note: { contains: "[backfill-import]" } } },
    { NOT: { note: { contains: "[sheet:" } } },
    { NOT: { note: { contains: "[chuyen:" } } },
  ],
} satisfies Prisma.PaymentWhereInput;

export const WHERE_DOANH_THU = {
  deletedAt: null,
  OR: [{ accountantStatus: { in: [...TRANG_THAI_THUC_THU] } }, WHERE_KHOAN_CHO_CO_BANG_CHUNG_NGAN_HANG],
} satisfies Prisma.PaymentWhereInput;
