import "server-only";
// lib/payments/cap-phat-ma.ts — CẤP PHÁT mã phiếu 5 ký tự. Phần chạm DB của `ma-phieu.ts`.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN C · Chủ dự án chốt 20/09/2026
//
//   *"Cấp phát bằng Postgres SEQUENCE, ánh xạ số thứ tự → mã qua hoán vị cố định để hai phiếu
//   liền nhau không giống nhau; thử lại khi đụng unique; cảnh báo cạn kho khi vượt 50%.
//   Mã đã phát hành KHÔNG BAO GIỜ đổi."*
//
// `ma-phieu.ts` giữ phần THUẦN (bảng chữ · checksum · `sinhMa(soThuTu)` · `tinhTrangKhoMa`).
// Tệp này giữ đúng hai thứ nó không giữ được: nguồn số thứ tự, và phép hoán vị.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO PHẢI HOÁN VỊ — KHÔNG PHẢI THẨM MỸ
//
// `sinhMa` ánh xạ số thứ tự sang mã theo cơ số 27, nên **số liền nhau cho mã liền nhau**:
// 0,1,2 → `AAAAx`, `AAACx`, `AAADx`. Ba hệ quả, và hệ quả thứ ba mới là hệ quả đắt:
//
//   1. Sale đọc mã cho phụ huynh qua điện thoại. Hai phiếu phát cách nhau vài phút chỉ khác
//      nhau một ký tự ⇒ đọc nhầm phiếu nhà bên cạnh mà checksum vẫn qua (checksum bắt lỗi
//      SAI MỘT KÝ TỰ khi so với CHÍNH mã đó, nó không biết mã nào là mã đúng của ai).
//   2. Phụ huynh gõ tay, lệch một ký tự ⇒ rơi trúng mã có thật của nhà khác.
//   3. Và chỗ này là chỗ tiền đi sai: mã hợp lệ + số tiền tình cờ bằng còn-phải-thu của phiếu
//      kia ⇒ webhook TỰ ĐỘNG chia tiền nhà A vào phiếu nhà B. Không ai bấm gì, không lỗi nào
//      báo. Hoán vị làm hai phiếu liền nhau cách nhau ~1/4 kho, nên một ký tự lệch không đưa
//      sang phiếu vừa phát.
//
// PHÉP HOÁN VỊ: `x ↦ (K·x + C) mod N`, với `N = DUNG_LUONG = 21 · 27³ = 413.343`.
// Song ánh ⟺ `gcd(K, N) = 1`. `N = 3¹⁰ · 7`, và `K = 104.729` không chia hết cho 3 (tổng chữ
// số 23) cũng không cho 7 (104.729 = 7·14.961 + 2) ⇒ nguyên tố cùng nhau ⇒ song ánh.
// Hai số thứ tự liền nhau cách nhau đúng `K` trong kho, tức ~25% kho — đủ để ký tự ĐẦU nhảy
// 5–6 bậc (`K / 27³ ≈ 5,3`).
//
// ⚠️ `K` và `C` là HẰNG SỐ VĨNH VIỄN. Đổi chúng là đổi mã của mọi số thứ tự chưa cấp — không
// làm hỏng mã ĐÃ phát (mã đã nằm trong DB, không sinh lại), nhưng làm mất tính song ánh giữa
// hai đời: một số thứ tự cũ và một số mới có thể ra cùng một mã, và lúc đó `@unique` là thứ
// duy nhất chặn, bằng một lỗi giữa lượt phát hành QR. Đừng đụng.
//
// ⚠️ Mã KHÔNG phải bí mật: biết mã này đoán được mã kế tiếp. Chấp nhận được vì mã chỉ nói
// "phiếu nào", không cấp quyền gì — đoán trúng mã người khác cũng chỉ là chuyển tiền HỘ họ.
// Ngày nào mã mang quyền thì phải đổi sang hoán vị có khoá (Feistel), không phải nhân modulo.

import type { Prisma } from "@prisma/client";
import { DUNG_LUONG, sinhMa, tinhTrangKhoMa, type TinhTrangKho } from "./ma-phieu";

type Tx = Prisma.TransactionClient;

/** Tên sequence — khai ở `20260920120000_payment_bill_ma_seq`. */
export const TEN_SEQUENCE = "payment_bill_ma_seq";

