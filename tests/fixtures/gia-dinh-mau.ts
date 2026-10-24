// tests/fixtures/gia-dinh-mau.ts — GIA ĐÌNH MẪU `GD-MAU` (US-02).
//
// Nguồn số: `docs/thanh-toan-linh-hoat/01-BA-thanh-toan-linh-hoat.md` mục 9.
// Mọi story của module thu học phí linh hoạt dùng ĐÚNG bộ số này, để năm tình huống A–E có một
// nghĩa duy nhất xuyên suốt 26 story và 50 kịch bản.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ HẰNG `KY_VONG_*` LÀ ĐỂ TEST KHÔNG PHẢI TỰ CỘNG NHẨM (README §2 luật 7)
//
// Một ca test viết `expect(conNo).toBe(phaiThu - daThu)` không kiểm gì cả: nó chép lại đúng
// phép tính của mã, nên mã sai kiểu nào nó cũng xanh. Số trong file này lấy từ BẢNG TRONG BA —
// tức từ người, không từ mã — nên nó mới là một phép so.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ ĐÂY LÀ FIXTURE THUẦN, KHÔNG PHẢI FIXTURE DB
//
// US-02/AC1 mô tả một fixture dựng dữ liệu thật ("idempotent, dọn sạch"). Nhưng `pnpm test:unit`
// của repo này **CẤM chạm DB** (chốt 04/09: `resetDb()` từng xoá sạch dữ liệu đang xem, mất 250
// học viên và 12 tài khoản UAT). Bộ kiểm bất biến là hàm THUẦN, nên nó cần ẢNH CHỤP chứ không
// cần bảng. Fixture DB sẽ sinh ra khi có story đầu tiên thật sự cần ghi — không sớm hơn.

import type { AnhChupGiaDinh } from "@/lib/finance/ledger/kiem-bat-bien";
import { bangGiaBuoi, tachBangGiaTaiBuoi, tongBangGia } from "@/lib/finance/pricing/bang-gia-buoi";

export const GD_MAU = "GD-MAU";
export const PHAP_NHAN = "PN-SATAROBO"; // CS1 và CS2 cùng pháp nhân — gate-0 X4
export const PHAP_NHAN_KHAC = "PN-KHAC"; // chỉ tồn tại trong fixture, để dựng được ca B8

export const OI = { an: "oi-an", binh: "oi-binh" } as const;
export const PR = {
  anD1: "pr-an-d1",
  anD2: "pr-an-d2",
  binhD1: "pr-binh-d1",
  binhD2: "pr-binh-d2",
} as const;
export const TXN_1 = "txn-kt01";

/** Số CHỐT ĐƠN — BA mục 9 bảng đầu. */
export const SO_CHOT_DON = {
  an: {
    ten: "An",
    khoa: "Sata3",
    soBuoi: 48,
    niemYet: 9_600_000,
    uuDaiAnhEm: 960_000,
    hocPhiThuc: 8_640_000,
    donGia: 180_000,
    dot: [4_320_000, 4_320_000],
  },
  binh: {
    ten: "Bình",
    khoa: "Sata5",
    soBuoi: 48,
    niemYet: 12_000_000,
    uuDaiAnhEm: 0,
    hocPhiThuc: 12_000_000,
    donGia: 250_000,
    dot: [6_000_000, 6_000_000],
  },
  /** Kỳ thu gốc: An·Đợt 1 + Bình·Đợt 1. */
  kyThu01: 10_320_000,
  sdtPhuHuynh: "0905123456",
} as const;

/**
 * Kỳ vọng của năm tình huống — chép từ BẢNG trong BA, không suy từ mã.
 *
 * Tình huống A: Bình dừng sau buổi 20, dư 1.000.000 chuyển An, An mất ưu đãi từ buổi 25.
 * Tình huống B: Bình học LỐ tới buổi 26 rồi dừng.
 * Tình huống C: cọc 1.000.000/con, Bình không học buổi nào.
 * Tình huống D: cọc gộp 2.000.000 không ghi con → ví → chia đôi.
 * Tình huống E: chuyển thừa 500.000 vào kỳ thu 3.800.000.
 */
export const KY_VONG_A = {
  binhGiaTriDaDung: 5_000_000, // 20 × 250.000
  binhQuyetToan: -1_000_000,
  binhPhaiThu: 5_000_000,
  binhDaThu: 5_000_000,
  binhConNo: 0,
  duChuyenSangAn: 1_000_000,
  anMatUuDaiTuBuoi: 25,
  anDonGiaSauMatUuDai: 200_000,
  anDot2Cu: 4_320_000,
  anDot2Moi: 4_800_000,
  anPhaiThu: 9_120_000,
  anDaThu: 5_320_000,
  anConNo: 3_800_000,
  /** Kỳ thu kế tiếp chỉ còn đợt 2 của An. */
  kyThu02: 3_800_000,
} as const;

