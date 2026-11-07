// lib/payments/kenh-thu.ts — HAI Ô của một dòng đợt (QR chuyển khoản · Thẻ POS) + "đang xem kênh nào" +
// cảnh báo hai kênh + nút Huỷ phiếu. THUẦN. Hai nút QR / Thẻ POS chung một mã (09/10/2026).
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §1.3-1.6. Component `payment-requests-section.tsx` KHÔNG tự viết điều
// kiện nào của mấy thứ này (đặc tả 8) — nó gọi hàm ở đây rồi vẽ đúng thứ hàm trả.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỒN TẠI
//
// Trước bản này màn đơn vẽ panel QR của phiếu gộp MỖI KHI có phiếu gộp (`{phieuGop && <PhieuGopQr/>}`). Mà bấm
// "Thẻ POS" cũng đẻ ra phiếu gộp (mã 5 ký tự là một cho cả hai đường — `moPhieuPos` dùng lại / phát phiếu 1 dòng),
// nên bấm Thẻ là bung luôn ảnh QR + "Nội dung CK": khách đứng quầy thấy hai cách trả cho một khoản. Còn dòng đợt
// ở trạng thái "mã của đợt này" chỉ in chữ `Mã WT9GX`, không còn nút QR.
//
// Luật 12 (affordance nói thật) đi xuyên suốt: ô nào máy chủ chắc chắn từ chối thì không vẽ nút mà nói vì sao.
//
// ⚠️ RÀ ĐỐI KHÁNG (09/10/2026): ô dòng đi theo SỰ THẬT MÁY CHỦ `theDangMo` (cùng nguồn với cổng huỷ và panel QR), KHÔNG
// theo `phieuPos` — phiếu thẻ bỏ dở ≥ 30 phút rời màn sale (U9) mà cổng huỷ vẫn khoá; lấy `phieuPos` thì dòng nói
// "Thẻ POS" (như chưa có thẻ) trong khi nút Huỷ nói "Đang chờ quẹt thẻ". Và người không có `payments:pos-check`
// không nạp được `phieuPos` nhưng vẫn phải nghe sự thật.
import { chuDotKhacDangGiu, loiDotKhacDangGiu, trangThaiQrDot, type DongPhieuMo, type TrangThaiQrDot } from "./qr-theo-dot";
import { kieuPhieuPosDangMo, nutThuThe, type NutThuThe, type PhieuPosChoNut } from "./pos/nut-thu-the";
import { LOI_HUY_KHI_CHUA_KET_LUAN, LOI_HUY_KHI_THE_CHO_KE_TOAN, type PhieuPosView, type TheDangMo } from "./pos/phieu-pos-luat";
import {
  CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CHUA_BIET,
  CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CO_NUT,
  CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_KHONG_QUYEN,
  cauChanHuyPhieuGopVuongPhieuThe,
  ghepCauTuChoiHuy,
} from "./pos/huy-phieu-the-cau";

// ─────────────────────────────────────────────────────────────────────────────
// 1 · HAI Ô CỦA MỘT DÒNG ĐỢT
// ─────────────────────────────────────────────────────────────────────────────

/** Ô QR chuyển khoản của một dòng đợt vẽ gì. */
export type OQr =
  /** Không ô nào ("—"): không có quyền phát phiếu, đợt đã đủ / đã huỷ, hoặc đợt không còn thiếu đồng nào (sale đã thu tay). */
  | { kieu: "AN" }
  /** Cờ TẮT — đường `QrSession` đời cũ, component giữ nguyên nút cũ (Xuất QR / Xem QR / Ẩn QR). */
  | { kieu: "CU" }
  /**
   * Chưa có phiếu gộp — bấm là phát phiếu 1 dòng cho đúng đợt. `lyDoKhoa` ≠ null ⇒ nút bị khoá, `title` = câu của cổng
   * duyệt. `dangBan` ⇒ một nút tạo mã (của dòng này HOẶC dòng khác) đang chạy: mỗi đơn chỉ một mã sống, bấm chồng là va nhau.
   */
  | { kieu: "XUAT"; lyDoKhoa: string | null; dangBan: boolean }
  /** Phiếu gộp đang mở CHỨA đợt này — nút "QR · MÃ5": bật/tắt panel QR của mã đó. KHÔNG phát gì. */
  | { kieu: "MA" }
  /**
   * Phiếu gộp đang mở là của đợt KHÁC — không nút, nói ai đang giữ mã (luật 12: nút chắc chắn bị DB từ chối là lời hứa
   * suông). `chu` = nhãn in trên dòng; `cau` = câu giải thích (`title`). Cả hai nói về thẻ khi phiếu đang giữ có thẻ mở.
   */
  | { kieu: "DOT_KHAC"; nhanDotDangGiu: string; chu: string; cau: string };

