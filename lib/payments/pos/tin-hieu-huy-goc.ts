// lib/payments/pos/tin-hieu-huy-goc.ts — GIAO DỊCH THẺ GỐC ĐÃ BỊ HỦY / HOÀN TỚI ĐÂU. THUẦN.
//
// Hai lượt phải trả lời CÙNG một câu, và phải trả lời GIỐNG NHAU:
//   · ĐÓNG cảnh báo (`dong-canh-bao-pos.ts`) — đưa giao dịch gốc đã gỡ gắn ra khỏi hàng chờ;
//   · GỠ GẮN (`go-gan-pos.ts`, gọi TRONG transaction của `goGanTheoCon`) — nợ 30/09/2026:
//     gỡ gắn giao dịch thẻ đã bị hủy/hoàn thì số GỘP phải ra khỏi hàng chờ NGAY, không chờ
//     lượt import sau.
// Hai bản luật ở hai tệp là hai thứ tự thao tác ("gỡ rồi đóng" / "đóng rồi gỡ" — Q-H cho đóng tự
// do) cho ra hai trạng thái cuối. Nên luật nằm ở đây, MỘT chỗ; hai tầng DB chỉ đọc dòng rồi hỏi.
//
// Tín hiệu đọc từ DỮ LIỆU (dòng hủy/hoàn đã lưu + cột của gốc + lý do chặn), KHÔNG đọc cờ cảnh
// báo: cảnh báo đóng hay mở không đổi được việc ngân hàng đã trả tiền về thẻ.
import type { DongHuyPos } from "./kieu";
import {
  CTX_XET_HUY,
  DUOI_CHAN_HOAN_MOT_PHAN,
  dongTuBanGhi,
  laHuyToanPhanVoiGoc,
  phanLoaiDongPos,
  tinHieuHoanHuy,
} from "./phan-loai-pos";

export type TinHieuHuyGoc = {
  /**
   * Gốc đã bị hủy/hoàn TOÀN PHẦN — không còn đồng nào của lần quẹt ở lại. Hai nguồn:
   *   · một dòng Hủy/Hoàn "Thành công", chữ nói toàn phần VÀ đúng số gốc (`laHuyToanPhanVoiGoc`)
   *     trỏ vào gốc ⇒ `maHuy` = mã dòng ĐẦU TIÊN theo thứ tự người gọi đưa vào;
   *   · cột `Trạng thái Hoàn/Hủy` của CHÍNH gốc nói toàn phần (luật 3) ⇒ `maHuy: null`.
   * `null` = không có tín hiệu toàn phần.
   */
  toanPhan: { maHuy: string | null } | null;
  /**
   * Có tín hiệu MỘT PHẦN (Q-G 30/09/2026 "chặn tự động"): dòng hủy/hoàn lệch số gốc hoặc chữ nói
   * một phần · cột của gốc nói "một phần" hoặc mang giá trị lạ (fail-closed) · gốc vốn đã bị chặn
   * vì hoàn một phần (lý do mang `DUOI_CHAN_HOAN_MOT_PHAN`).
   *
   * Có thể `true` CÙNG LÚC với `toanPhan` (hoàn nhiều lần cộng thành toàn phần) — người gọi
   * quyết thứ tự ưu tiên, thường là toàn phần thắng: không còn tiền nào để ghi.
   */
  motPhan: boolean;
};

/** Lý do khi CHỈ cột `Trạng thái Hoàn/Hủy` của gốc nói toàn phần (chưa thấy dòng hủy nào). */
export const LY_DO_HUY_TOAN_PHAN_THEO_COT = "Đã bị hủy/hoàn toàn phần (theo cột Trạng thái Hoàn/Hủy)";

/** Ghi chú trên `BankTransaction.unmatchedNote` khi giao dịch gốc ra khỏi hàng chờ vì hủy toàn phần. */
export function ghiChuGiaoDichHuyToanPhan(maHuy: string | null): string {
  return maHuy ? `Đã bị hủy bởi giao dịch thẻ ${maHuy}` : LY_DO_HUY_TOAN_PHAN_THEO_COT;
}

/** Lý do trên DÒNG POS gốc (`matchReason`) khi nó bị kết luận vì hủy toàn phần. */
export function lyDoGocHuyToanPhan(maHuy: string | null): string {
  return maHuy ? `Đã bị hủy bởi ${maHuy}` : LY_DO_HUY_TOAN_PHAN_THEO_COT;
}

/** Nối lý do mới vào lý do cũ, không lặp — cùng luật với tầng nhập lô. */
export function noiLyDoPos(cu: string | null, moi: string): string {
  return !cu ? moi : cu.includes(moi) ? cu : `${cu} · ${moi}`;
}

/**
 * Đọc tín hiệu hủy/hoàn của một giao dịch GỐC từ các dòng trỏ vào nó (`maGiaoDichGoc`) + chính
 * nó. Mỗi dòng trỏ vào đi qua `phanLoaiDongPos` (luật 1: chỉ dòng "Thành công" mới là hủy —
 * dòng Hủy "Thất bại" không làm gốc bị bỏ qua, ca `[POS-DB-14]`).
 */
export function tinHieuHuyCuaGoc(input: {
  goc: { soTien: number; trangThaiHoanHuy: string | null; matchReason: string | null };
  dongTroVao: readonly DongHuyPos[];
}): TinHieuHuyGoc {
  let maHuyToanPhan: string | undefined;
  let dongMotPhan = false;
  for (const r of input.dongTroVao) {
    const p = phanLoaiDongPos(dongTuBanGhi(r), CTX_XET_HUY);
    if (p.loai !== "HUY") continue;
    if (laHuyToanPhanVoiGoc(p, r.soTien, input.goc.soTien)) maHuyToanPhan ??= r.maGiaoDich;
    else dongMotPhan = true;
  }
  const cot = tinHieuHoanHuy(input.goc.trangThaiHoanHuy);
  return {
    toanPhan:
      maHuyToanPhan !== undefined ? { maHuy: maHuyToanPhan } : cot === "TOAN_PHAN" ? { maHuy: null } : null,
    motPhan:
      dongMotPhan || cot === "MOT_PHAN" || (input.goc.matchReason ?? "").includes(DUOI_CHAN_HOAN_MOT_PHAN),
  };
}