export const KY_VONG_B = {
  binhGiaTriDaDung: 6_500_000, // 26 × 250.000 — học lố
  binhQuyetToan: 500_000,
  binhConNo: 500_000,
  anDot2Moi: 4_800_000,
  kyThu02: 5_300_000,
  /** Quyết toán của Bình đứng ĐẦU thứ tự lấp trong kỳ thu. */
  dongDauTien: "binh-quyet-toan",
} as const;

export const KY_VONG_C = {
  cocMoiCon: 1_000_000,
  binhGiaTriDaDung: 0,
  binhQuyetToan: -1_000_000,
  binhConNo: 0,
  anMatUuDaiTuBuoi: 1,
  anDonGiaSauMatUuDai: 200_000,
  anHocPhiThuc: 9_600_000,
  anDot1Moi: 4_800_000,
  /** 4.800.000 − cọc An 1.000.000 − chuyển từ Bình 1.000.000. */
  anConNoDot1: 2_800_000,
  anConNoTong: 7_600_000,
} as const;

/**
 * ⚠️ TÌNH HUỐNG D ĐÃ ĐỔI KẾT CỤC [chủ dự án chốt 16/09/2026 chiều].
 *
 * BA mô tả: cọc gộp 2.000.000 không ghi con → vào VÍ (`DEPOSIT_UNSPLIT`) → sale chia ví cho hai
 * con khi tạo đơn (TS-13). Luật mới BỎ cả đường đó: *"Mọi trường hợp khác: KHÔNG phân bổ […]
 * đánh dấu CAN_XU_LY […] Kế toán xử lý duy nhất bằng hoàn tiền."*
 *
 * Nên kết cục mới là: tiền nằm nguyên ở `BankTransaction`, mã `KHONG_KHOP_PHIEU`, kế toán hoàn
 * lại. Sale phát phiếu gộp rồi mời phụ huynh chuyển đúng số.
 *
 * Hằng dưới đây giữ CẢ HAI: số của luật mới để test dùng, và số của BA để ai đọc lại tài liệu
 * biết vì sao nó khác.
 */
export const KY_VONG_D = {
  cocGop: 2_000_000,
  maCanXuLy: "KHONG_KHOP_PHIEU",
  phanBo: 0,
  viSauKhiVe: 0,
  /** Công nợ KHÔNG đổi — tiền chưa vào sổ gia đình. */
  anConNo: 8_640_000,
  binhConNo: 12_000_000,
  /** ~~BA: chia ví An 1.000.000 / Bình 1.000.000 → còn nợ 7.640.000 / 11.000.000~~ ĐÃ BỎ. */
  daBo_chiaVi: true,
} as const;

/**
 * ⚠️ TÌNH HUỐNG E ĐÃ ĐỔI KẾT CỤC [cùng quyết định].
 *
 * BA mô tả: phụ huynh chuyển 4.300.000 cho kỳ thu 3.800.000 → An +3.800.000 (PAID), ví
 * +500.000 (`OVERPAY`). Luật mới: **thừa 1đ cũng không chia**. Toàn bộ 4.300.000 nằm nguyên,
 * mã `LECH_SO`, An vẫn còn nợ đủ 3.800.000, kế toán hoàn cả khoản.
 *
 * Đây là ca khắc nghiệt nhất của luật mới, và là ca chủ dự án đã ra sẵn cách đo: *"đo sau 1
 * tháng chạy thật, số ca CAN_XU_LY theo loại. Nếu > 0 ca lệch số mỗi tháng thì báo lại, lúc đó
 * mới xét mở thêm."* Đừng tự nới trước khi có số đó.
 */