/**
 * Ô Thẻ của một dòng đợt. Phần lớn là `NutThuThe` (`nutThuThe`) — khác ở bốn chỗ:
 *   · `TAO` mang `dangBan` (khoá khi một nút tạo mã đang chạy);
 *   · `DOT_KHAC` mang sẵn `chu`/`cau` (cùng nguồn với ô QR);
 *   · `CHUA_KET_LUAN` — thẻ quá hạn mà lượt kiểm gần nhất chưa kết luận: nút "Thẻ · chưa rõ" mở hộp để bấm Kiểm tra;
 *   · `CHI_BAO` — người KHÔNG có `payments:pos-check` mà phiếu gộp có thẻ mở: một NHÃN CHỮ (không nút, không cấp
 *     năng lực — T16) để họ khỏi tưởng "chưa có thẻ nào".
 */
export type OThe =
  | Exclude<NutThuThe, { kieu: "TAO" | "DOT_KHAC" }>
  | { kieu: "TAO"; dangBan: boolean }
  | { kieu: "DOT_KHAC"; nhanDotDangGiu: string; chu: string; cau: string }
  | { kieu: "CHUA_KET_LUAN" }
  | { kieu: "CHI_BAO"; the: TheDangMo };

export type KenhCuaDong = { qr: OQr; the: OThe };

export type DauVaoKenhCuaDong = {
  /** `payments:record` — quyền mà `taoPhieuGopAction` THẬT SỰ hỏi. */
  duocPhatPhieu: boolean;
  /** `payments:pos-check`. ⚠️ Chỉ quyết ô THẺ; KHÔNG được ảnh hưởng ô QR (đối chứng dương `[HN1-08]`). */
  duocThuThePos: boolean;
  /** `billing.flexV1Enabled` của CƠ SỞ GIỮ ĐƠN. */
  bat: boolean;
  /** Dòng của phiếu gộp ĐANG MỞ; `null` = không có phiếu nào. */
  dongPhieuMo: readonly DongPhieuMo[] | null;
  paymentRequestId: string;
  rowStatus: "PENDING" | "PARTIAL" | "PAID" | "VOID";
  /** Còn thiếu của dòng, đọc CẢ HAI SỔ (đợt sale thu tay = 0). */
  conThieu: number;
  lyDoChuaDuyet: string | null;
  /** Số máy POS đang bật của cơ sở giữ đơn. */
  soMay: number;
  /** Phiếu thẻ đang lên màn (một phiếu), hoặc `null`. */
  phieuPos: PhieuPosChoNut | null;
  /**
   * SỰ THẬT MÁY CHỦ: phiếu gộp đang mở có thẻ mở không (`PhieuGopView.theDangMo`). BẮT BUỘC (luật 7). Nguồn của ô Thẻ
   * khi `phieuPos` không nói được (phiếu rời màn · người không có `pos-check`) — cùng nguồn với cổng huỷ.
   */
  theDangMo: TheDangMo | null;
  /** Một nút TẠO MÃ của đơn này đang chạy (bất kỳ dòng nào). BẮT BUỘC (luật 7): quên truyền = hai nút bấm chồng được. */
  dangBan: boolean;
};

/**
 * Hai ô của MỘT dòng đợt, quyết ở MỘT chỗ.
 *
 * ⚠️ Ô QR đi theo `duocPhatPhieu` + trạng thái phiếu gộp — KHÔNG đi theo `duocThuThePos`. Người chỉ có
 * `payments:record` (CENTER_ACCOUNTANT, T16) vẫn đứng quầy và vẫn phải thấy nút QR. Gác ô QR bằng quyền thẻ là
 * lỗi CÂM: không lỗi biên dịch, không ca nào của người có quyền thẻ đỏ.
 *
 * ⚠️ Nút "Xuất QR" (phát mã MỚI) chỉ vẽ khi dòng CÒN THIẾU tiền (`conThieu > 0`) — đợt sale đã thu tay thì phát mã là mời
 * khách trả lần hai (rà đối kháng 09/10/2026, V9 đảo). Nút "QR · MÃ5" của phiếu ĐÃ mở thì giữ kể cả khi `conThieu = 0`:
 * nó là đường duy nhất tới nút Huỷ phiếu khi panel bị ẩn mặc định (có thẻ mở).
 */
