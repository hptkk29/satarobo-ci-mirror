// Ca [PHM-0x] — dựng `PhieuPhatHanh` cho MISA meInvoice (bước 1, 30/09/2026). THUẦN.
//
// Luật canh:
//   · phiếu dựng từ CHÍNH trang phiếu thu chờ (`dungPhieuThuData`) — dòng, thuế, tên dòng trùng khớp tờ
//     kế toán vẫn in ra để gõ lại ở MISA (không có phép tính thứ hai);
//   · `tongThanhToan` === `tongTien` RÒNG của hoá đơn, lệch ⇒ NÉM (tờ đã ký không sửa được);
//   · pháp nhân không phải MISA (NEW_VISION = VIN HOADON) ⇒ từ chối.
import { describe, expect, it } from "vitest";
import { CAU_HINH_HOA_DON_MAC_DINH, laPhapNhanMisa, type CauHinhHoaDon, type PhapNhan } from "./phap-nhan";
import { dungPhieuThuData } from "./phieu-thu-data";
import { KIEU_GIA } from "./tinh-hoa-don";
import { dungPhieuPhatHanh, hinhThucMisa, LoiDungPhieu, phieuTuJson, thueSuatMisa } from "./phieu-phat-hanh";
import type { DonChoHoaDon } from "./nguoi-mua";
import { nguoiMuaChoDon } from "./nguoi-mua";

const SATA = CAU_HINH_HOA_DON_MAC_DINH.phapNhan.find((p) => p.ma === "SATA_ROBO")!;
const NEW_VISION = CAU_HINH_HOA_DON_MAC_DINH.phapNhan.find((p) => p.ma === "NEW_VISION")!;
const NGAY = new Date("2026-09-30T00:00:00Z");

const DON: DonChoHoaDon & { code: string; type: string } = {
  code: "ORD-260930-000001",
  type: "COURSE",
  customerName: "Nguyễn Văn Phụ",
  customerPhone: "0905123456",
  customerEmail: "ph@example.com",
  customerAddress: "12 Lê Lợi",
  customerWard: "Hải Châu",
  customerCity: "Đà Nẵng",
  customerCccd: null,
  invoiceBuyerName: null,
  invoiceCompanyName: null,
  invoiceTaxCode: null,
  invoiceEmail: null,
};

/** Một trang phiếu chờ — ĐÚNG hàm route phiếu chờ dùng. */
const trang = (soTien: number, cauHinh: CauHinhHoaDon = CAU_HINH_HOA_DON_MAC_DINH, phapNhan: PhapNhan = SATA) =>
  dungPhieuThuData({
    maPhieu: null,
    ngayLap: "30/09/2026",
    phapNhan,
    cauHinh,
    don: DON,
    soTien,
    hinhThucThanhToan: "Chuyển khoản",
    tenKhoa: "Sata 4",
    tenHocVien: "Bé An",
    tenLop: "S4-01",
    nguoiThu: null,
    dongDon: [],
  });

const phieu = (o: Partial<Parameters<typeof dungPhieuPhatHanh>[0]> = {}) =>
  dungPhieuPhatHanh({
    refId: "ref-1",
    phapNhan: SATA,
    ngayHoaDon: NGAY,
    nguoiMua: nguoiMuaChoDon(DON),
    trang: [trang(4_320_000)],
    phuongThuc: [{ ma: "sepay", nhan: "Chuyển khoản (SePay)" }],
    tongTien: 4_320_000,
    ...o,
  });

function maLoi(f: () => unknown): string | null {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof LoiDungPhieu ? e.ma : String(e);
  }
}

describe("[PHM-01] dựng phiếu từ CHÍNH trang phiếu thu chờ", () => {
  it("một khoản 4.320.000 (8% đã gồm thuế) ⇒ dòng + tổng trùng tờ phiếu chờ; tổng thanh toán === tongTien", () => {
    const t = trang(4_320_000);
    const p = phieu();
    expect(p.refId).toBe("ref-1");
    expect(p.kyHieu).toBe("1C26TSR");
    expect(p.mstNguoiBan).toBe("0402301783");
    expect(p.dong).toHaveLength(1);
    // Không phép tính thứ hai: từng số ĐÚNG như trang phiếu chờ in.
    expect(p.dong[0]).toMatchObject({
      stt: 1,
      ten: t.dong[0]!.ten,
      donViTinh: t.dong[0]!.donViTinh,
      soLuong: t.dong[0]!.soLuong,
      donGia: t.dong[0]!.donGia,
      thanhTien: t.dong[0]!.thanhTien,
      thueSuat: 8,
      tienThue: t.dong[0]!.tienThue,
    });
    expect(p.dong[0]!.ten).toMatch(/Khoá học Sata 4 — HV Bé An/);
    expect(p.tongTruocThue).toBe(t.tong.thanhTienTruocThue);
    expect(p.tongThue).toBe(t.tong.tienThue);
    expect(p.tongThanhToan).toBe(4_320_000);
    expect(p.soTienBangChu).toBe(t.soTienBangChu);
    expect(p.hinhThucThanhToan).toBe("Chuyển khoản");
    expect(p.nguoiMua).toMatchObject({ hoTen: "Nguyễn Văn Phụ", donVi: null, mst: null, email: "ph@example.com" });
    expect(p.nguoiMua.diaChi).toContain("Đà Nẵng");
  });

  it("hai khoản (hai trang) ⇒ hai dòng STT liên tục, tổng cộng dồn = Σ số ròng", () => {
    const p = phieu({ trang: [trang(3_000_000), trang(1_500_000)], tongTien: 4_500_000 });
    expect(p.dong.map((d) => d.stt)).toEqual([1, 2]);
    expect(p.tongThanhToan).toBe(4_500_000);
    expect(p.tongTruocThue + p.tongThue).toBe(4_500_000);
  });

  it("ký hiệu theo NĂM của ngày hoá đơn (mẫu 1C26TSR, ngày 2027 ⇒ 1C27TSR)", () => {
    expect(phieu({ ngayHoaDon: new Date("2027-01-02T00:00:00Z") }).kyHieu).toBe("1C27TSR");
  });
});

