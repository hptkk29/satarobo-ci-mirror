import { describe, expect, it } from "vitest";
import { LoiBaoGia, taoBaoGiaDong } from "./bao-gia-dong";
import { CHINH_SACH_PL02, GIA_48_PL02, tinhGiaTheoMoc } from "./tinh-gia-theo-moc";

const taoDon = new Date("2026-12-30T03:00:00Z");
const tienVe = new Date("2027-01-02T03:00:00Z");
const co = { cheDoMocNgay: "ORDER_CREATED" as const, ngay: { taoDon } };

describe("[BGD] báo giá một dòng đơn", () => {
  it("[BGD-01] khớp tinhGiaTheoMoc và đóng gói snapshot đầy đủ", () => {
    const b = taoBaoGiaDong({ gia48: GIA_48_PL02.Sata3, soBuoi: 24, thuTuCon: 1, ...co });
    expect(b.gia).toEqual(tinhGiaTheoMoc({ gia48: GIA_48_PL02.Sata3, soBuoi: 24, thuTuCon: 1 }));
    expect(b.pricingSnapshot).toMatchObject({
      gia48: 10_560_000, soBuoi: 24, loai: "MILESTONE", niemYet: 5_280_000, phanTramApDung: 5, thanhTien: 5_016_000,
      thuTuCon: 1, thuTuSanPham48: 1, cheDoMocNgay: "ORDER_CREATED", ngayApGia: taoDon.toISOString(),
    });
    expect(b.canDuyet).toBe(false);
  });

  it("[BGD-02] snapshot chụp CẢ chính sách đã dùng — đổi chính sách sau này không làm đổi đơn cũ", () => {
    const b = taoBaoGiaDong({ gia48: GIA_48_PL02.Sata3, soBuoi: 12, thuTuCon: 1, ...co });
    expect(b.pricingSnapshot.chinhSach.tranTong).toBe(25);
    expect(b.pricingSnapshot.chinhSach.bangA[24]).toBe(5);
  });

  it("[BGD-02b] chính sách TUỲ BIẾN truyền vào là chính sách được chụp (không phải bản mặc định)", () => {
    const cs = { ...CHINH_SACH_PL02, bangA: { 12: 7, 24: 8, 36: 9 }, tranTong: 30 };
    const b = taoBaoGiaDong({ gia48: GIA_48_PL02.Sata3, soBuoi: 24, thuTuCon: 1, chinhSach: cs, ...co });
    expect(b.pricingSnapshot.chinhSach).toEqual(cs);
    expect(b.pricingSnapshot.phanTramNen).toBe(8);
  });

  it("[BGD-03] số buổi lẻ ⇒ canDuyet = true; 12/24/36/48 ⇒ false", () => {
    const lẻ = taoBaoGiaDong({ gia48: GIA_48_PL02.Sata4, soBuoi: 18, thuTuCon: 1, quyTacBuoiLe: "KHONG_GIAM", ...co });
    expect(lẻ.canDuyet).toBe(true);
    for (const n of [12, 24, 36, 48]) expect(taoBaoGiaDong({ gia48: GIA_48_PL02.Sata4, soBuoi: n, thuTuCon: 1, ...co }).canDuyet, String(n)).toBe(false);
  });

  it("[BGD-04] số buổi lẻ không khai quy tắc ⇒ ném (fail-closed), không báo giá", () => {
    expect(() => taoBaoGiaDong({ gia48: GIA_48_PL02.Sata4, soBuoi: 18, thuTuCon: 1, ...co })).toThrow(/quy tắc/);
  });

  it("[BGD-05] ngày tạo đơn 30/12, tiền về 02/01: ngày áp giá theo ĐÚNG chế độ", () => {
    const a = taoBaoGiaDong({ gia48: GIA_48_PL02.Sata4, soBuoi: 12, thuTuCon: 1, cheDoMocNgay: "ORDER_CREATED", ngay: { taoDon, tienVe } });
    const b = taoBaoGiaDong({ gia48: GIA_48_PL02.Sata4, soBuoi: 12, thuTuCon: 1, cheDoMocNgay: "PAYMENT_RECEIVED", ngay: { taoDon, tienVe } });
    expect(a.pricingSnapshot.ngayApGia).toBe(taoDon.toISOString());
    expect(b.pricingSnapshot.ngayApGia).toBe(tienVe.toISOString());
  });

  it("[BGD-06] mốc ngày tiền về mà tiền CHƯA về ⇒ ném CHUA_CO_NGAY_AP_GIA, KHÔNG rơi về ngày tạo đơn", () => {
    let ma = "";
    try {
      taoBaoGiaDong({ gia48: GIA_48_PL02.Sata4, soBuoi: 12, thuTuCon: 1, cheDoMocNgay: "PAYMENT_RECEIVED", ngay: { taoDon } });
    } catch (e) {
      ma = e instanceof LoiBaoGia ? e.ma : "KHAC";
    }
    expect(ma).toBe("CHUA_CO_NGAY_AP_GIA");
  });

  it("[BGD-07] thứ tự con và sản phẩm đi vào snapshot", () => {
    const b = taoBaoGiaDong({ gia48: GIA_48_PL02.Sata7, soBuoi: 48, thuTuCon: 3, thuTuSanPham48: 2, ...co });
    expect(b.pricingSnapshot).toMatchObject({ thuTuCon: 3, thuTuSanPham48: 2, phanTramApDung: 25, biCatTran: true, thanhTien: 10_800_000 });
  });
});
