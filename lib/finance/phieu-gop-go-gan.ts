// lib/finance/phieu-gop-go-gan.ts — PHIẾU GỘP SAU KHI GỠ GẮN giao dịch đã trả nó. THUẦN.
//
// Tầng DB: `phieu-gop-go-gan-db.ts` (gọi TRONG transaction của `goGanTheoCon`).
//
// ─────────────────────────────────────────────────────────────────────────────
// NỢ "Phiếu gộp vẫn PAID sau gỡ gắn" — vá 30/09/2026 (docs/pos-the-smartpos.md)
//
// `goGanTheoCon` xoá phân bổ + đảo `Payment` + đưa giao dịch về hàng chờ, nhưng KHÔNG đụng phiếu
// gộp mà giao dịch ấy đã trả. Phiếu ở lại PAID trong khi các đợt của nó đã về PENDING ⇒ khách
// chuyển lại CÙNG mã, ĐÚNG số thì `thuTheoPhieuGop` từ chối "[PHIEU_KHONG_MO] … ĐÃ THU ĐỦ" — câu
// SAI, và là câu mời kế toán HOÀN NHẦM một khoản cho đợt vẫn đang nợ. Áp cho MỌI nguồn (SePay lẫn
// thẻ POS): cả hai trả phiếu gộp qua cùng `thuTheoPhieuGop`.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIẾU NÀO LÀ "PHIẾU GIAO DỊCH NÀY ĐÃ TRẢ" — hai điều kiện, thiếu vế nào cũng sai
//
//   (a) phiếu có ít nhất một dòng trỏ vào đợt VỪA MẤT phân bổ của giao dịch;
//   (b) mã phiếu có trong nhãn "Phiếu gộp <mã> —" của khoản `Payment` VỪA BỊ ĐẢO trong lượt gỡ.
//
// Chỉ (a): đợt có thể nằm trong HAI phiếu PAID (phiếu cũ bị bỏ lại PAID bởi lượt gỡ trước bản vá
// + phiếu mới phát lại), và gỡ một khoản GẮN TAY không phải của phiếu nào cũng thoả (a) — ca
// `[PNS-05]`: mở lại phiếu đã được giao dịch KHÁC trả trọn là đòi tiền lần hai.
// Chỉ (b): nhãn là VĂN BẢN trong một cột ghi chú (tách khoản chép nó sang từng phần, người nhập
// tay gõ được) — (a) bảo đảm phiếu thật sự có dòng vừa mất tiền; thiếu (a), một ghi chú lạc đủ
// để mở lại một phiếu không liên quan.
// Nhãn do `thuTheoPhieuGop` ghi, trong CÙNG transaction đặt phiếu PAID — nên (b) nói đúng "ai trả".
// Hệ quả đã biết: khoản `Payment` của lượt khớp không được ghi (nhánh `trung` của
// `thuTheoPhieuGop` — dữ liệu hỏng, không có đường sinh bình thường) ⇒ không nhận ra phiếu ⇒ phiếu
// giữ PAID như trước bản vá. Không tệ hơn, và không đoán.

/**
 * Nhãn phiếu gộp trong `Payment.note` — nơi DUY NHẤT đánh vần nó. `thuTheoPhieuGop` ghi, lượt
 * gỡ gắn đọc; hai bên lệch một ký tự là gỡ gắn không bao giờ nhận ra phiếu (ca `[PGG-W2]`).
 * Kết thúc bằng " —" để mã này không khớp nhầm tiền tố của mã khác.
 */
export const nhanPhieuGop = (ma: string | null) => `Phiếu gộp ${ma} —`;

export type HanhDongPhieuSauGoGan =
  /** PAID → OPEN: mã cũ thu được đúng số còn phải thu (`conPhaiThuCuaPhieu`). */
  | "MO_LAI"
  /** PAID → CLOSED: không mở lại được mà cũng không được nói "đã thu đủ". */
  | "DONG"
  /** Giữ PAID: các dòng vẫn đủ tiền từ đường khác — phiếu vẫn nói thật. */
  | "GIU";

