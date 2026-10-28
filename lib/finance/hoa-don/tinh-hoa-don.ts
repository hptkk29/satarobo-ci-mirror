// lib/finance/hoa-don/tinh-hoa-don.ts — số học của một hoá đơn GTGT. THUẦN: không Prisma,
// không DB, không đọc đồng hồ.
//
// ─────────────────────────────────────────────────────────────────────────────
// ĐO TỪ BA HOÁ ĐƠN THẬT (E:\websatarobo data\hoadon, 14/09/2026)
//
// Ba tờ, HAI pháp nhân, HAI phần mềm phát hành — và **hai quy ước thuế NGƯỢC NHAU**,
// trong đó hai tờ ngược nhau nằm cùng MỘT pháp nhân, cùng MỘT ký hiệu `1C26TSR`:
//
//   ┌ 1C26TSR-86 · MISA · Sata Robo · "Cho thuê Bộ Robot Beta"
//   │   đơn giá 1.851.851,85 · thành tiền 1.851.852 · thuế 8% 148.148 · CỘNG 2.000.000
//   │   ⇒ số khách trả là **2.000.000 tròn**, giá trên hoá đơn CHIA NGƯỢC ra: GIÁ ĐÃ GỒM THUẾ
//   │
//   ├ 1C26TSR-127 · MISA · Sata Robo · "Học phí đợt 2 Khoá học Sata 4"
//   │   đơn giá 4.000.000 · thành tiền 4.000.000 · thuế 8% 320.000 · CỘNG 4.320.000
//   │   ⇒ số trên đơn là **giá TRƯỚC thuế**, thuế CỘNG THÊM: GIÁ CHƯA GỒM THUẾ
//   │
//   └ 1C26MNV-13 · VIN HOADON · New Vision · "Khoá học Sata3 – HV Nguyễn Đức Huy Hoàng"
//       đơn giá 8.311.111 · cộng tiền hàng 8.311.111 · thuế 8% 664.889 · TỔNG 8.976.000
//       ⇒ 8.976.000 / 1,08 = 8.311.111,11 ⇒ lại là GIÁ ĐÃ GỒM THUẾ
//
// Khác biệt này KHÔNG phải tiểu tiết trình bày: cùng một khoá 4.000.000đ, phụ huynh trả
// **4.000.000** (thuế nằm trong) hay **4.320.000** (thuế cộng thêm) — chênh 320.000đ trên
// mỗi đơn. Không có cách nào suy ra quy ước đúng từ dữ liệu trong máy.
//
// ⇒ QUY ƯỚC LÀ THAM SỐ, KHÔNG PHẢI HẰNG. Kế toán khai theo từng loại đơn ở Cấu hình vận
// hành (`kieuGia` + `thueSuat`). Chốt cứng một kiểu là bắt dev sửa mã mỗi lần BGĐ đổi —
// đúng thứ chủ dự án đã yêu cầu tránh: "sau khi bàn giao thì dev không cần phải đụng gì
// nhiều nữa".
//
// ⚠️ HAI PHÁP NHÂN là chuyện có thật, không phải dữ liệu bẩn:
//   · CÔNG TY CỔ PHẦN CÔNG NGHỆ GIÁO DỤC SATA ROBO — MST 0402301783 — 258 Lê Thanh Nghị
//   · CÔNG TY CỔ PHẦN CÔNG NGHỆ GIÁO DỤC NEW VISION — MST 0402341070 — 114–116 Hoàng Diệu
// Địa chỉ thứ hai TRÙNG CS2. Đừng suy pháp nhân từ địa chỉ cơ sở — xem `phap-nhan.ts`.
// ─────────────────────────────────────────────────────────────────────────────

export const KIEU_GIA = {
  /**
   * Số tiền ghi trên đơn ĐÃ GỒM thuế. Khách trả đúng số đó; giá trước thuế trên hoá đơn
   * là số chia ngược ra. (1C26TSR-86 · 1C26MNV-13)
   */
  DA_GOM_THUE: "DA_GOM_THUE",
  /**
   * Số tiền ghi trên đơn là giá TRƯỚC thuế. Thuế cộng thêm ⇒ khách trả NHIỀU HƠN số trên
   * đơn. (1C26TSR-127)
   */
  CHUA_GOM_THUE: "CHUA_GOM_THUE",
} as const;
export type KieuGia = (typeof KIEU_GIA)[keyof typeof KIEU_GIA];

