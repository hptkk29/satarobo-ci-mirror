// lib/finance/doi-soat-hoc-phi.ts — "EM NÀO ĐÓNG ĐỦ, EM NÀO CÒN THIẾU" cho MỘT ghi danh.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỒN TẠI
//
// Chủ dự án 14/09/2026, sau khi có đường nhập 796.455.000đ từ sheet: "tiền này nhập vào
// chưa chắc đã đóng full 100% thì bây giờ tôi cần 1 thứ để merge lại cái nào đã đóng full
// cái nào thiếu… vì phần này sẽ show cho phụ huynh thấy là đã đóng bao nhiêu tiền rồi và
// còn thiếu bao nhiêu."
//
// ─────────────────────────────────────────────────────────────────────────────
// MẪU SỐ LÀ `Enrollment.finalPrice`, KHÔNG PHẢI `Order.totalAmount`
//
// Đơn sinh từ nhập sheet CỐ Ý đặt `totalAmount = Σ tiền đã thu` (nó là BIÊN LAI GOM,
// không phải hợp đồng — xem `lib/finance/ghi-giao-dich-cu.ts` chú thích (2)). Đo theo đơn
// thì đơn nào cũng "đủ", tức là câu hỏi này không trả lời được ở trục đơn.
//
// `finalPrice` cũng đúng là thứ cổng phụ huynh đọc (`lib/portal/billing-student.ts`,
// `lib/finance/debt.ts`), nên màn đối soát và màn phụ huynh nói cùng một con số.
//
// ─────────────────────────────────────────────────────────────────────────────
// BA CON SỐ, KHÔNG PHẢI HAI — và hai con số "còn thiếu", không phải một
//
//   PHẢI ĐÓNG   = `Enrollment.finalPrice`
//   ĐÃ GHI NHẬN = Σ Payment `saleStatus = RECORDED`      (trục B — tiền vừa nhập nằm đây)
//   ĐÃ XÁC NHẬN = Σ Payment `accountantStatus = CONFIRMED` (trục A — CỔNG PHỤ HUYNH cộng)
//
// Nhập sheet xong, khoản để `accountantStatus = PENDING` ⇒ trục A vẫn 0 ⇒ **phụ huynh vẫn
// thấy nợ nguyên** cho tới khi kế toán xác nhận ở /payments. Một màn in MỘT con số "còn
// thiếu" thì chắc chắn nói dối một trong hai người:
//   · lấy trục B ⇒ nói với người vận hành "đã đủ" trong khi phụ huynh vẫn thấy nợ;
//   · lấy trục A ⇒ nói "còn thiếu 8tr" và sale đi đòi tiền khách đã đóng rồi.
// Nên ở đây trả CẢ HAI, đặt tên thẳng theo người đọc nó.
//
// THUẦN — không Prisma, không DB. Và KHÔNG định nghĩa lại phép tính tiền: phần số học gọi
// `congNoDon` (`lib/finance/cong-no-don.ts`). Repo này đã có ≥7 định nghĩa "đã thu"; thêm
// một cái nữa ở tầng hiển thị là thêm một chỗ để lệch.
// ─────────────────────────────────────────────────────────────────────────────

import { congNoDon } from "./cong-no-don";

export const TRANG_THAI_HOC_PHI = {
  /** Ghi danh chưa có `finalPrice` ⇒ hệ thống KHÔNG BIẾT phải đóng bao nhiêu. */
  CHUA_CHOT_GIA: "CHUA_CHOT_GIA",
  /** Có giá, chưa ghi nhận đồng nào. */
  CHUA_DONG: "CHUA_DONG",
  /** Có giá, đã thu một phần. */
  THIEU: "THIEU",
  /** Tiền đã vào ĐỦ nhưng kế toán chưa xác nhận hết ⇒ phụ huynh vẫn thấy nợ. */
  CHO_XAC_NHAN: "CHO_XAC_NHAN",
  /** Đã đóng đủ và kế toán đã xác nhận đủ. */
  DU: "DU",
  /** Ghi nhận nhiều hơn học phí. */
  THU_VUOT: "THU_VUOT",
} as const;

export type TrangThaiHocPhiDoiSoat =
  (typeof TRANG_THAI_HOC_PHI)[keyof typeof TRANG_THAI_HOC_PHI];

/** Nhãn tiếng Việt — một chỗ, đừng ghép chuỗi ở component. */
export const NHAN_TRANG_THAI_HOC_PHI: Record<TrangThaiHocPhiDoiSoat, string> = {
  CHUA_CHOT_GIA: "Chưa chốt học phí",
  CHUA_DONG: "Chưa đóng đồng nào",
  THIEU: "Còn thiếu",
  CHO_XAC_NHAN: "Đủ tiền — chờ kế toán xác nhận",
  DU: "Đã đóng đủ",
  THU_VUOT: "Thu vượt",
};