/**
 * Lọc các phiếu mà CHÍNH giao dịch vừa gỡ đã trả — xem khối chú thích đầu tệp.
 * `phieu` là ứng viên đọc từ DB; hàm vẫn tự lọc `status === "PAID"` để không phụ thuộc câu tra.
 */
export function phieuDoGiaoDichTra<
  P extends { matchKey: string | null; status: string; lines: readonly { paymentRequestId: string }[] },
>(phieu: readonly P[], dotVuaGo: ReadonlySet<string>, ghiChuVuaDao: readonly string[]): P[] {
  return phieu.filter((p) => {
    if (p.status !== "PAID" || !p.matchKey) return false;
    if (!p.lines.some((l) => dotVuaGo.has(l.paymentRequestId))) return false;
    const nhan = nhanPhieuGop(p.matchKey);
    return ghiChuVuaDao.some((n) => n.includes(nhan));
  });
}

/**
 * Quyết phiếu ĐÃ trả (PAID) sẽ ra sao sau khi giao dịch trả nó bị gỡ.
 *
 * Thứ tự vế là một phần của luật:
 *   1. còn phải thu = 0 ⇒ GIỮ — không có gì để thu, "đã thu đủ" vẫn đúng (vd `amountDue` của đợt
 *      đã bị hạ sau lúc phát, tiền đường khác đủ phủ);
 *   1b. có dòng trỏ đợt ĐÃ VOID ⇒ ĐÓNG — cùng cổng 5 `DOT_DANG_MO` của `taoPhieuGop`: phiếu không
 *      được phát trên đợt huỷ thì cũng không được MỞ LẠI trên nó (rà vòng 3, `[V3-02]`);
 *   2. đơn không còn nhận tiền ⇒ ĐÓNG — mở lại là phát lại một QR mà đường khớp sẽ từ chối;
 *   3. đơn ĐÃ có phiếu OPEN khác ⇒ ĐÓNG — `PaymentBill_orderId_open_key` (chỉ mục từng phần)
 *      chặn phiếu mở thứ hai; ghi đè vào đó là ném giữa transaction và CUỘN NGƯỢC CẢ LƯỢT GỠ.
 *      ĐÓNG chứ không giữ PAID: cả hai đều khiến tiền về theo mã cũ KHÔNG tự khớp (an toàn như
 *      nhau), nhưng PAID in lý do "ĐÃ THU ĐỦ" — câu sai mời kế toán hoàn nhầm tiền của một đợt
 *      đang nợ; CLOSED in "ĐÃ ĐÓNG" — câu đúng, buộc người ta tra xem phiếu nào đang mở;
 *   4. còn lại ⇒ MỞ LẠI.
 *   (1c) — rà vòng 4: giao dịch bị gỡ là THẺ đã HOÀN MỘT PHẦN (kể cả cột Hoàn/Hủy lạ, Q-I) ⇒ ĐÓNG.
 *      Số ròng còn nằm ở công ty nhưng vừa rời sổ (giao dịch ra IGNORED); mở lại là phát một QR tự
 *      khớp đòi TRỌN số gộp bằng mã cũ ⇒ thu hai lần (ca `[PNS-11]` `[PNS-11b]`). Phát phiếu mới
 *      sau khi kế toán điều chỉnh số ròng. ⚠️ Từ Q-M vế này chỉ còn quyết LÝ DO ghi nhật ký — (3b) đã
 *      đóng mọi phiếu của nguồn thẻ; xem chú thích tham số `tinHieuThe`.
 *   (3b) — Q-M (chủ dự án chốt 30/09/2026: "luôn ĐÓNG phiếu gộp"): nguồn là THẺ POS ⇒ ĐÓNG, KHÔNG BAO
 *      GIỜ mở lại — kể cả khi CHƯA có tín hiệu hủy/hoàn, kể cả hủy TOÀN PHẦN. File thẻ về trễ ≥ 1 ngày:
 *      mở lại lúc chưa có tín hiệu là để một cửa sổ mà phụ huynh quét mã cũ khớp TRỌN số gộp trong khi
 *      lần quẹt có thể đã bị hoàn một phần (số ròng ngoài sổ ⇒ thu hai lần). Đứng CUỐI (ngay trước MỞ
 *      LẠI) để các lý do trạng thái ở trên vẫn là lý do ghi nhật ký; Q-M chỉ đổi đúng ca lẽ ra mở lại.
 *      Chuyển khoản (SePay/payOS) giữ luật cũ.
 */
