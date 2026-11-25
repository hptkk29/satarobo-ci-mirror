// lib/entitlements/tien-xac-nhan.ts — "TIỀN ĐÃ XÁC NHẬN" CỦA TỪNG DÒNG ĐƠN, để cấp quyền học. THUẦN: không DB, không đồng hồ.
//
// Một câu hỏi duy nhất: trên sổ `Payment` của một đơn, mỗi dòng hàng đã có bao nhiêu đồng TIỀN THẬT được xác nhận.
// Con số này đi vào `dongDuTien` (cả hai trục `daVe` và `daThu` đều nhận nó — xem `docs/thu-hoc-phi-pham-vi/CAP-QUYEN-TU-TIEN.md`).
//
// ── ĐỊNH NGHĨA (chủ dự án chốt Q2 + Q3, 11/10/2026) ─────────────────────────────────────────────────────────────
// Một khoản gốc CÓ TÍNH khi:
//   (b) kế toán/QLCS đã xác nhận (`accountantStatus = CONFIRMED`) — tiền mặt, ghi tay, và cả tiền ngân hàng đã đối soát; HOẶC
//   (a) tiền ngân hàng đã được HỆ THỐNG đối khớp (webhook, phiếu gộp, thẻ POS, kế toán gắn tay một giao dịch) dù kế toán chưa bấm
//       xác nhận — VÀ marker trong `note` được MỘT GIAO DỊCH NGÂN HÀNG THẬT chống lưng (xem dưới).
// KHÔNG tính: PENDING mà không có marker ngân hàng (tiền mặt Sale vừa gõ, lời khai `[auto:order-confirm]`, nhập lịch sử);
//   PENDING có marker mà không có giao dịch ngân hàng thật chống lưng; REJECTED (kế toán đã từ chối).
// TRỪ RA: dòng đảo/hoàn trỏ về khoản gốc (`adjustmentOfId`) trừ vào CHÍNH khoản gốc đó; dòng âm mồ côi (chuyển nội bộ ra) trừ thẳng.
//
// ── MARKER KHÔNG PHẢI CHỨNG CHỈ ──────────────────────────────────────────────────────────────────────────────────
// `Payment.note` là chuỗi tự do: Sale ghi tiền mặt (`recordPayment`, `note` tới 1000 ký tự) có thể gõ `[auto:sepay:xyz]`. Nếu chỉ đọc
// text thì khoản đó tính ngay không qua kế toán — phá Q3. Nên một khoản PENDING chỉ tính khi:
//   · có `BankTransaction` MATCHED mà marker trỏ tới (webhook: provider + providerTxnId; gắn tay: id bảng), và
//   · giao dịch đó có phân bổ (`PaymentAllocation`) vào một phiếu thu CỦA ĐƠN NÀY — người gọi gom thành `nganHangThat`
//     (khoá → Σ tiền đã phân bổ vào đơn này), và
//   · TỔNG các khoản (còn sống, sau đảo) mang cùng marker KHÔNG vượt số đã phân bổ — chặn nhân đôi cùng một giao dịch thật
//     bằng nhiều dòng giả.
// Dòng tách khoản (`[tach:…]`) chép marker của gốc nên vẫn qua: gốc đã bị đảo (net 0) còn các phần mới cộng lại đúng bằng gốc.
//
// ── VÌ SAO ĐỌC MỘT SỔ (`Payment`) CHỨ KHÔNG CỘNG `PaymentAllocation` VỚI `Payment` ───────────────────────────────
// Webhook và phiếu gộp ghi CẢ HAI: một dòng `PaymentAllocation` (sổ phân bổ) VÀ một dòng `Payment` PENDING mang marker ngân hàng.
// Khi kế toán xác nhận, dòng `Payment` đó thành CONFIRMED. Cộng (allocation) + (Payment CONFIRMED) là đếm MỘT đồng HAI lần — đúng
// lúc quyết định cấp quyền học. Nên đọc sổ `Payment`; allocation chỉ dùng để CHỨNG THỰC marker, không bao giờ cộng thêm.
//
// ── GẮN TIỀN VÀO DÒNG ─────────────────────────────────────────────────────────────────────────────────────────
//   1. `orderItemId` của khoản gốc;
//   2. đơn có ĐÚNG MỘT dòng hàng thì mọi khoản gốc chưa gắn thuộc dòng đó (cùng luật `dongDuyNhat` của `allocateToOrder`);
//   3. còn lại (đơn nhiều dòng, khoản không gắn dòng nào) → `chuaGanDong`. KHÔNG đoán.
// Dòng đảo/hoàn KHÔNG tự gắn dòng: nó theo khoản gốc (`refundPayment` không chép `orderItemId`, nên đọc nó là sai).
import { nguonGiaoDich } from "@/lib/finance/hoa-don/nguon-khoan";

/** Một dòng `Payment` đã nạp (chưa xoá mềm). Người gọi tính sẵn `daXacNhan` bằng `laKhoanDaXacNhan` — không chép lại điều kiện ở đây. */
export interface KhoanTien {
  readonly id: string;
  readonly orderItemId: string | null;
  readonly amount: number;
  readonly adjustmentOfId: string | null;
  /** `Payment.accountantStatus`. */
  readonly accountantStatus: string;
  /** `laKhoanDaXacNhan(p)` (lib/finance/debt.ts): CONFIRMED và chưa xoá mềm. */
  readonly daXacNhan: boolean;
  readonly note: string | null;
}

