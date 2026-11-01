// lib/pricing/tinh-gia-theo-moc.ts — GIÁ THEO MỐC SỐ BUỔI (mô hình "thu học phí theo phạm vi học").
//
// THUẦN: không DB, không Prisma, không `server-only`, không đọc đồng hồ. Form tạo đơn và máy chủ
// gọi CÙNG hàm này (BA Phần 4(b) §E.3) — hai bản tính giá là chỗ sinh ra "màn hình nói một
// đằng, sổ ghi một nẻo".
//
//   niemYet(n)  = gia48 × n ÷ 48
//   nen         = n = 48 ? (sản phẩm 48 thứ nhất ? bangB.nhat : bangB.haiTroDi) : bangA[n]
//   congThem    = congAnhEm[thứ tự con]
//   apDung      = MIN(nen + congThem, tranTong)
//   thanhTien   = gia48 × n × (100 − apDung) ÷ 4800        ← PHẢI CHIA HẾT
//
// 🔴 KHÔNG LÀM TRÒN (QĐ-34). Không chia hết ⇒ ném `LoiGiaTheoMoc("PRICE_NOT_INTEGER")`, không đoán,
// không cắt cụt. Lý do: tiền phải khớp từng đồng với mã QR và với phần hoàn tiền sau này.
//
// ⛔ File này và mọi tệp dưới `lib/pricing/` KHÔNG ĐƯỢC import `lib/finance/pricing/bang-gia-buoi`:
// tệp đó là bể giá làm tròn XUỐNG nghìn đồng cho đường dừng học cũ — trái QĐ-34. Lưới ghim:
// `tinh-gia-theo-moc.test.ts` `[TGM-PIN]`.
//
// ── MỌI ĐIỂM CHƯA CHỐT LÀ THAM SỐ, KHÔNG PHẢI HẰNG ───────────────────────────────────────────
//   · bảng A/B, % anh em, trần  → `ChinhSachGia` (dữ liệu; sau này đọc từ phiên bản chính sách)
//   · số buổi lẻ (MT-11)        → `quyTacBuoiLe`, mặc định `TU_CHOI` (fail-closed)
//   · mốc ngày áp giá (MT-02)   → `chonNgayApGia`, người gọi chọn chế độ
// Mặc định của tham số chỉ để mã chạy được, KHÔNG phải quyết định chính sách.

/** Chính sách giảm — toàn số NGUYÊN theo phần trăm (0..100). */
export interface ChinhSachGia {
  /** Bảng A: số buổi → % giảm nền. PL02: 12 → 0, 24 → 5, 36 → 10. */
  readonly bangA: Readonly<Record<number, number>>;
  /** Bảng B (gói trọn `soBuoiCaGoi`): sản phẩm thứ nhất / thứ hai trở đi. PL02: 15 / 25. */
  readonly bangB: { readonly nhat: number; readonly haiTroDi: number };
  /** Cộng thêm cho anh/chị/em: con thứ nhất / thứ hai / thứ ba trở đi. PL02: 0 / 10 / 15. */
  readonly congAnhEm: { readonly thu1: number; readonly thu2: number; readonly thu3TroDi: number };
  /** Trần TỔNG mức giảm mỗi sản phẩm. PL02: 25. */
  readonly tranTong: number;
  /** Số buổi của gói trọn. PL02: 48. */
  readonly soBuoiCaGoi: number;
}

/** SR.QD.233 + Phụ lục 02 (hiệu lực 01/09–31/12/2026). Chỉ là GIÁ TRỊ MẶC ĐỊNH để mã chạy được. */
export const CHINH_SACH_PL02: ChinhSachGia = Object.freeze({
  bangA: Object.freeze({ 12: 0, 24: 5, 36: 10 }),
  bangB: Object.freeze({ nhat: 15, haiTroDi: 25 }),
  congAnhEm: Object.freeze({ thu1: 0, thu2: 10, thu3TroDi: 15 }),
  tranTong: 25,
  soBuoiCaGoi: 48,
});

/**
 * KHÔNG giảm theo chính sách: `thanhTien = niemYet` ở mọi mốc. Dùng cho ĐƯỜNG TẠO ĐƠN [chủ dự án chốt 27/10/2026]: *"thẻ chính sách nộp
 * theo học phần này bỏ đi, nó là 1 phần trong các chương trình khuyến mãi sẽ được add"* — mức giảm theo mốc buổi / gói trọn / anh chị em
 * KHÔNG còn do hệ thống tự cộng vào giá, mà đến từ chương trình khuyến mãi Sale chọn ở "Thêm khoản giảm".
 * Giữ nguyên `bangA` đủ các mốc 12/24/36 (giá trị 0) để luật "số buổi lẻ ⇒ từ chối" của planner không đổi. `tranTong`/`soBuoiCaGoi` lấy
 * từ PL02 (không ảnh hưởng giá khi mọi phần trăm là 0). `CHINH_SACH_PL02` vẫn còn làm dữ liệu cho bộ gợi ý chương trình và các bộ đối chiếu.
 */