export type TinHieuTheSauGo = "HUY_TOAN_PHAN" | "HOAN_MOT_PHAN" | null;

/**
 * NGUỒN tiền của giao dịch vừa gỡ — Q-M quyết theo nó. `THE_POS` = quẹt thẻ SmartPOS (provider CARD_POS),
 * còn lại là chuyển khoản. Tầng thẻ (`giaoDichPosSauGoGanTrongTx`) nói ra nguồn — đường gỡ gắn chung
 * không tự so provider (`[GGP-W2]`).
 */
export type NguonTienGoGan = "THE_POS" | "CHUYEN_KHOAN";

/** Lý do Q-M — nhật ký `PHIEU_GOP_CLOSED` và câu báo cùng đọc. */
export const LY_DO_THE_LUON_DONG =
  "Gỡ gắn giao dịch THẺ POS luôn đóng phiếu (Q-M) — mã cũ không tự khớp nữa; phát mã mới nếu cần thu lại";

/** Lý do vế (1c) — thẻ đã hoàn MỘT PHẦN. */
export const LY_DO_THE_HOAN_MOT_PHAN =
  "Giao dịch thẻ đã hoàn MỘT PHẦN — số ròng chưa vào sổ; đóng phiếu, phát phiếu mới sau khi điều chỉnh";

export function quyetPhieuSauGoGan(x: {
  conPhaiThu: number;
  donNhanTien: boolean;
  coPhieuMoKhac: boolean;
  /**
   * Có dòng nào của phiếu trỏ đợt ĐÃ VOID không. BẮT BUỘC (luật 7): mở lại một phiếu trên đợt đã
   * huỷ là mời khách trả lần hai và rót tiền vào đợt VOID (rà vòng 3, ca `[V3-02]`).
   */
  coDotDaHuy: boolean;
  /**
   * Tín hiệu hủy/hoàn của giao dịch THẺ vừa gỡ (`giaoDichPosSauGoGanTrongTx`) — `null` với chuyển
   * khoản / thẻ không tín hiệu.
   *
   * ⚠️ Sau Q-M (rà vòng 6 sửa chú thích): tham số này KHÔNG còn gác tiền — nó chỉ chọn LÝ DO ghi nhật ký
   * (vế 1c "hoàn MỘT PHẦN" thay cho lý do Q-M). Tín hiệu khác `null` chỉ đi kèm `nguon === "THE_POS"`, mà
   * nguồn thẻ luôn ra ĐÓNG ở vế (3b) ⇒ gỡ vế (1c) hay truyền nhầm `null` đều không đổi `hanhDong`. Luật tiền
   * do `nguon` gác. Vẫn bắt buộc để nhật ký nói đúng lý do.
   */
  tinHieuThe: TinHieuTheSauGo;
  /**
   * Nguồn tiền của giao dịch vừa gỡ — BẮT BUỘC (luật 7): quên truyền là giao dịch THẺ lại mở phiếu đòi
   * trọn số gộp bằng mã cũ, đúng cửa sổ Q-M sinh ra để đóng.
   */
  nguon: NguonTienGoGan;
}): { hanhDong: HanhDongPhieuSauGoGan; lyDo: string } {
  if (!(x.conPhaiThu > 0)) {
    return { hanhDong: "GIU", lyDo: "Các dòng của phiếu vẫn đủ tiền từ đường khác — giữ ĐÃ THU ĐỦ" };
  }
  if (x.tinHieuThe === "HOAN_MOT_PHAN") {
    return { hanhDong: "DONG", lyDo: LY_DO_THE_HOAN_MOT_PHAN };
  }
  if (x.coDotDaHuy) {
    return {
      hanhDong: "DONG",
      lyDo: "Phiếu có đợt đã bị huỷ (vd lập lại kế hoạch trả góp) — đóng phiếu, không mở lại mã",
    };
  }
  if (!x.donNhanTien) {
    return {
      hanhDong: "DONG",
      lyDo: "Đơn không còn nhận tiền (nháp / đã huỷ / đã hoàn / đã xoá) — đóng phiếu, không mở lại mã",
    };
  }
  if (x.coPhieuMoKhac) {
    return {
      hanhDong: "DONG",
      lyDo: "Đơn đã có phiếu gộp khác đang mở — đóng phiếu này; tiền về theo mã cũ sẽ không tự khớp",
    };
  }
  if (x.nguon === "THE_POS") {
    return { hanhDong: "DONG", lyDo: LY_DO_THE_LUON_DONG };
  }
  return { hanhDong: "MO_LAI", lyDo: "Mở lại phiếu — mã cũ thu được đúng số còn phải thu" };
}