/** Khoá giao dịch ngân hàng → Σ tiền giao dịch MATCHED đó đã phân bổ vào các phiếu thu CỦA ĐƠN NÀY. Thiếu khoá = không có giao dịch thật. */
export type NganHangThat = ReadonlyMap<string, number>;

export interface KetQuaTienXacNhan {
  /** Mỗi dòng trong `dongIds` đều có mặt. Người gọi tự kẹp ≥ 0. */
  readonly theoDong: ReadonlyMap<string, number>;
  /** Tổng ròng các khoản KHÔNG gắn được dòng nào (đơn nhiều dòng). `0` = không có gì mơ hồ. */
  readonly chuaGanDong: number;
}

/** Khoá nhận ra MỘT giao dịch ngân hàng từ marker trong `note`; `null` = note không mang marker ngân hàng. */
export function khoaNganHangTuNote(note: string | null): string | null {
  const n = nguonGiaoDich(note);
  if (n.loai === "WEBHOOK") return `${n.provider.toLowerCase()}|${n.providerTxnId}`;
  if (n.loai === "GAN_TAY") return `gan-tay|${n.bankTransactionId}`;
  return null;
}

/** Hai khoá (webhook/phiếu gộp/POS và gắn tay) mà MỘT `BankTransaction` có thể được marker nhắc tới. */
export function khoaNganHangCuaGiaoDich(g: { readonly id: string; readonly provider: string; readonly providerTxnId: string }): readonly string[] {
  return [`${g.provider.toLowerCase()}|${g.providerTxnId}`, `gan-tay|${g.id}`];
}

export function tienXacNhanTheoDong(input: {
  readonly dongIds: readonly string[];
  readonly khoan: readonly KhoanTien[];
  /** BẮT BUỘC, không mặc định (luật 7): mặc định rỗng sẽ lặng lẽ loại mọi tiền ngân hàng; mặc định "tin marker" thì cho phép giả mạo. */
  readonly nganHangThat: NganHangThat;
}): KetQuaTienXacNhan {
  const theoId = new Map(input.khoan.map((k) => [k.id, k]));
  const dieuChinh = new Map<string, KhoanTien[]>();
  const goc: KhoanTien[] = [];
  for (const k of input.khoan) {
    // REJECTED = không có hiệu lực (gốc lẫn dòng đảo). Số tiền không nguyên = dữ liệu hỏng, không đoán.
    if (k.accountantStatus === "REJECTED" || !Number.isInteger(k.amount)) continue;
    if (k.amount < 0 && k.adjustmentOfId !== null && theoId.has(k.adjustmentOfId)) {
      const ds = dieuChinh.get(k.adjustmentOfId) ?? [];
      ds.push(k);
      dieuChinh.set(k.adjustmentOfId, ds);
    } else goc.push(k);
  }
  /** Số ròng của khoản gốc sau mọi dòng đảo/hoàn trỏ vào nó. */
  const rong = (k: KhoanTien): number => k.amount + (dieuChinh.get(k.id) ?? []).reduce((s, d) => s + d.amount, 0);

  // Tổng ròng các khoản gốc DƯƠNG theo từng giao dịch ngân hàng — kể cả khoản đã CONFIRMED (kế toán xác nhận một khoản thật rồi
  // một dòng PENDING giả mượn cùng marker vẫn phải bị đếm vào tổng).
  const tongTheoKhoa = new Map<string, number>();
  for (const k of goc) {
    if (k.amount < 0) continue;
    const khoa = khoaNganHangTuNote(k.note);
    if (khoa !== null) tongTheoKhoa.set(khoa, (tongTheoKhoa.get(khoa) ?? 0) + Math.max(0, rong(k)));
  }
  const nganHangChongLung = (khoa: string): boolean => {
    const thuc = input.nganHangThat.get(khoa);
    return thuc !== undefined && (tongTheoKhoa.get(khoa) ?? 0) <= thuc;
  };

  const theoDong = new Map<string, number>(input.dongIds.map((id) => [id, 0]));
  const dongDuyNhat = input.dongIds.length === 1 ? (input.dongIds[0] ?? null) : null;
  let chuaGanDong = 0;
  for (const k of goc) {
    let dongGop: number;
    if (k.amount < 0) {
      dongGop = k.amount; // dòng âm mồ côi (chuyển nội bộ ra): luôn trừ
    } else {
      const khoa = khoaNganHangTuNote(k.note);
      const coTinh = k.daXacNhan || (k.accountantStatus === "PENDING" && khoa !== null && nganHangChongLung(khoa));
      dongGop = coTinh ? Math.max(0, rong(k)) : 0;
    }
    if (dongGop === 0) continue;
    // Con trỏ tới dòng KHÔNG thuộc đơn này là dữ liệu hỏng, không phải "chưa gắn": không đoán.
    const dich = k.orderItemId === null ? dongDuyNhat : theoDong.has(k.orderItemId) ? k.orderItemId : null;
    if (dich === null) chuaGanDong += dongGop;
    else theoDong.set(dich, (theoDong.get(dich) ?? 0) + dongGop);
  }
  return { theoDong, chuaGanDong };
}
