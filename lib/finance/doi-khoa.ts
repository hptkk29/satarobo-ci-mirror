// lib/finance/doi-khoa.ts — ĐỔI KHOÁ / ĐỔI LỚP: phép chia tiền. THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN F4 · US-20 "Đổi khoá / đổi cơ sở"
//
//   AC1 — *"MỘT thao tác: dừng ghi danh cũ (phí dừng = 0, quyết toán theo buổi đã dùng) +
//          tạo ghi danh mới + chuyển dư sang ghi danh mới."*
//   AC2 — *"Chuyển bằng TIỀN: dư 1.000.000 từ khoá 250.000/buổi sang khoá 200.000/buổi hiện
//          'tương đương 5 buổi' CHỈ ĐỂ THAM KHẢO."*
//   AC3 — *"Khoá mới đắt hơn → phần còn thiếu thành đợt của ghi danh mới; rẻ hơn và dư vượt
//          học phí mới → phần vượt vào ví."*
//
// ─────────────────────────────────────────────────────────────────────────────
// CHUYỂN BẰNG TIỀN, KHÔNG BẰNG BUỔI — và vì sao đó là vế quan trọng nhất
//
// Cám dỗ là quy dư ra SỐ BUỔI rồi mang số buổi ấy sang khoá mới ("còn 4 buổi thì học tiếp 4
// buổi"). Sai, và sai theo hướng tốn tiền thật:
//
//   · hai khoá có đơn giá buổi khác nhau ⇒ "4 buổi" ở khoá cũ KHÔNG bằng "4 buổi" ở khoá
//     mới, nên quy ra buổi rồi quy ngược lại là hai lần làm tròn trên cùng một khoản tiền;
//   · số buổi cam kết của khoá mới có thể chưa khai (`Course.totalSessions = null`), lúc đó
//     phép quy đổi KHÔNG TỒN TẠI — mà tiền thì vẫn phải chuyển được.
//
// Nên `tuongDuongBuoi` dưới đây là một con số **CHỈ ĐỂ ĐỌC**. Không phép tính nào của module
// này dùng nó, và ca `[DKH-08]` ghim điều đó: đổi nó thành `null` không làm số tiền nào lệch.
//
// ⚠️ "PHÍ DỪNG = 0" trong AC1 KHÔNG có nghĩa là "bé không phải trả gì". Nó nghĩa là không có
// khoản PHẠT nào cộng thêm — bé vẫn trả đúng phần đã học, đúng như `tinhQuyetToan` với lý do
// `PH_CHU_DONG`. Repo này vốn không có khái niệm phí phạt dừng học, nên vế ấy đúng sẵn; ghi
// lại đây để người sau đừng thêm một khoản phạt vào đường đổi khoá.

/** Học phí và đơn giá của một bên (khoá cũ hoặc khoá mới). */
export type BenKhoa = {
  /** Học phí thực = `totalPrice − discountAmount`. */
  hocPhiThuc: number;
  /** `Course.totalSessions`. `null`/`0` = khoá chưa khai số buổi. */
  soBuoiCamKet: number | null;
};

export type KeHoachDoiKhoa = {
  /** Dư của khoá CŨ sau quyết toán = `daThu − giaTriDaDung`. Có thể ÂM (bé còn nợ). */
  du: number;
  /** Bé còn NỢ phần đã học bao nhiêu. `0` khi có dư. */
  conNoCu: number;
  /** Số tiền chuyển sang dòng MỚI. Không bao giờ vượt học phí thực của khoá mới. */
  chuyenSangMoi: number;
  /**
   * Phần dư VƯỢT học phí mới.
   *
   * ⚠️ **BA gọi chỗ này là "ví" (AC3, TS-41 kỳ vọng "ví +400.000"). Trong repo này nó đi
   * đường HOÀN TIỀN, không đi `CreditBalance`.** Ba lý do, lý do thứ ba là lý do thật:
   *
   *   1. `CreditBalance` có màn hình (`/bien-dong-so-du`) nhưng KHÔNG có quy trình — chính
   *      màn ấy ghi *"Hệ thống KHÔNG tự hoàn, KHÔNG tự trừ sang đơn khác — kế toán quyết"*,
   *      và `settledAt` đặt bằng tay. Nó là bảng thông báo, không phải sổ có thao tác.
   *   2. `RefundRequest` thì có màn `/hoan-tien`, có trạng thái, có người duyệt — và PHIÊN D
   *      đã nối sẵn đường ấy cho phần dư sau khi dừng học.
   *   3. **Giữ bất biến "Σ phần phân = dư".** Phần vượt đi qua `kiemPhanDu` như mọi phần
   *      khác, nên không có đồng nào ra khỏi phép kiểm. Ghi thẳng một dòng `CreditBalance`
   *      bên ngoài phép kiểm ấy là mở một đường tiền THỨ HAI không ai đối soát.
   *
   * Và quan trọng hơn cả ba: PHIÊN D đã chọn HOÀN cho dư-sau-khi-dừng. Hai cái nút cho cùng
   * một loại dư mà ra hai chỗ khác nhau là thứ làm đối soát cuối tháng không bao giờ khớp.
   */
  phanVuot: number;
  /** Khoá mới còn thiếu bao nhiêu sau khi nhận chuyển ⇒ thành đợt của dòng mới (AC3). */
  conThieuMoi: number;
  /**
   * "Tương đương mấy buổi ở khoá MỚI" — **CHỈ ĐỂ THAM KHẢO** (AC2).
   *
   * `null` khi khoá mới chưa khai số buổi hoặc học phí 0: lúc đó phép quy đổi không tồn tại,
   * và in một số 0 ở đó là bịa.
   */
  tuongDuongBuoi: number | null;
};