/**
 * Phiếu ĐANG MỞ có dòng thuộc đợt vừa mất tiền của lượt gỡ — tiền gắn tay / "Rót vào đơn" lấp đợt của một
 * phiếu đã phát (phiếu 0đ, màn giấu). Nhãn "Phiếu gộp <mã>" không có trên khoản đó nên phiếu không phải ứng
 * viên PAID của `quyetPhieuSauGoGan`; sau lượt gỡ nó HIỆN LẠI đòi tiền — tức là một lần MỞ LẠI.
 *
 * Chuyển khoản ⇒ `null`: để nguyên, phiếu hiện lại đúng số (`[V3-20]`). Thẻ ⇒ ĐÓNG — hoàn một phần là vế
 * (1c) của rà vòng 5 (`[V5-20]`); còn lại là Q-M: phiếu hiện lại cũng là mở lại, nên cũng ĐÓNG. Trước Q-M
 * khối này chỉ chạy khi đã có tín hiệu hoàn một phần — tín hiệu tới SAU lượt gỡ thì phiếu ở lại mở đòi trọn số.
 *
 * ⚠️ Rà vòng 6: "hiện lại đòi tiền" = số phiếu đòi TĂNG qua lượt gỡ (`conPhaiThu > conPhaiThuTruoc`), KHÔNG
 * phải "còn phải thu > 0". Phiếu phát SAU khi gắn tay thẻ một phần chụp dòng = phần còn thiếu lúc phát ⇒ số
 * của thẻ chưa từng nằm trong số nó đòi; gỡ gắn không đổi số phiếu đòi. Đóng nó không chặn được đồng thu
 * trùng nào — chỉ làm khoản đúng mã đúng số của phụ huynh rơi vào hàng chờ (`[PGG-18]` `[V6-M05]`).
 */
export function quyetPhieuMoSauGoGan(x: {
  /** Còn phải thu của phiếu SAU khi phân bổ bị xoá (`conPhaiThuCuaPhieu`). */
  conPhaiThu: number;
  /**
   * Còn phải thu của phiếu TRƯỚC lượt gỡ — CÙNG hàm, trên phân bổ cộng lại phần vừa xoá. BẮT BUỘC (luật 7):
   * thiếu nó là quay về "còn phải thu > 0 ⇒ ĐÓNG" và đóng oan phiếu không đòi thêm đồng nào.
   */
  conPhaiThuTruoc: number;
  nguon: NguonTienGoGan;
  tinHieuThe: TinHieuTheSauGo;
}): { hanhDong: "DONG"; lyDo: string } | null {
  if (!(x.conPhaiThu > x.conPhaiThuTruoc)) return null;
  if (x.tinHieuThe === "HOAN_MOT_PHAN") return { hanhDong: "DONG", lyDo: LY_DO_THE_HOAN_MOT_PHAN };
  if (x.nguon === "THE_POS") return { hanhDong: "DONG", lyDo: LY_DO_THE_LUON_DONG };
  return null;
}
