// Ca [HD-*] — số học hoá đơn GTGT.
//
// BA CA ĐẦU DỰNG LẠI NGUYÊN VĂN BA TỜ HOÁ ĐƠN THẬT (E:\websatarobo data\hoadon). Mọi con
// số kỳ vọng dưới đây đọc từ giấy, KHÔNG phải tính ra rồi chép lại — đó là điểm khác nhau
// giữa một ca kiểm và một phép lặp lại chính mình.
import { describe, it, expect } from "vitest";
import {
  KIEU_GIA,
  tinhDongHoaDon,
  tongHoaDon,
} from "@/lib/finance/hoa-don/tinh-hoa-don";

describe("[HD-01..03] dựng lại ba tờ hoá đơn thật", () => {
  it("[HD-01] 1C26TSR-86 · MISA · thuê robot · GIÁ ĐÃ GỒM THUẾ", () => {
    // Giấy: đơn giá 1.851.851,85 · thành tiền 1.851.852 · 8% · thuế 148.148 · cộng 2.000.000
    const d = tinhDongHoaDon({
      ten: "Cho thuê Bộ Robot Beta (132 linh kiện) + Cảm biến màu",
      donViTinh: "Bộ",
      soLuong: 1,
      soTien: 2_000_000,
      thueSuat: 8,
      kieuGia: KIEU_GIA.DA_GOM_THUE,
    });
    expect(d.donGia.toFixed(2)).toBe("1851851.85");
    expect(d.thanhTien).toBe(1_851_852);
    expect(d.tienThue).toBe(148_148);
    expect(d.congTien).toBe(2_000_000);
  });

  it("[HD-02] 1C26TSR-127 · MISA · học phí · GIÁ CHƯA GỒM THUẾ", () => {
    // Giấy: đơn giá 4.000.000,00 · thành tiền 4.000.000 · 8% · thuế 320.000 · cộng 4.320.000
    // CÙNG pháp nhân, CÙNG ký hiệu với [HD-01] mà quy ước NGƯỢC — đây là lý do `kieuGia`
    // phải là tham số kế toán khai được, không phải hằng trong mã.
    const d = tinhDongHoaDon({
      ten: "Học phí đợt 2 Khoá học Sata 4",
      donViTinh: "Khóa",
      soLuong: 1,
      soTien: 4_000_000,
      thueSuat: 8,
      kieuGia: KIEU_GIA.CHUA_GOM_THUE,
    });
    expect(d.donGia).toBe(4_000_000);
    expect(d.thanhTien).toBe(4_000_000);
    expect(d.tienThue).toBe(320_000);
    expect(d.congTien).toBe(4_320_000);
  });

  it("[HD-03] 1C26MNV-13 · VIN HOADON · New Vision · GIÁ ĐÃ GỒM THUẾ", () => {
    // Giấy: đơn giá 8.311.111 · cộng tiền hàng 8.311.111 · 8% · thuế 664.889 · tổng 8.976.000
    const d = tinhDongHoaDon({
      ten: "Khoá học Sata3- HV Nguyễn Đức Huy Hoàng",
      donViTinh: "Khoá",
      soLuong: 1,
      soTien: 8_976_000,
      thueSuat: 8,
      kieuGia: KIEU_GIA.DA_GOM_THUE,
    });
    expect(d.thanhTien).toBe(8_311_111);
    expect(d.tienThue).toBe(664_889);
    expect(d.congTien).toBe(8_976_000);
  });
});

describe("[HD-04..06] bất biến của từng quy ước", () => {
  it("[HD-04] ĐÃ GỒM THUẾ: thành tiền + thuế === ĐÚNG số khách trả, với MỌI số", () => {
    // Đây là lý do `tienThue` tính bằng PHẦN DƯ chứ không phải `round(thanhTien × thuế)`.
    // Tờ hoá đơn cộng ra một số khác số tiền đã thu là thứ kế toán thuế bắt ngay.
    for (const soTien of [
      1, 7, 999, 1_000, 100_003, 2_000_000, 4_444_444, 8_976_000, 123_456_789,
    ]) {
      for (const thueSuat of [0, 5, 8, 10]) {
        const d = tinhDongHoaDon({
          ten: "x",
          donViTinh: "x",
          soLuong: 1,
          soTien,
          thueSuat,
          kieuGia: KIEU_GIA.DA_GOM_THUE,
        });
        expect(
          d.thanhTien + d.tienThue,
          `${soTien}đ @ ${thueSuat}%`,
        ).toBe(soTien);
        expect(d.congTien).toBe(soTien);
      }
    }
  });

  it("[HD-05] CHƯA GỒM THUẾ: khách trả NHIỀU HƠN số trên đơn", () => {
    const d = tinhDongHoaDon({
      ten: "x",
      donViTinh: "x",
      soLuong: 1,
      soTien: 5_200_000,
      thueSuat: 8,
      kieuGia: KIEU_GIA.CHUA_GOM_THUE,
    });
    expect(d.thanhTien).toBe(5_200_000);
    expect(d.congTien).toBe(5_616_000);
    // Cùng 5.200.000 mà hai quy ước lệch nhau 416.000đ TRÊN MỖI ĐƠN.
    const daGom = tinhDongHoaDon({
      ten: "x",
      donViTinh: "x",
      soLuong: 1,
      soTien: 5_200_000,
      thueSuat: 8,
      kieuGia: KIEU_GIA.DA_GOM_THUE,
    });
    expect(d.congTien - daGom.congTien).toBe(416_000);
  });

  it("[HD-06] thuế suất 0% — hai quy ước trùng nhau, không nhánh nào nổ", () => {
    for (const kieuGia of [KIEU_GIA.DA_GOM_THUE, KIEU_GIA.CHUA_GOM_THUE]) {
      const d = tinhDongHoaDon({
        ten: "x",
        donViTinh: "x",
        soLuong: 1,
        soTien: 1_000_000,
        thueSuat: 0,
        kieuGia,
      });
      expect(d.thanhTien).toBe(1_000_000);
      expect(d.tienThue).toBe(0);
      expect(d.congTien).toBe(1_000_000);
    }
  });
});