const tron = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);

/**
 * Chia tiền cho một lượt đổi khoá.
 *
 * @param daThuCu       Σ tiền đã xác nhận của dòng CŨ (trục A).
 * @param giaTriDaDung  giá trị phần đã học của khoá cũ — từ `tinhQuyetToan`.
 * @param moi           khoá MỚI.
 *
 * ⚠️ Nhận `giaTriDaDung` ĐÃ TÍNH chứ không tự tính lại: phép quyết toán theo buổi là của
 * `lib/finance/dung-hoc.ts` (PHIÊN D) và nó có luật riêng (`TRUNG_TAM_HUY` cho phí 0, buổi
 * huỷ không tính, phần dư làm tròn rơi vào buổi cuối). Tính lại ở đây là bản thứ hai của
 * cùng một luật tiền.
 */
export function keHoachDoiKhoa(input: {
  daThuCu: number;
  giaTriDaDung: number;
  moi: BenKhoa;
}): KeHoachDoiKhoa {
  const daThu = Math.max(0, tron(input.daThuCu));
  const daDung = Math.max(0, tron(input.giaTriDaDung));
  const hocPhiMoi = Math.max(0, tron(input.moi.hocPhiThuc));

  const du = daThu - daDung;
  const duDuong = Math.max(0, du);

  const chuyenSangMoi = Math.min(duDuong, hocPhiMoi);
  const phanVuot = duDuong - chuyenSangMoi;
  const conThieuMoi = hocPhiMoi - chuyenSangMoi;

  const camKetMoi = input.moi.soBuoiCamKet == null ? 0 : Math.trunc(tron(input.moi.soBuoiCamKet));
  // Quy đổi tham khảo: dư / (học phí mới ÷ số buổi mới). Làm tròn XUỐNG — nói "tương đương 5
  // buổi" khi thật ra chỉ đủ 4,8 buổi là hứa thừa nửa buổi cho phụ huynh.
  const tuongDuongBuoi =
    camKetMoi > 0 && hocPhiMoi > 0
      ? Math.floor(duDuong / (hocPhiMoi / camKetMoi))
      : null;

  return {
    du,
    conNoCu: Math.max(0, -du),
    chuyenSangMoi,
    phanVuot,
    conThieuMoi,
    tuongDuongBuoi,
  };
}

/** Câu chặn của một lượt đổi khoá, hoặc `null` nếu đi tiếp được. */
export type LoiDoiKhoa = string | null;

/**
 * Cổng THUẦN của phép đổi khoá — những thứ kiểm được mà không cần DB.
 *
 * ⚠️ Cổng chạm DB (lớp đích còn chỗ · khoá đã khai giá · soát giá niêm yết · ghi danh cũ còn
 * sống) nằm ở `doi-khoa-db.ts`. Tách ra vì các luật dưới đây là luật NGHIỆP VỤ, và luật
 * nghiệp vụ mà chỉ kiểm được bằng cách dựng một cơ sở dữ liệu thì sẽ không ai viết đủ ca.
 */
export function kiemDoiKhoa(input: {
  /** Dòng cũ đã dừng học chưa. */
  dongCuDaDung: boolean;
  /** Lớp đích có TRÙNG lớp hiện tại không. */
  trungLopHienTai: boolean;
  /** Dòng cũ có ghi danh không — không có thì không chuyển lớp được. */
  coGhiDanhCu: boolean;
  hocPhiMoi: number;
  lyDo: string;
}): LoiDoiKhoa {
  if (input.dongCuDaDung) {
    return "Bé này đã dừng học rồi — không đổi khoá từ một dòng đã quyết toán";
  }
  if (!input.coGhiDanhCu) {
    // Không có ghi danh cũ thì không có gì để chuyển, và quan trọng hơn: dòng MỚI sẽ không
    // có ghi danh ⇒ khoản tiền chuyển sang nó KHÔNG BAO GIỜ xuất được phiếu thu
    // (`confirmPayment` từ chối khoản chưa gắn ghi danh).
    return "Bé này chưa được xếp lớp — xếp lớp trước rồi mới đổi khoá được";
  }
  if (input.trungLopHienTai) return "Lớp đích trùng lớp bé đang học";
  if (!(tron(input.hocPhiMoi) >= 0)) return "Học phí khoá mới không được âm";
  if (!input.lyDo.trim()) return "Phải ghi lý do đổi khoá";
  return null;
}