export type DoiSoatHocPhi = {
  trangThai: TrangThaiHocPhiDoiSoat;
  /** `Enrollment.finalPrice`. `0` khi chưa chốt giá — KHÔNG bịa số. */
  phaiDong: number;
  /** Trục B. Nhãn trên màn là "Đã thu": với phụ huynh, tiền đã chuyển là đã thu. */
  daThu: number;
  /** Trục A — đúng con số cổng phụ huynh cộng. */
  daXacNhan: number;
  /**
   * `phaiDong − daXacNhan`. **ĐÂY LÀ SỐ PHỤ HUYNH ĐANG NHÌN THẤY** ở cổng, kể cả khi
   * tiền đã nằm trong hệ thống. Đừng giấu nó đi vì nó "không công bằng" — nó là sự thật
   * trên màn hình của khách.
   */
  conThieuPhuHuynhThay: number;
  /**
   * `phaiDong − daThu`. Số THẬT SỰ còn phải đi thu, sau khi kế toán xác nhận hết phần
   * đã nhập. Đây là số dùng để quyết định có gọi điện cho phụ huynh hay không.
   */
  conThieuThucTe: number;
  /** B − A: tiền đã vào mà kế toán chưa xác nhận. Việc nội bộ, không phải nợ của khách. */
  choXacNhan: number;
  /** Phần ghi nhận vượt học phí. Có ô riêng để hai số "còn thiếu" không bao giờ in số âm. */
  traVuot: number;
  /**
   * TRỤC A > TRỤC B — hình dạng KHÔNG THỂ CÓ trên dữ liệu thật.
   *
   * Kế toán chỉ xác nhận được khoản sale đã ghi nhận, nên A ⊆ B. A > B nghĩa là một trong
   * hai trục đang đọc sai.
   *
   * ⚠️ Nó CÓ THẬT trên mọi môi trường test: `prisma/seed-uat/04-tai-chinh.ts` đặt toàn bộ
   * `saleStatus = COLLECT_CONFIRMED`, mà `KHOAN_DA_GHI_NHAN` lọc BẰNG "RECORDED" ⇒ trục B
   * ra 0đ trong khi trục A có tiền (đo 14/09 trên satarobo_local: 379/380 khoản
   * COLLECT_CONFIRMED). Trên PROD không có hình dạng này — không đường ghi nào trong mã
   * chạy thật tạo `COLLECT_CONFIRMED`, nó chỉ là nhãn UI + seed.
   *
   * Cờ này phục vụ CẢ HAI: không để người nghiệm thu tưởng màn hỏng, và nếu nó bật trên
   * prod thì đó là tín hiệu webhook/ghi sổ hỏng — đúng thứ hai trục sinh ra để bắt.
   */
  lechTrucBatThuong: boolean;
};

export function doiSoatHocPhi(input: {
  /** `Enrollment.finalPrice` — `null`/`0` nghĩa là CHƯA CHỐT GIÁ, không phải "miễn phí". */
  hocPhi: number | null | undefined;
  daGhiNhan: number;
  daXacNhan: number;
}): DoiSoatHocPhi {
  const so = congNoDon({
    totalAmount: Number(input.hocPhi ?? 0),
    daGhiNhan: input.daGhiNhan,
    daXacNhan: input.daXacNhan,
  });

  // ⚠️ `daXacNhan` lấy THẲNG từ đầu vào (đã làm sạch), KHÔNG suy ngược từ `choXacNhan`.
  // Suy ngược (`daThu − choXacNhan`) trông tương đương nhưng sai đúng ở ca trục A > trục
  // B: `choXacNhan` bị kẹp về 0 nên `daXacNhan` hoá thành `daThu` — tức màn in ra một con
  // số kế toán KHÔNG hề xác nhận, ngay tại ca duy nhất cần nói thật.
  const daXacNhanSach = Number.isFinite(input.daXacNhan)
    ? Math.max(0, Math.round(input.daXacNhan))
    : 0;
  const chung = {
    phaiDong: so.phaiDong,
    daThu: so.daThu,
    daXacNhan: daXacNhanSach,
    choXacNhan: so.choXacNhan,
    traVuot: so.traVuot,
    lechTrucBatThuong: daXacNhanSach > so.daThu,
  };

  // ⚠️ CHƯA CHỐT GIÁ PHẢI XÉT TRƯỚC MỌI THỨ, kể cả khi đã có tiền vào.
  //
  // Nhóm này hôm nay đang BỊ GIẤU: `getDebtRows` lọc `finalPrice: { not: null }` nên
  // /cong-no không hiện. Mà đó là nhóm tệ nhất — nhà đã đóng tiền, hệ thống không biết
  // phải đóng bao nhiêu, nên không ai nợ ai trong sổ và không màn nào kêu lên.
  //
  // Và KHÔNG bịa số thiếu cho nó: mẫu số không có thì mọi phép trừ đều là chuyện bịa.
  if (chung.phaiDong <= 0) {
    return {
      ...chung,
      trangThai: TRANG_THAI_HOC_PHI.CHUA_CHOT_GIA,
      conThieuPhuHuynhThay: 0,
      conThieuThucTe: 0,
      traVuot: 0,
    };
  }

  const conThieuThucTe = so.conThieu;
  const conThieuPhuHuynhThay = Math.max(0, chung.phaiDong - chung.daXacNhan);

  // Thứ tự phân loại là phần chịu lực — đổi thứ tự là đổi nghĩa của màn hình.
  const trangThai: TrangThaiHocPhiDoiSoat =
    so.traVuot > 0
      ? TRANG_THAI_HOC_PHI.THU_VUOT
      : chung.daThu <= 0
        ? TRANG_THAI_HOC_PHI.CHUA_DONG
        : conThieuThucTe > 0
          ? // Còn thiếu tiền THẬT thì là THIẾU, bất kể kế toán đã xác nhận tới đâu — việc
            // phải làm là đi thu, không phải bấm xác nhận.
            TRANG_THAI_HOC_PHI.THIEU
          : conThieuPhuHuynhThay > 0
            ? // Tiền đã đủ, chỉ còn kế toán. Tách riêng vì việc phải làm khác hẳn, và vì
              // đây đúng là trạng thái của 115 em ngay sau lượt nhập sheet.
              TRANG_THAI_HOC_PHI.CHO_XAC_NHAN
            : TRANG_THAI_HOC_PHI.DU;

  return { ...chung, trangThai, conThieuPhuHuynhThay, conThieuThucTe };
}
