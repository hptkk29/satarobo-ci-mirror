// lib/pricing/bao-gia-dong.ts — BÁO GIÁ MỘT DÒNG ĐƠN theo phạm vi học. THUẦN.
//
// 🔴 CHỈ ĐƯỜNG TẠO ĐƠN THỦ CÔNG gọi hàm này (qua `lib/pricing/ke-hoach-dong-don.ts` ← `lib/orders/pham-vi`, nối 11/10/2026,
// DƯỚI CỜ `billing.scopePurchaseEnabled` TẮT mặc định). `convert-lead`, `backfill-order`, `ghi-giao-dich-cu`, `hoc-bu/case-db` vẫn
// chạy đường cũ (kế hoạch nhiều đợt / `OrderInstallment`) và KHÔNG được gọi hàm này.
//
// Hàm này làm hai việc mà form và máy chủ phải dùng CHUNG:
//   1. gọi `tinhGiaTheoMoc` (không làm tròn) và bọc kết quả thành `pricingSnapshot` để lưu lên dòng đơn;
//   2. nói rõ dòng này có CẦN DUYỆT không (số buổi lẻ — QĐ-02), để máy chủ không tin cờ từ client.
//
// Giá niêm yết gói trọn (`gia48`) PHẢI do máy chủ tra từ `Course.price`/phiên bản chính sách, KHÔNG nhận từ
// client — client cầm cả giá lẫn số buổi là cầm cả hai vế của phép so (xem đầu `lib/orders/hinh-thuc-lop.ts`).
import {
  CHINH_SACH_PL02,
  chonNgayApGia,
  tinhGiaTheoMoc,
  type ChinhSachGia,
  type CheDoMocNgay,
  type KetQuaGia,
  type QuyTacBuoiLe,
} from "./tinh-gia-theo-moc";

export interface DauVaoBaoGia {
  readonly gia48: number;
  readonly soBuoi: number;
  readonly thuTuCon: number;
  readonly thuTuSanPham48?: number;
  readonly chinhSach?: ChinhSachGia;
  readonly quyTacBuoiLe?: QuyTacBuoiLe;
  readonly phanTramNhapTay?: number;
  readonly cheDoMocNgay: CheDoMocNgay;
  readonly ngay: { readonly taoDon: Date; readonly tienVe?: Date | null };
}

export interface BaoGiaDong {
  readonly gia: KetQuaGia;
  /** Lưu nguyên lên `OrderItem.pricingSnapshot` / `StudyEntitlement.pricingSnapshot`. */
  readonly pricingSnapshot: {
    readonly gia48: number;
    readonly soBuoi: number;
    readonly loai: KetQuaGia["loai"];
    readonly niemYet: number;
    readonly phanTramNen: number;
    readonly phanTramCongThem: number;
    readonly phanTramApDung: number;
    readonly biCatTran: boolean;
    readonly thanhTien: number;
    readonly thuTuCon: number;
    readonly thuTuSanPham48: number;
    readonly quyTacBuoiLe: QuyTacBuoiLe;
    readonly cheDoMocNgay: CheDoMocNgay;
    /** ISO của ngày dùng để chọn chính sách (`basisDate`). */
    readonly ngayApGia: string;
    readonly chinhSach: ChinhSachGia;
  };
  /** `true` ⇒ số buổi lẻ, cần người có `entitlements:approve-exception` duyệt trước khi chốt (QĐ-02). */
  readonly canDuyet: boolean;
}

export class LoiBaoGia extends Error {
  constructor(
    public readonly ma: "CHUA_CO_NGAY_AP_GIA",
    message: string,
  ) {
    super(message);
    this.name = "LoiBaoGia";
  }
}

export function taoBaoGiaDong(vao: DauVaoBaoGia): BaoGiaDong {
  const ngayAp = chonNgayApGia(vao.cheDoMocNgay, vao.ngay);
  // Mốc "ngày tiền về" mà tiền chưa về ⇒ CHƯA chốt giá được. Không rơi về ngày tạo đơn một cách im lặng.
  if (ngayAp === null) throw new LoiBaoGia("CHUA_CO_NGAY_AP_GIA", "Chưa có ngày tiền về nên chưa chốt được giá.");
  const chinhSach = vao.chinhSach ?? CHINH_SACH_PL02;
  const quyTac = vao.quyTacBuoiLe ?? "TU_CHOI";
  const gia = tinhGiaTheoMoc({
    gia48: vao.gia48,
    soBuoi: vao.soBuoi,
    thuTuCon: vao.thuTuCon,
    thuTuSanPham48: vao.thuTuSanPham48,
    chinhSach,
    quyTacBuoiLe: quyTac,
    phanTramNhapTay: vao.phanTramNhapTay,
  });
  return {
    gia,
    canDuyet: gia.loai === "CUSTOM",
    pricingSnapshot: {
      gia48: vao.gia48,
      soBuoi: gia.soBuoi,
      loai: gia.loai,
      niemYet: gia.niemYet,
      phanTramNen: gia.phanTramNen,
      phanTramCongThem: gia.phanTramCongThem,
      phanTramApDung: gia.phanTramApDung,
      biCatTran: gia.biCatTran,
      thanhTien: gia.thanhTien,
      thuTuCon: vao.thuTuCon,
      thuTuSanPham48: vao.thuTuSanPham48 ?? 1,
      quyTacBuoiLe: quyTac,
      cheDoMocNgay: vao.cheDoMocNgay,
      ngayApGia: ngayAp.toISOString(),
      chinhSach,
    },
  };
}