export function kenhCuaDong(v: DauVaoKenhCuaDong): KenhCuaDong {
  const tt = trangThaiQrDot({ bat: v.bat, dongPhieuMo: v.dongPhieuMo, paymentRequestId: v.paymentRequestId });
  const nut = nutThuThe({
    duocThuThePos: v.duocThuThePos,
    bat: v.bat,
    tt,
    paymentRequestId: v.paymentRequestId,
    rowStatus: v.rowStatus,
    conThieu: v.conThieu,
    lyDoChuaDuyet: v.lyDoChuaDuyet,
    soMay: v.soMay,
    phieuPos: v.phieuPos,
  });
  const duocPhat = v.duocPhatPhieu && v.rowStatus !== "PAID" && v.rowStatus !== "VOID";
  const qr = oQr(duocPhat, tt, v.lyDoChuaDuyet, v.conThieu > 0, v.dangBan, v.theDangMo);
  const the = oThe(nut, v, tt);
  // "Mã đang mở cho Đợt X" in ĐÚNG MỘT LẦN: ô QR đã nói thì ô Thẻ im (người không có quyền phát phiếu thì ô QR
  // không in gì, và ô Thẻ mới là chỗ nói).
  return { qr, the: qr.kieu === "DOT_KHAC" && the.kieu === "DOT_KHAC" ? { kieu: "AN" } : the };
}

function oQr(
  duocPhat: boolean,
  tt: TrangThaiQrDot,
  lyDoChuaDuyet: string | null,
  conThieu: boolean,
  dangBan: boolean,
  theDangMo: TheDangMo | null,
): OQr {
  if (!duocPhat) return { kieu: "AN" };
  switch (tt.kieu) {
    case "CU":
      return { kieu: "CU" };
    case "MOI_CUA_DOT_KHAC":
      return { kieu: "DOT_KHAC", ...dotKhac(tt.nhanDotDangGiu, theDangMo) };
    case "MOI_CHUA_PHAT":
      return conThieu ? { kieu: "XUAT", lyDoKhoa: lyDoChuaDuyet, dangBan } : { kieu: "AN" };
    case "MOI_CUA_DOT_NAY":
      return { kieu: "MA" };
  }
}

function oThe(nut: NutThuThe, v: DauVaoKenhCuaDong, tt: TrangThaiQrDot): OThe {
  // Phiếu gộp đang mở CHỨA dòng này, còn thu, cờ bật, và MÁY CHỦ nói có thẻ đang mở ⇒ ô Thẻ nói đúng điều đó, bất kể
  // `phieuPos` (đã rời màn / người xem không nạp được). Dòng của đợt khác, đợt đã đủ, cờ tắt: không đổi.
  if (v.bat && tt.kieu === "MOI_CUA_DOT_NAY" && v.theDangMo !== null && v.rowStatus !== "PAID" && v.rowStatus !== "VOID") {
    if (!v.duocThuThePos) return { kieu: "CHI_BAO", the: v.theDangMo };
    if (nut.kieu !== "DANG_CHO" && nut.kieu !== "CHO_KE_TOAN") {
      return v.theDangMo === "CHO_KE_TOAN"
        ? { kieu: "CHO_KE_TOAN" }
        : v.theDangMo === "CHUA_KET_LUAN"
          ? { kieu: "CHUA_KET_LUAN" }
          : { kieu: "DANG_CHO" };
    }
    return nut;
  }
  if (nut.kieu === "TAO") return { kieu: "TAO", dangBan: v.dangBan };
  if (nut.kieu === "DOT_KHAC") return { kieu: "DOT_KHAC", ...dotKhac(nut.nhanDotDangGiu, v.theDangMo) };
  return nut;
}