/** Hệ số nhân của hoán vị. Nguyên tố cùng nhau với `DUNG_LUONG`. VĨNH VIỄN. */
export const HOAN_VI_K = 104_729;
/** Độ dịch của hoán vị — để số thứ tự 0 không ra mã đầu bảng. VĨNH VIỄN. */
export const HOAN_VI_C = 31_337;

/**
 * Số thứ tự → vị trí trong kho mã. Song ánh trên `[0, DUNG_LUONG)`.
 *
 * ⚠️ `K · x` lớn nhất ≈ 4,33·10¹⁰ — vẫn dưới `Number.MAX_SAFE_INTEGER` (9,0·10¹⁵) nên phép
 * nhân KHÔNG mất chính xác. Ca `[CPM-03]` khẳng định lại điều đó bằng số, đừng gỡ.
 */
export function hoanViSoThuTu(soThuTu: number): number {
  const n = Number.isFinite(soThuTu) ? Math.trunc(soThuTu) : -1;
  if (n < 0 || n >= DUNG_LUONG) {
    throw new RangeError(`Số thứ tự ngoài kho: ${soThuTu} (kho ${DUNG_LUONG})`);
  }
  return (HOAN_VI_K * n + HOAN_VI_C) % DUNG_LUONG;
}

/**
 * Lấy MỘT số thứ tự mới từ sequence. Không bao giờ trả lại cùng một số.
 *
 * ⚠️ `nextval` trả từ **1**, `sinhMa` nhận từ **0** — phép trừ 1 nằm ở ĐÂY và chỉ ở đây.
 * Trừ thêm lần nữa ở chỗ gọi là cấp trùng số thứ tự đầu tiên.
 *
 * ⚠️ `$queryRaw`, KHÔNG `$executeRaw`: `nextval()` TRẢ VỀ giá trị, và `$executeRaw` chỉ đưa
 * số dòng. (Ngược với `pg_advisory_xact_lock()` — hàm đó trả `void` nên phải `$executeRaw`.
 * Hai hàm, hai chiều, cùng một cái bẫy.)
 */
export async function capPhatSoThuTu(tx: Tx): Promise<number> {
  const rows = await tx.$queryRaw<
    { n: bigint }[]
  >`SELECT nextval(${TEN_SEQUENCE}::regclass) AS n`;
  const raw = rows[0]?.n;
  if (raw == null) throw new Error(`Không lấy được số thứ tự từ sequence ${TEN_SEQUENCE}`);
  return Number(raw) - 1;
}

export type MaDaCap = {
  ma: string;
  /** Số thứ tự thô (0-based) — ghi vào nhật ký để tra ngược khi cần. */
  soThuTu: number;
  /** Tình trạng kho tại thời điểm cấp. `canhBao = true` khi đã dùng ≥ 50%. */
  kho: TinhTrangKho;
};

/**
 * Cấp một mã phiếu mới.
 *
 * ⚠️ KHÔNG ghi gì vào `PaymentBill` — việc chèn (và bắt `@unique`) là của người gọi. Tách như
 * vậy vì người gọi mới biết phải chèn cái gì, và vì vòng THỬ LẠI phải bọc CẢ phép chèn: đụng
 * unique nghĩa là mã ấy đã nằm trên một phiếu, nên phải xin số MỚI rồi chèn LẠI, không phải
 * chèn lại cùng một mã.
 *
 * Cạn kho: `sinhMa` ném `RangeError` khi số thứ tự vượt kho. Để nó ném — đúng chỗ, đúng lúc.
 * Còn `kho.canhBao` là lời nhắc SỚM (từ 50%) để người vận hành kịp xử, không phải điều kiện
 * chặn: một phụ huynh không quét được QR vì kho mã sắp đầy là đánh đổi sai.
 */
export async function capPhatMaPhieu(tx: Tx): Promise<MaDaCap> {
  const soThuTu = await capPhatSoThuTu(tx);
  return {
    ma: sinhMa(hoanViSoThuTu(soThuTu)),
    soThuTu,
    // `daCap` = số đã lấy ra khỏi sequence = soThuTu + 1 (vì soThuTu là 0-based).
    kho: tinhTrangKhoMa(soThuTu + 1),
  };
}