export const CHINH_SACH_KHONG_GIAM: ChinhSachGia = Object.freeze({
  bangA: Object.freeze({ 12: 0, 24: 0, 36: 0 }),
  bangB: Object.freeze({ nhat: 0, haiTroDi: 0 }),
  congAnhEm: Object.freeze({ thu1: 0, thu2: 0, thu3TroDi: 0 }),
  tranTong: CHINH_SACH_PL02.tranTong,
  soBuoiCaGoi: CHINH_SACH_PL02.soBuoiCaGoi,
});

/** Giá niêm yết gói 48 buổi (đồng) theo Phụ lục 02 — dùng làm dữ liệu kiểm thử, KHÔNG phải giá prod. */
export const GIA_48_PL02: Readonly<Record<string, number>> = Object.freeze({
  Sata3: 10_560_000,
  Sata4: 11_520_000,
  Sata5: 12_480_000,
  Sata6: 13_440_000,
  Sata7: 14_400_000,
});

/**
 * Số buổi không nằm trong bảng A/B (MT-11 — CHƯA CHỐT):
 *  - `TU_CHOI`        : ném lỗi (mặc định, fail-closed)
 *  - `KHONG_GIAM`     : 0% giảm nền
 *  - `MOC_THAP_HON`   : lấy mức nền của mốc bảng A nhỏ hơn gần nhất (không có ⇒ 0%)
 *  - `NHAP_TAY`       : người duyệt nhập `phanTramNhapTay`
 */
export type QuyTacBuoiLe = "TU_CHOI" | "KHONG_GIAM" | "MOC_THAP_HON" | "NHAP_TAY";

export type LoaiMua = "FULL" | "MILESTONE" | "CUSTOM";

export type MaLoiGia =
  | "SO_BUOI_KHONG_HOP_LE"
  | "THU_TU_KHONG_HOP_LE"
  | "GIA_KHONG_HOP_LE"
  | "SO_BUOI_LE_CHUA_CO_QUY_TAC"
  | "THIEU_PHAN_TRAM_NHAP_TAY"
  | "PHAN_TRAM_KHONG_HOP_LE"
  | "PRICE_NOT_INTEGER";

export class LoiGiaTheoMoc extends Error {
  constructor(
    public readonly ma: MaLoiGia,
    message: string,
  ) {
    super(message);
    this.name = "LoiGiaTheoMoc";
  }
}

export interface DauVaoGia {
  /** Giá niêm yết gói trọn (đồng, nguyên). */
  readonly gia48: number;
  readonly soBuoi: number;
  /** Thứ tự CON trong gia đình (1 = con thứ nhất). */
  readonly thuTuCon: number;
  /** Thứ tự sản phẩm gói trọn của gia đình (1 = sản phẩm thứ nhất). Chỉ dùng khi `soBuoi` = gói trọn. */
  readonly thuTuSanPham48?: number;
  readonly chinhSach?: ChinhSachGia;
  readonly quyTacBuoiLe?: QuyTacBuoiLe;
  /** Chỉ dùng với `quyTacBuoiLe = NHAP_TAY`. */
  readonly phanTramNhapTay?: number;
}

export interface KetQuaGia {
  readonly loai: LoaiMua;
  readonly soBuoi: number;
  /** Giá niêm yết tại mốc = gia48 × n ÷ 48 (nguyên đồng). */
  readonly niemYet: number;
  readonly phanTramNen: number;
  readonly phanTramCongThem: number;
  /** Phần trăm thật sự áp sau khi cắt trần. */
  readonly phanTramApDung: number;
  /** `true` khi nền + cộng thêm vượt trần nên bị cắt. */
  readonly biCatTran: boolean;
  readonly giamGia: number;
  /** Số tiền phải đóng = niêm yết − giảm. Đây là đơn giá thực thu của lần mua (QĐ-47). */
  readonly thanhTien: number;
}

function laSoNguyenDuong(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 1;
}

function congThemTheoCon(cs: ChinhSachGia, thuTuCon: number): number {
  if (thuTuCon <= 1) return cs.congAnhEm.thu1;
  if (thuTuCon === 2) return cs.congAnhEm.thu2;
  return cs.congAnhEm.thu3TroDi;
}

/** Mức giảm nền của một số buổi KHÔNG nằm trong bảng. */
function nenChoBuoiLe(
  cs: ChinhSachGia,
  soBuoi: number,
  quyTac: QuyTacBuoiLe,
  phanTramNhapTay: number | undefined,
): number {
  switch (quyTac) {
    case "TU_CHOI":
      throw new LoiGiaTheoMoc(
        "SO_BUOI_LE_CHUA_CO_QUY_TAC",
        `Số buổi ${soBuoi} không có trong bảng giá và chưa có quy tắc cho số buổi lẻ.`,
      );
    case "KHONG_GIAM":
      return 0;
    case "MOC_THAP_HON": {
      const moc = Object.keys(cs.bangA)
        .map(Number)
        .filter((m) => m < soBuoi)
        .sort((a, b) => b - a)[0];
      return moc === undefined ? 0 : cs.bangA[moc];
    }
    case "NHAP_TAY":
      if (phanTramNhapTay === undefined) {
        throw new LoiGiaTheoMoc("THIEU_PHAN_TRAM_NHAP_TAY", "Số buổi lẻ cần người duyệt nhập phần trăm giảm.");
      }
      if (!Number.isInteger(phanTramNhapTay) || phanTramNhapTay < 0 || phanTramNhapTay > 100) {
        throw new LoiGiaTheoMoc("PHAN_TRAM_KHONG_HOP_LE", "Phần trăm giảm nhập tay phải là số nguyên 0..100.");
      }
      return phanTramNhapTay;
  }
}