export const KY_VONG_E = {
  kyThu: 3_800_000,
  phuHuynhChuyen: 4_300_000,
  maCanXuLy: "LECH_SO",
  lech: 500_000,
  phanBo: 0,
  /** An KHÔNG được ghi nhận đồng nào. */
  anConNoSauKhiVe: 3_800_000,
  /** ~~BA: An +3.800.000, ví +500.000~~ ĐÃ BỎ. */
  daBo_thuaVaoVi: true,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Bảng giá — dựng bằng chính hàm sản xuất, KHÔNG gõ tay mảng đoạn.
//
// Có chủ ý: nếu `bangGiaBuoi` làm tròn sai thì fixture sai theo và ca test bảng giá vẫn xanh.
// Nên hằng canh phép làm tròn là `SO_CHOT_DON.*.donGia` (gõ tay, lấy từ BA), còn fixture thì
// dùng hàm — hai nguồn khác nhau gặp nhau ở ca `[GDM-01]`.
// ─────────────────────────────────────────────────────────────────────────────

export const BANG_GIA_AN = bangGiaBuoi(SO_CHOT_DON.an.hocPhiThuc, SO_CHOT_DON.an.soBuoi);
export const BANG_GIA_BINH = bangGiaBuoi(SO_CHOT_DON.binh.hocPhiThuc, SO_CHOT_DON.binh.soBuoi);

/** Bảng giá của An SAU khi mất ưu đãi anh em từ buổi 25 (tình huống A và B). */
export const BANG_GIA_AN_SAU_MAT_UU_DAI = tachBangGiaTaiBuoi(
  BANG_GIA_AN,
  KY_VONG_A.anMatUuDaiTuBuoi,
  KY_VONG_A.anDonGiaSauMatUuDai,
);

// ─────────────────────────────────────────────────────────────────────────────
// Ảnh chụp cho bộ kiểm bất biến
// ─────────────────────────────────────────────────────────────────────────────

/** Ảnh chụp SAU khi kỳ thu 01 đã trả đủ — trạng thái gốc, phải SẠCH mọi bất biến. */
export function anhChupGoc(): AnhChupGiaDinh {
  return {
    giaDinhId: GD_MAU,
    dong: [
      {
        orderItemId: OI.an,
        ten: SO_CHOT_DON.an.ten,
        phapNhanId: PHAP_NHAN,
        phaiThu: SO_CHOT_DON.an.hocPhiThuc,
        daThu: SO_CHOT_DON.an.dot[0],
        thanhTien: SO_CHOT_DON.an.hocPhiThuc,
        trangThai: "ACTIVE",
      },
      {
        orderItemId: OI.binh,
        ten: SO_CHOT_DON.binh.ten,
        phapNhanId: PHAP_NHAN,
        phaiThu: SO_CHOT_DON.binh.hocPhiThuc,
        daThu: SO_CHOT_DON.binh.dot[0],
        thanhTien: SO_CHOT_DON.binh.hocPhiThuc,
        trangThai: "ACTIVE",
      },
    ],
    giaoDich: [
      { bankTransactionId: TXN_1, soTien: SO_CHOT_DON.kyThu01, daRot: SO_CHOT_DON.kyThu01 },
    ],
    vi: [],
    hoan: 0,
    nghiepVuChuyen: [],
    phieuGop: [{ billId: "KT-01", trangThai: "PAID", dongPhieu: [PR.anD1, PR.binhD1] }],
  };
}

/** Ảnh chụp SAU khi hoàn tất tình huống A. Cũng phải SẠCH — đó là điều đáng kiểm nhất. */
export function anhChupSauTinhHuongA(): AnhChupGiaDinh {
  return {
    giaDinhId: GD_MAU,
    dong: [
      {
        orderItemId: OI.an,
        ten: SO_CHOT_DON.an.ten,
        phapNhanId: PHAP_NHAN,
        phaiThu: KY_VONG_A.anPhaiThu,
        daThu: KY_VONG_A.anDaThu,
        // Học phí của An ĐỔI vì bảng giá tách đoạn — đây là chỗ B6 dễ đỏ nhất nếu ai đó quên
        // cập nhật thành tiền sau khi tách.
        thanhTien: KY_VONG_A.anPhaiThu,
        trangThai: "ACTIVE",
      },
      {
        orderItemId: OI.binh,
        ten: SO_CHOT_DON.binh.ten,
        phapNhanId: PHAP_NHAN,
        phaiThu: KY_VONG_A.binhPhaiThu,
        daThu: KY_VONG_A.binhDaThu,
        thanhTien: SO_CHOT_DON.binh.hocPhiThuc,
        trangThai: "STOPPED",
        giaTriQuyetToan: KY_VONG_A.binhGiaTriDaDung,
      },
    ],
    giaoDich: [
      { bankTransactionId: TXN_1, soTien: SO_CHOT_DON.kyThu01, daRot: SO_CHOT_DON.kyThu01 },
    ],
    vi: [],
    hoan: 0,
    nghiepVuChuyen: [
      {
        nghiepVuId: "op-dung-hoc-binh",
        dong: [
          {
            tai: OI.binh,
            giaDinhId: GD_MAU,
            phapNhanId: PHAP_NHAN,
            amount: -KY_VONG_A.duChuyenSangAn,
            nguonDaXacNhan: SO_CHOT_DON.binh.dot[0],
          },
          {
            tai: OI.an,
            giaDinhId: GD_MAU,
            phapNhanId: PHAP_NHAN,
            amount: KY_VONG_A.duChuyenSangAn,
          },
        ],
      },
    ],
    phieuGop: [{ billId: "KT-01", trangThai: "PAID", dongPhieu: [PR.anD1, PR.binhD1] }],
  };
}

/** Bảng giá của An ở tình huống A phải khớp Σ với phải thu — buộc hai module đồng ý. */
export const KY_VONG_TONG_BANG_GIA_AN_SAU_A = tongBangGia(BANG_GIA_AN_SAU_MAT_UU_DAI);