export type DongHoaDon = {
  ten: string;
  donViTinh: string;
  soLuong: number;
  /**
   * Đơn giá TRƯỚC thuế. Cố ý để `number` có phần lẻ: hoá đơn MISA in đúng
   * "1.851.851,85". Làm tròn ở đây là in sai tờ giấy đã phát hành.
   */
  donGia: number;
  /** Thành tiền trước thuế — SỐ NGUYÊN đồng, đây mới là số đi vào cột tổng. */
  thanhTien: number;
  /** 0 · 5 · 8 · 10 (phần trăm). */
  thueSuat: number;
  tienThue: number;
  /** thanhTien + tienThue. Với `DA_GOM_THUE` phải BẰNG ĐÚNG số tiền khách trả. */
  congTien: number;
};

/**
 * Dựng MỘT dòng hoá đơn từ số tiền trên đơn hàng.
 *
 * ⚠️ `tienThue` của `DA_GOM_THUE` tính bằng PHẦN DƯ (`soTien − thanhTien`), KHÔNG phải
 * `round(thanhTien × thuế)`. Hai cách cho cùng kết quả ở cả ba tờ đo được, nhưng chỉ cách
 * phần-dư BẢO ĐẢM `thanhTien + tienThue === soTien` với mọi số. Sai lệch 1đ ở đây là tờ
 * hoá đơn cộng ra một số khác số tiền đã thu — thứ kế toán thuế bắt ngay.
 */
export function tinhDongHoaDon(input: {
  ten: string;
  donViTinh: string;
  soLuong: number;
  /** Số tiền của dòng này trên ĐƠN HÀNG (cả dòng, không phải đơn giá). */
  soTien: number;
  thueSuat: number;
  kieuGia: KieuGia;
}): DongHoaDon {
  const { ten, donViTinh, thueSuat, kieuGia } = input;
  const soLuong = input.soLuong > 0 ? input.soLuong : 1;
  const soTien = Math.max(0, Math.round(input.soTien));
  const heSo = 1 + thueSuat / 100;

  if (kieuGia === KIEU_GIA.DA_GOM_THUE) {
    const thanhTien = Math.round(soTien / heSo);
    return {
      ten,
      donViTinh,
      soLuong,
      donGia: soTien / heSo / soLuong,
      thanhTien,
      thueSuat,
      tienThue: soTien - thanhTien,
      congTien: soTien,
    };
  }

  const tienThue = Math.round((soTien * thueSuat) / 100);
  return {
    ten,
    donViTinh,
    soLuong,
    donGia: soTien / soLuong,
    thanhTien: soTien,
    thueSuat,
    tienThue,
    congTien: soTien + tienThue,
  };
}

export type NhomTheoThueSuat = {
  thueSuat: number;
  thanhTienTruocThue: number;
  tienThue: number;
  congTienThanhToan: number;
};

export type TongHoaDon = {
  thanhTienTruocThue: number;
  tienThue: number;
  congTienThanhToan: number;
  /** Mẫu MISA có hẳn một khối "Tổng hợp" tách theo từng mức thuế suất. */
  theoThueSuat: NhomTheoThueSuat[];
};

/** Cộng tờ hoá đơn. Nhóm theo thuế suất để in đúng khối "Tổng hợp" của mẫu MISA. */
export function tongHoaDon(dong: DongHoaDon[]): TongHoaDon {
  const nhom = new Map<number, NhomTheoThueSuat>();
  for (const d of dong) {
    const cu = nhom.get(d.thueSuat) ?? {
      thueSuat: d.thueSuat,
      thanhTienTruocThue: 0,
      tienThue: 0,
      congTienThanhToan: 0,
    };
    cu.thanhTienTruocThue += d.thanhTien;
    cu.tienThue += d.tienThue;
    cu.congTienThanhToan += d.congTien;
    nhom.set(d.thueSuat, cu);
  }
  const theoThueSuat = [...nhom.values()].sort((a, b) => a.thueSuat - b.thueSuat);
  return {
    thanhTienTruocThue: theoThueSuat.reduce((s, n) => s + n.thanhTienTruocThue, 0),
    tienThue: theoThueSuat.reduce((s, n) => s + n.tienThue, 0),
    congTienThanhToan: theoThueSuat.reduce((s, n) => s + n.congTienThanhToan, 0),
    theoThueSuat,
  };
}