/** Nhãn + câu của "đợt khác giữ mã" — dựng ở MỘT chỗ cho cả hai ô (QR · Thẻ), cùng nguồn `theDangMo`. */
function dotKhac(nhanDotDangGiu: string, theDangMo: TheDangMo | null) {
  return {
    nhanDotDangGiu,
    chu: chuDotKhacDangGiu(nhanDotDangGiu, theDangMo),
    cau: loiDotKhacDangGiu(nhanDotDangGiu, theDangMo),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · "ĐANG XEM KÊNH NÀO" — state client của section, KHÔNG lưu DB
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lựa chọn của người dùng, GẮN VỚI MỘT MÃ (`billId`): huỷ phiếu rồi phát lại mã mới thì lựa chọn cũ không còn nghĩa.
 * `daMo` = QR của mã này ĐÃ TỪNG hiện trong phiên làm việc (kể cả hiện sẵn lúc tải trang) — nguồn của cảnh báo hai
 * kênh trong hộp thẻ (TỰ QUYẾT V15).
 */
export type DieuKhienQr = { billId: string; hien: boolean; daMo: boolean };

/**
 * Panel QR của phiếu gộp có hiện không, và QR của mã này đã từng hiện chưa.
 *
 * MẶC ĐỊNH (khi người dùng chưa chọn cho mã này): có phiếu gộp VÀ thẻ KHÔNG đang mở ⇒ hiện (hành vi QR như cũ);
 * có thẻ đang mở ⇒ ẨN (đặc tả 4). `theDangMo` là sự thật MÁY CHỦ tính (`PhieuGopView.theDangMo`), không phụ thuộc
 * quyền `payments:pos-check` — người chỉ có `payments:record` cũng không được thấy panel QR bung sẵn lúc có thẻ.
 */
export function docDieuKhienQr(v: {
  billId: string | null;
  theDangMo: TheDangMo | null;
  tuChon: DieuKhienQr | null;
}): { hienQr: boolean; qrDaMo: boolean } {
  if (v.billId === null) return { hienQr: false, qrDaMo: false };
  const t = v.tuChon !== null && v.tuChon.billId === v.billId ? v.tuChon : null;
  const hienQr = t !== null ? t.hien : v.theDangMo === null;
  return { hienQr, qrDaMo: hienQr || (t?.daMo ?? false) };
}

/** Bấm nút "QR · MÃ5": đảo hiện/ẩn; bật lên ⇒ ghi nhớ QR đã mở. KHÔNG phát phiếu. */
export function batTatQr(v: { billId: string; hienQr: boolean; qrDaMo: boolean }): DieuKhienQr {
  return { billId: v.billId, hien: !v.hienQr, daMo: v.qrDaMo || !v.hienQr };
}

/** Mở hộp thẻ: một kênh một lúc ⇒ ẩn panel QR (TỰ QUYẾT V11), giữ nguyên ghi nhớ QR đã từng hiện. */
export function chuyenSangThe(v: { billId: string; qrDaMo: boolean }): DieuKhienQr {
  return { billId: v.billId, hien: false, daMo: v.qrDaMo };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · CẢNH BÁO CẢ HAI KÊNH
// ─────────────────────────────────────────────────────────────────────────────

/** NGUYÊN VĂN chủ dự án chốt 09/10/2026. Panel QR và hộp thẻ in CÙNG hằng này. */
export const CAU_CANH_BAO_HAI_KENH =
  "Mã này đang mở cho cả chuyển khoản và thẻ — khách chỉ trả MỘT cách. Khoản về sau sẽ vào hàng chờ gắn tay.";

/**
 * Có in cảnh báo không: thẻ đang mở (đang chờ, chờ kế toán, hoặc chưa kết luận) VÀ QR của mã này đã mở. Thiếu một vế là
 * chỉ dùng một kênh — không có gì để cảnh báo. Không tự huỷ kênh kia: huỷ phiếu thẻ lúc khách có thể đang quẹt là rủi ro
 * hơn để mở (đặc tả 6).
 */
export function canhBaoHaiKenh(v: { theDangMo: TheDangMo | null; qrDaMo: boolean }): boolean {
  return v.theDangMo !== null && v.qrDaMo;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · NÚT "HUỶ PHIẾU" CỦA PHIẾU GỘP
// ─────────────────────────────────────────────────────────────────────────────

export type NutHuyPhieuGop =
  /** Không nút, không câu: không có quyền huỷ, hoặc phiếu đã nhận tiền (chỉ ĐÓNG được — nút Đóng nằm chỗ khác). */
  | { kieu: "AN" }
  | { kieu: "NUT" }
  /** Có thẻ đang mở ⇒ máy chủ sẽ từ chối (`huyPhieuGop`). Không nút; một dòng chữ nói đúng điều đang xảy ra. */
  | { kieu: "CHAN"; cau: string };

/**
 * Phiếu thẻ ĐANG LÊN MÀN, đủ để (a) biết nó có phải phiếu đang chờ quẹt không (`kieuPhieuPosDangMo`) và (b) đọc phán
 * quyết "huỷ tay được không" của nó. `PhieuPosView` thoả kiểu này — màn truyền nguyên `phieuPos`.
 */
export type PhieuPosChoNutHuy = PhieuPosChoNut & Pick<PhieuPosView, "huyPhieuThe">;

/**
 * NGỮ CẢNH của câu chặn — BẮT BUỘC, không mặc định (luật 7): một chỗ gọi quên truyền là chỗ vẫn hứa một nút người xem không có
 * hoặc hộp sẽ không vẽ (đúng lớp lỗi V4 / V26 của Việc 1).
 */
export type NguCanhCauChan = {
  /** `payments:pos-check` của NGƯỜI XEM — chỉ người này mở được hộp thẻ để bấm "Huỷ phiếu thẻ". */
  duocThuThePos: boolean;
  /** Phiếu thẻ đang lên màn, hoặc `null`. Chỉ được dùng phán quyết của nó khi nó LÀ phiếu đang chờ quẹt (xem `cauChanDangCho`). */
  phieuPos: PhieuPosChoNutHuy | null;
};

/**
 * Câu khi thẻ ĐANG CHỜ QUẸT chặn "Huỷ phiếu" — từ Việc 4 có một nút thật để trỏ tới, NHƯNG chỉ trỏ khi hộp sẽ thật sự vẽ nó:
 *   · người xem không có `payments:pos-check`          ⇒ chỉ nói nhờ ai (không hứa nút họ không có);
 *   · có quyền, phiếu thẻ KHÔNG phải phiếu đang chờ lên màn (rời màn sau 30′, hoặc màn đang cầm một phiếu cũ) ⇒ chỉ tới ô
 *     "Thẻ · đang chờ" — KHÔNG mượn phán quyết của một phiếu khác (nó mô tả sai phiếu);
 *   · có quyền, hộp CHO huỷ                             ⇒ trỏ đúng nút;
 *   · có quyền, hộp KHÔNG cho huỷ (lỗi kết nối · chưa ngã ngũ · yêu cầu sai mã…) ⇒ nói LÝ DO, cùng cặp câu hộp in. Hứa "bấm
 *     Huỷ phiếu thẻ" ở đây là lời hứa suông (luật 12).
 */
function cauChanDangCho(c: NguCanhCauChan): string {
  if (!c.duocThuThePos) return CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_KHONG_QUYEN;
  const hop = c.phieuPos !== null && kieuPhieuPosDangMo(c.phieuPos) === "DANG_CHO" ? c.phieuPos.huyPhieuThe : null;
  if (hop === null) return CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CHUA_BIET;
  return hop.huyDuoc ? CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CO_NUT : cauChanHuyPhieuGopVuongPhieuThe(ghepCauTuChoiHuy(hop));
}

/**
 * Câu ở MÀN khi không huỷ được vì có thẻ mở. Hai câu `CHO_KE_TOAN` / `CHUA_KET_LUAN` không hứa nút huỷ phiếu thẻ nên giữ
 * nguyên; `DANG_CHO` thì từ Việc 4 trỏ tới nút thật (xem `cauChanDangCho`). Câu MÁY CHỦ `LOI_HUY_KHI_CHO_QUET_THE`
 * (nguyên văn chủ dự án) không đổi — nó là TIỀN TỐ của câu `…_CO_NUT`.
 *
 * ⚠️ `nguCanh` BẮT BUỘC cho cả ba loại dù chỉ `DANG_CHO` dùng nó: thêm loại thứ tư cần ngữ cảnh mà chữ ký không có là lỗi
 * biên dịch ở MỌI chỗ gọi, không phải lỗi câm ở chỗ quên.
 */
const CAU_KHONG_HUY: Record<TheDangMo, (c: NguCanhCauChan) => string> = {
  DANG_CHO: cauChanDangCho,
  CHO_KE_TOAN: () => LOI_HUY_KHI_THE_CHO_KE_TOAN,
  CHUA_KET_LUAN: () => LOI_HUY_KHI_CHUA_KET_LUAN,
};

export function cauKhongHuyDuoc(the: TheDangMo, nguCanh: NguCanhCauChan): string {
  return CAU_KHONG_HUY[the](nguCanh);
}

/**
 * Máy chủ (`huyPhieuGop`) từ chối khi phiếu gộp có thẻ đang mở; nút chắc chắn bị từ chối là lời hứa suông.
 * `theDangMo` cùng nguồn với cổng máy chủ (`kieuTheDangMo`) nên hai bên không cãi nhau.
 *
 * `duocThuThePos` + `phieuPos` BẮT BUỘC (luật 7): chúng quyết câu chặn hứa gì (xem `cauChanDangCho`).
 */
export function nutHuyPhieuGop(
  v: { duocHuy: boolean; daNhan: number; theDangMo: TheDangMo | null } & NguCanhCauChan,
): NutHuyPhieuGop {
  if (!v.duocHuy || v.daNhan > 0) return { kieu: "AN" };
  return v.theDangMo === null
    ? { kieu: "NUT" }
    : { kieu: "CHAN", cau: cauKhongHuyDuoc(v.theDangMo, { duocThuThePos: v.duocThuThePos, phieuPos: v.phieuPos }) };
}