describe("[HD-07..09] đơn giá và số lượng", () => {
  it("[HD-07] đơn giá = số tiền / số lượng, GIỮ phần lẻ để in đúng giấy", () => {
    // MISA in "1.851.851,85". Làm tròn đơn giá ở đây là in sai tờ đã phát hành.
    const d = tinhDongHoaDon({
      ten: "x",
      donViTinh: "Bộ",
      soLuong: 3,
      soTien: 2_000_000,
      thueSuat: 8,
      kieuGia: KIEU_GIA.DA_GOM_THUE,
    });
    // ⚠️ Kỳ vọng là THƯƠNG ĐÚNG (2.000.000 / 1,08 / 3), KHÔNG phải "1.851.851,85 / 3":
    // 1.851.851,85 là con số ĐÃ LÀM TRÒN ĐỂ IN. Lấy số in ra rồi chia tiếp là mang sai số
    // của khâu hiển thị vào phép tính — bản đầu của ca này làm đúng như vậy và lệch
    // 0,0006đ. Chia từ số gốc, làm tròn chỉ ở khâu in.
    expect(d.donGia).toBeCloseTo(2_000_000 / 1.08 / 3, 6);
    // Nhưng THÀNH TIỀN vẫn là số nguyên đồng — cột tổng không có phần lẻ.
    expect(Number.isInteger(d.thanhTien)).toBe(true);
    expect(Number.isInteger(d.tienThue)).toBe(true);
  });

  it("[HD-08] số lượng 0 hoặc âm coi như 1 — không chia cho 0", () => {
    for (const soLuong of [0, -2]) {
      const d = tinhDongHoaDon({
        ten: "x",
        donViTinh: "x",
        soLuong,
        soTien: 100_000,
        thueSuat: 10,
        kieuGia: KIEU_GIA.CHUA_GOM_THUE,
      });
      expect(d.soLuong).toBe(1);
      expect(Number.isFinite(d.donGia)).toBe(true);
      expect(d.donGia).toBe(100_000);
    }
  });

  it("[HD-09] số tiền âm coi như 0 — hoá đơn không có dòng âm", () => {
    const d = tinhDongHoaDon({
      ten: "x",
      donViTinh: "x",
      soLuong: 1,
      soTien: -500_000,
      thueSuat: 8,
      kieuGia: KIEU_GIA.DA_GOM_THUE,
    });
    expect(d.thanhTien).toBe(0);
    expect(d.congTien).toBe(0);
  });
});

describe("[HD-10..11] tongHoaDon — khối 'Tổng hợp' của mẫu MISA", () => {
  it("[HD-10] tách theo TỪNG mức thuế suất, sắp tăng dần", () => {
    // Mẫu MISA có hẳn bốn dòng 0% / 5% / 8% / 10%; gộp chung là in sai tờ giấy.
    const dong = [
      tinhDongHoaDon({
        ten: "Học phí",
        donViTinh: "Khoá",
        soLuong: 1,
        soTien: 4_000_000,
        thueSuat: 8,
        kieuGia: KIEU_GIA.CHUA_GOM_THUE,
      }),
      tinhDongHoaDon({
        ten: "Bộ robot",
        donViTinh: "Bộ",
        soLuong: 1,
        soTien: 1_000_000,
        thueSuat: 10,
        kieuGia: KIEU_GIA.CHUA_GOM_THUE,
      }),
    ];
    const t = tongHoaDon(dong);
    expect(t.theoThueSuat.map((n) => n.thueSuat)).toEqual([8, 10]);
    expect(t.thanhTienTruocThue).toBe(5_000_000);
    expect(t.tienThue).toBe(420_000); // 320.000 + 100.000
    expect(t.congTienThanhToan).toBe(5_420_000);
  });

  it("[HD-11] hai dòng CÙNG thuế suất gộp vào một nhóm", () => {
    const dong = [
      tinhDongHoaDon({
        ten: "Đợt 1",
        donViTinh: "Khoá",
        soLuong: 1,
        soTien: 2_000_000,
        thueSuat: 8,
        kieuGia: KIEU_GIA.DA_GOM_THUE,
      }),
      tinhDongHoaDon({
        ten: "Đợt 2",
        donViTinh: "Khoá",
        soLuong: 1,
        soTien: 2_000_000,
        thueSuat: 8,
        kieuGia: KIEU_GIA.DA_GOM_THUE,
      }),
    ];
    const t = tongHoaDon(dong);
    expect(t.theoThueSuat).toHaveLength(1);
    expect(t.congTienThanhToan).toBe(4_000_000);
  });

  it("[HD-12] hoá đơn rỗng ra số 0, không nổ", () => {
    const t = tongHoaDon([]);
    expect(t).toMatchObject({
      thanhTienTruocThue: 0,
      tienThue: 0,
      congTienThanhToan: 0,
      theoThueSuat: [],
    });
  });
});