/**
 * Tính giá một lần mua `soBuoi` buổi. Ném `LoiGiaTheoMoc` khi đầu vào không hợp lệ hoặc khi kết quả
 * không ra số nguyên đồng.
 */
export function tinhGiaTheoMoc(vao: DauVaoGia): KetQuaGia {
  const cs = vao.chinhSach ?? CHINH_SACH_PL02;
  const quyTac = vao.quyTacBuoiLe ?? "TU_CHOI";
  const { gia48, soBuoi } = vao;

  if (!laSoNguyenDuong(gia48)) throw new LoiGiaTheoMoc("GIA_KHONG_HOP_LE", "Giá gói trọn phải là số nguyên đồng dương.");
  if (!laSoNguyenDuong(soBuoi) || soBuoi > cs.soBuoiCaGoi) {
    throw new LoiGiaTheoMoc("SO_BUOI_KHONG_HOP_LE", `Số buổi phải là số nguyên từ 1 đến ${cs.soBuoiCaGoi}.`);
  }
  if (!laSoNguyenDuong(vao.thuTuCon)) throw new LoiGiaTheoMoc("THU_TU_KHONG_HOP_LE", "Thứ tự con phải là số nguyên từ 1.");
  const thuTuSp = vao.thuTuSanPham48 ?? 1;
  if (!laSoNguyenDuong(thuTuSp)) throw new LoiGiaTheoMoc("THU_TU_KHONG_HOP_LE", "Thứ tự sản phẩm phải là số nguyên từ 1.");

  const laGoiTron = soBuoi === cs.soBuoiCaGoi;
  const trongBangA = Object.prototype.hasOwnProperty.call(cs.bangA, soBuoi);

  const loai: LoaiMua = laGoiTron ? "FULL" : trongBangA ? "MILESTONE" : "CUSTOM";
  const phanTramNen = laGoiTron
    ? thuTuSp === 1
      ? cs.bangB.nhat
      : cs.bangB.haiTroDi
    : trongBangA
      ? cs.bangA[soBuoi]
      : nenChoBuoiLe(cs, soBuoi, quyTac, vao.phanTramNhapTay);

  const phanTramCongThem = congThemTheoCon(cs, vao.thuTuCon);
  const tong = phanTramNen + phanTramCongThem;
  const phanTramApDung = Math.min(tong, cs.tranTong);

  // Toàn số nguyên — gia48 ≤ ~1e8, × 48 × 100 ≈ 5e11 ≪ 2^53: không mất chính xác.
  const tuNiemYet = gia48 * soBuoi;
  if (tuNiemYet % cs.soBuoiCaGoi !== 0) {
    throw new LoiGiaTheoMoc("PRICE_NOT_INTEGER", `Giá niêm yết của ${soBuoi} buổi không ra số nguyên đồng.`);
  }
  const niemYet = tuNiemYet / cs.soBuoiCaGoi;

  const tuThanhTien = gia48 * soBuoi * (100 - phanTramApDung);
  const mau = cs.soBuoiCaGoi * 100;
  if (tuThanhTien % mau !== 0) {
    throw new LoiGiaTheoMoc("PRICE_NOT_INTEGER", `Số tiền phải đóng cho ${soBuoi} buổi không ra số nguyên đồng.`);
  }
  const thanhTien = tuThanhTien / mau;

  return {
    loai,
    soBuoi,
    niemYet,
    phanTramNen,
    phanTramCongThem,
    phanTramApDung,
    biCatTran: tong > cs.tranTong,
    giamGia: niemYet - thanhTien,
    thanhTien,
  };
}

// ── MỐC NGÀY ÁP GIÁ (MT-02 — CHƯA CHỐT) ─────────────────────────────────────────────────────

/** `ORDER_CREATED` = ngày tạo đơn (mặc định TẠM, trái QĐ-33); `PAYMENT_RECEIVED` = ngày tiền về. */
export type CheDoMocNgay = "ORDER_CREATED" | "PAYMENT_RECEIVED";

/**
 * Chọn ngày dùng để tra phiên bản chính sách. Hàm thuần: nhận cả hai ngày, không đọc đồng hồ.
 * `PAYMENT_RECEIVED` mà tiền chưa về ⇒ `null` (người gọi phải hiểu là "chưa chốt giá được", KHÔNG
 * được rơi về ngày tạo đơn một cách im lặng).
 */
export function chonNgayApGia(
  cheDo: CheDoMocNgay,
  ngay: { readonly taoDon: Date; readonly tienVe?: Date | null },
): Date | null {
  if (cheDo === "ORDER_CREATED") return ngay.taoDon;
  return ngay.tienVe ?? null;
}