describe("[PHM-02] tổng LỆCH số đã thu ⇒ NÉM, không phát hành", () => {
  it("tongTien khác tổng tờ (tiền vừa đổi) ⇒ LECH_TONG", () => {
    expect(maLoi(() => phieu({ tongTien: 4_319_999 }))).toBe("LECH_TONG");
  });
  it("thuế khai 'CHƯA GỒM THUẾ' cho loại đơn ⇒ tờ cộng thêm thuế ⇒ LECH_TONG (làm tay)", () => {
    const cauHinh: CauHinhHoaDon = {
      ...CAU_HINH_HOA_DON_MAC_DINH,
      thue: [{ loaiDon: "TAT_CA", thueSuat: 8, kieuGia: KIEU_GIA.CHUA_GOM_THUE }],
    };
    expect(maLoi(() => phieu({ trang: [trang(4_000_000, cauHinh)], tongTien: 4_000_000 }))).toBe("LECH_TONG");
  });
  it("đối chứng: cùng tờ, tongTien đúng ⇒ không ném", () => {
    expect(maLoi(() => phieu())).toBeNull();
  });
  it("không trang nào ⇒ RONG", () => {
    expect(maLoi(() => phieu({ trang: [], tongTien: 0 }))).toBe("RONG");
  });
});

describe("[PHM-03] pháp nhân không phải MISA ⇒ từ chối", () => {
  it("NEW_VISION (VIN HOADON) ⇒ PHAP_NHAN_KHONG_MISA; SATA_ROBO (MISA meInvoice) ⇒ được", () => {
    expect(laPhapNhanMisa(NEW_VISION)).toBe(false);
    expect(laPhapNhanMisa(SATA)).toBe(true);
    expect(maLoi(() => phieu({ phapNhan: NEW_VISION, trang: [trang(4_320_000, CAU_HINH_HOA_DON_MAC_DINH, NEW_VISION)] }))).toBe(
      "PHAP_NHAN_KHONG_MISA",
    );
  });
  it("khai lơ mơ ('misa') không tính là MISA — so ĐÚNG giá trị", () => {
    expect(laPhapNhanMisa({ phanMem: "misa" })).toBe(false);
    expect(laPhapNhanMisa(null)).toBe(false);
  });
  it("pháp nhân MISA mà chưa khai ký hiệu ⇒ THIEU_KY_HIEU", () => {
    expect(maLoi(() => phieu({ phapNhan: { ...SATA, kyHieu: undefined } }))).toBe("THIEU_KY_HIEU");
  });
});

describe("[PHM-04] thuế suất + hình thức thanh toán + JSON", () => {
  it("chỉ 0 · 5 · 8 · 10 — mức lạ ném, không làm tròn", () => {
    expect([0, 5, 8, 10].map(thueSuatMisa)).toEqual([0, 5, 8, 10]);
    expect(maLoi(() => thueSuatMisa(7))).toBe("THUE_SUAT_LA");
  });
  it("hình thức: toàn tiền mặt · toàn chuyển khoản · trộn", () => {
    expect(hinhThucMisa([{ ma: "CASH", nhan: "Tiền mặt" }])).toBe("Tiền mặt");
    expect(hinhThucMisa([{ ma: "CASH_CS1", nhan: "Thu tại quầy" }])).toBe("Tiền mặt");
    expect(hinhThucMisa([{ ma: "BANK_CS1", nhan: "Chuyển khoản VCB" }])).toBe("Chuyển khoản");
    expect(hinhThucMisa([{ ma: "CASH", nhan: "Tiền mặt" }, { ma: "payos", nhan: "payOS" }])).toBe("TM/CK");
  });
  it("phiếu → JSON (cột misaPhieu) → phiếu: y hệt, ngày về lại Date; JSON hỏng ⇒ ném", () => {
    const p = phieu();
    const lai = phieuTuJson(JSON.parse(JSON.stringify(p)));
    expect(lai).toEqual(p);
    expect(lai.ngayHoaDon).toBeInstanceOf(Date);
    expect(() => phieuTuJson({ refId: "x" })).toThrow();
    expect(() => phieuTuJson(null)).toThrow();
  });
});
