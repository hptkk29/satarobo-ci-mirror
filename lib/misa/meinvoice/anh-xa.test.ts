import { describe, expect, it } from "vitest";
import type { PhieuPhatHanh } from "./cong";
import { docPhanHoiPhatHanh, docPhanHoiTraCuu, kiemNguoiMua, kiemPhieu, ngayGioVn, phanLoaiMa, phieuSangMisa } from "./anh-xa";

// Hình dạng dữ liệu THẬT: đơn giá trước thuế có phần lẻ (20.000.000 / 1,08), dòng KCT kèm.
function phieuMau(ghiDe: Partial<PhieuPhatHanh> = {}): PhieuPhatHanh {
  return {
    refId: "7d3c1e2a-5b4f-4c8e-9a01-2b3c4d5e6f70",
    kyHieu: "1C26TSR",
    mstNguoiBan: "0402145678",
    ngayHoaDon: new Date("2026-09-30T00:00:00.000Z"),
    nguoiMua: { hoTen: "Nguyễn Văn A", donVi: null, mst: null, diaChi: "Đà Nẵng", email: "ph@example.com" },
    hinhThucThanhToan: "TM/CK",
    dong: [
      { stt: 1, ten: "Học phí Sata 4", donViTinh: "Khoá", soLuong: 1, donGia: 18518518.52, thanhTien: 18518519, thueSuat: 8, tienThue: 1481481 },
      { stt: 2, ten: "Bộ kit robot", donViTinh: "Bộ", soLuong: 2, donGia: 500000, thanhTien: 1000000, thueSuat: 10, tienThue: 100000 },
      { stt: 3, ten: "Học phí Sata 1", donViTinh: "Khoá", soLuong: 1, donGia: 3000000, thanhTien: 3000000, thueSuat: "KCT", tienThue: 0 },
      { stt: 4, ten: "Giáo trình", donViTinh: "Cuốn", soLuong: 1, donGia: 200000, thanhTien: 200000, thueSuat: 8, tienThue: 16000 },
    ],
    tongTruocThue: 22718519,
    tongThue: 1597481,
    tongThanhToan: 24316000,
    soTienBangChu: "Hai mươi bốn triệu ba trăm mười sáu nghìn đồng.",
    ...ghiDe,
  };
}

describe("[MEI-AX] ánh xạ PhieuPhatHanh → publishHSM", () => {
  it("[MEI-AX-01] phiếu mẫu hợp lệ", () => {
    expect(kiemPhieu(phieuMau())).toBeNull();
  });

  it("[MEI-AX-02] tổng khớp, cặp OC/quy đổi bằng nhau, chiết khấu 0", () => {
    const g = phieuSangMisa(phieuMau()).OriginalInvoiceData;
    expect(g.TotalAmountWithoutVATOC).toBe(22718519);
    expect(g.TotalSaleAmountOC).toBe(22718519);
    expect(g.TotalVATAmountOC).toBe(1597481);
    expect(g.TotalAmountOC).toBe(24316000);
    expect(g.TotalAmount).toBe(g.TotalAmountOC);
    expect(g.TotalDiscountAmountOC).toBe(0);
    const sumDong = g.OriginalInvoiceDetail.reduce((s, d) => s + d.AmountWithoutVATOC, 0);
    const sumThue = g.OriginalInvoiceDetail.reduce((s, d) => s + d.VATAmountOC, 0);
    expect(sumDong).toBe(g.TotalAmountWithoutVATOC);
    expect(sumThue).toBe(g.TotalVATAmountOC);
    expect(g.OriginalInvoiceDetail.every((d) => d.ItemType === 1)).toBe(true);
    expect(g.OriginalInvoiceDetail[0]!.UnitPrice).toBe(18518518.52);
  });

  it("[MEI-AX-03] TaxRateInfo nhóm theo thuế suất (8% gộp 2 dòng), KCT là nhóm riêng", () => {
    const g = phieuSangMisa(phieuMau()).OriginalInvoiceData;
    expect(g.TaxRateInfo).toEqual([
      { VATRateName: "8%", AmountWithoutVATOC: 18718519, VATAmountOC: 1497481 },
      { VATRateName: "10%", AmountWithoutVATOC: 1000000, VATAmountOC: 100000 },
      { VATRateName: "KCT", AmountWithoutVATOC: 3000000, VATAmountOC: 0 },
    ]);
    expect(g.OriginalInvoiceDetail.map((d) => d.VATRateName)).toEqual(["8%", "10%", "KCT", "8%"]);
    expect(g.IsTaxReduction43).toBe(true);
  });

  it("[MEI-AX-04] KKKNT / 0% / 5% ra đúng tên; không có 8% ⇒ không gắn IsTaxReduction43", () => {
    const p = phieuMau({
      dong: [
        { stt: 1, ten: "A", donViTinh: "Cái", soLuong: 1, donGia: 100, thanhTien: 100, thueSuat: "KKKNT", tienThue: 0 },
        { stt: 2, ten: "B", donViTinh: "Cái", soLuong: 1, donGia: 100, thanhTien: 100, thueSuat: 0, tienThue: 0 },
        { stt: 3, ten: "C", donViTinh: "Cái", soLuong: 1, donGia: 100, thanhTien: 100, thueSuat: 5, tienThue: 5 },
      ],
      tongTruocThue: 300,
      tongThue: 5,
      tongThanhToan: 305,
    });
    expect(kiemPhieu(p)).toBeNull();
    const g = phieuSangMisa(p).OriginalInvoiceData;
    expect(g.OriginalInvoiceDetail.map((d) => d.VATRateName)).toEqual(["KKKNT", "0%", "5%"]);
    expect(g.IsTaxReduction43).toBeUndefined();
  });

  it("[MEI-AX-05] ngày theo giờ VN: 17:30Z 30/09 ⇒ 01/10; @db.Date nửa đêm UTC ⇒ giữ ngày", () => {
    expect(ngayGioVn(new Date("2026-09-30T17:30:00Z"))).toBe("2026-10-01T00:00:00+07:00");
    expect(ngayGioVn(new Date("2026-09-30T00:00:00Z"))).toBe("2026-09-30T00:00:00+07:00");
    expect(ngayGioVn(new Date("2026-09-30T16:59:59Z"))).toBe("2026-09-30T00:00:00+07:00");
    expect(phieuSangMisa(phieuMau()).OriginalInvoiceData.InvDate).toBe("2026-09-30T00:00:00+07:00");
  });

  it("[MEI-AX-06] IsSendEmail LUÔN false, email chỉ để lưu; OptionUserDefined VND 0 chữ số", () => {
    const el = phieuSangMisa(phieuMau());
    expect(el.IsSendEmail).toBe(false);
    expect(el).not.toHaveProperty("ReceiverEmail");
    expect(el.OriginalInvoiceData.BuyerEmail).toBe("ph@example.com");
    expect(el.OriginalInvoiceData.OptionUserDefined.MainCurrency).toBe("VND");
    expect(el.OriginalInvoiceData.OptionUserDefined.AmountDecimalDigits).toBe("0");
    expect(el.RefID).toBe(el.OriginalInvoiceData.RefID);
  });

  it("[MEI-AX-07] tên loại HĐ theo ký hiệu; cá nhân không có BuyerLegalName/TaxCode", () => {
    const g = phieuSangMisa(phieuMau()).OriginalInvoiceData;
    expect(g.InvoiceName).toBe("Hóa đơn giá trị gia tăng");
    expect(g.InvSeries).toBe("1C26TSR");
    expect(g).not.toHaveProperty("BuyerLegalName");
    expect(g).not.toHaveProperty("BuyerTaxCode");
    expect(g.BuyerFullName).toBe("Nguyễn Văn A");
    const ban = phieuSangMisa(phieuMau({ kyHieu: "2K26TSR" })).OriginalInvoiceData;
    expect(ban.InvoiceName).toBe("Hóa đơn bán hàng");
  });

  it("[MEI-AX-08] kiemPhieu chặn tổng lệch, KCT có thuế, stt đứt, MST người mua thiếu đơn vị", () => {
    expect(kiemPhieu(phieuMau({ tongThanhToan: 24316001 }))).toMatch(/Tổng thanh toán/);
    expect(kiemPhieu(phieuMau({ tongTruocThue: 1 }))).toMatch(/trước thuế/);
    const p = phieuMau();
    p.dong[2] = { ...p.dong[2]!, tienThue: 1 };
    expect(kiemPhieu(p)).toMatch(/KCT/);
    const q = phieuMau();
    q.dong[1] = { ...q.dong[1]!, stt: 5 };
    expect(kiemPhieu(q)).toMatch(/liên tục/);
    expect(
      kiemPhieu(phieuMau({ nguoiMua: { hoTen: "A", donVi: null, mst: "0401234567", diaChi: null, email: null } })),
    ).toMatch(/MST/);
    expect(kiemPhieu(phieuMau({ kyHieu: "1X26TSR" }))).toMatch(/Ký hiệu/);
  });
  it("[MEI-AX-09] luật người mua ở MỘT hàm: kiemPhieu trả ĐÚNG câu của kiemNguoiMua (nút + máy trạng thái cùng đọc)", () => {
    const sai = { hoTen: "A", donVi: null, mst: null, diaChi: "Đà Nẵng", email: "a@b.c" };
    expect(kiemNguoiMua(sai)).toMatch(/^Email người mua không hợp lệ với MISA: /);
    expect(kiemPhieu(phieuMau({ nguoiMua: sai }))).toBe(kiemNguoiMua(sai));
    expect(kiemNguoiMua({ ...sai, email: "a@b.co" })).toBeNull();
    expect(kiemNguoiMua({ ...sai, email: "a@b.museum" })).toBeNull();
    expect(kiemNguoiMua({ ...sai, email: "a@b.academy" })).toMatch(/Email/);
    expect(kiemNguoiMua({ ...sai, email: null, donVi: "Hộ KD", mst: "049189012543" })).toMatch(/^MST người mua không hợp lệ với MISA: /);
    expect(kiemNguoiMua({ ...sai, email: null, donVi: "Cty", mst: "0401234567-001" })).toBeNull();
  });
});

const REF = "7d3c1e2a-5b4f-4c8e-9a01-2b3c4d5e6f70";

function phanHoi(data: unknown, ngoai: Record<string, unknown> = {}) {
  return { Success: true, ErrorCode: null, Errors: [], Data: typeof data === "string" ? data : JSON.stringify(data), ...ngoai };
}

describe("[MEI-PH] đọc phản hồi publishHSM", () => {
  it("[MEI-PH-01] thành công ⇒ DA_PHAT_HANH (Data là CHUỖI JSON; ký hiệu ghép mẫu số)", () => {
    const kq = docPhanHoiPhatHanh(
      phanHoi([
        { RefID: REF.toUpperCase(), TransactionID: "QWIGTN63E_", InvTemplateNo: "1", InvSeries: "C26TSR", InvNo: "00000321", InvDate: "2026-09-30T00:00:00+07:00", ErrorCode: "" },
      ]),
      { refId: REF, kyHieu: "1C26TSR" },
    );
    expect(kq).toEqual({
      loai: "DA_PHAT_HANH",
      refId: REF,
      kyHieu: "1C26TSR",
      soHoaDon: "00000321",
      ngayPhatHanh: new Date("2026-09-29T17:00:00.000Z"),
      maTraCuu: "QWIGTN63E_",
    });
  });

  it("[MEI-PH-02] Data chuỗi hỏng ⇒ KHONG_RO", () => {
    expect(docPhanHoiPhatHanh(phanHoi("[{RefID:"), { refId: REF, kyHieu: "1C26TSR" }).loai).toBe("KHONG_RO");
    expect(docPhanHoiPhatHanh("không phải json", { refId: REF, kyHieu: "1C26TSR" }).loai).toBe("KHONG_RO");
  });

  it("[MEI-PH-03] mã lỗi DỮ LIỆU trong Data ⇒ TU_CHOI kèm mã", () => {
    const kq = docPhanHoiPhatHanh(phanHoi([{ RefID: REF, ErrorCode: "InvalidTaxCode" }]), { refId: REF, kyHieu: "1C26TSR" });
    expect(kq).toMatchObject({ loai: "TU_CHOI", ma: "InvalidTaxCode" });
    const k2 = docPhanHoiPhatHanh(phanHoi([{ RefID: REF, ErrorCode: "RequireInfo_BuyerAddress" }]), { refId: REF, kyHieu: "1C26TSR" });
    expect(k2).toMatchObject({ loai: "TU_CHOI", ma: "RequireInfo_BuyerAddress" });
    const k3 = docPhanHoiPhatHanh({ Success: false, ErrorCode: "LicenseInfo_OutOfInvoice", Errors: [] }, { refId: REF, kyHieu: "1C26TSR" });
    expect(k3).toMatchObject({ loai: "TU_CHOI", ma: "LicenseInfo_OutOfInvoice" });
  });

  it("[MEI-PH-04] InvoiceDuplicated (trong Data hoặc chuỗi thô) ⇒ TRUNG, KHÔNG phải lỗi", () => {
    expect(docPhanHoiPhatHanh(phanHoi([{ RefID: REF, ErrorCode: "InvoiceDuplicated" }]), { refId: REF, kyHieu: "1C26TSR" }).loai).toBe("TRUNG");
    expect(
      docPhanHoiPhatHanh(phanHoi("thông tin hóa đơn đã phát hành, errorcode: InvoiceDuplicated"), { refId: REF, kyHieu: "1C26TSR" }).loai,
    ).toBe("TRUNG");
  });

  it("[MEI-PH-05] mã lạ / Exception / số không liên tục / Success=false không mã ⇒ KHONG_RO", () => {
    for (const ma of ["MaMoiChuaAiBiet", "Exception", "InvoiceNumberNotContinuous", "InvalidSignature"]) {
      expect(docPhanHoiPhatHanh(phanHoi([{ RefID: REF, ErrorCode: ma }]), { refId: REF, kyHieu: "1C26TSR" }).loai, ma).toBe("KHONG_RO");
    }
    expect(docPhanHoiPhatHanh({ Success: false }, { refId: REF, kyHieu: "1C26TSR" }).loai).toBe("KHONG_RO");
  });

  it("[MEI-PH-06] Data không có đúng RefID, hoặc thiếu số hoá đơn ⇒ KHONG_RO", () => {
    expect(docPhanHoiPhatHanh(phanHoi([{ RefID: "khac", InvNo: "1", TransactionID: "x", InvDate: "2026-09-30" }]), { refId: REF, kyHieu: "1C26TSR" }).loai).toBe("KHONG_RO");
    expect(docPhanHoiPhatHanh(phanHoi([{ RefID: REF, ErrorCode: "", TransactionID: "x" }]), { refId: REF, kyHieu: "1C26TSR" }).loai).toBe("KHONG_RO");
  });

  it("[MEI-PH-07] phân loại mã token", () => {
    expect(phanLoaiMa("TokenExpiredCode")).toBe("TOKEN");
    expect(phanLoaiMa("RequireInfo_")).toBe("KHAC");
  });
});

describe("[MEI-TC] đọc phản hồi tra cứu", () => {
  it("[MEI-TC-01] có RefID ⇒ DA_PHAT_HANH; mảng rỗng ⇒ CHUA_CO", () => {
    const d = [{ RefID: REF, InvNo: "00000001", InvDate: "2026-09-30T00:00:00+07:00", InvSeries: "C26TSR", InvTempl: "1", TransactionID: "A6TPCXEA_W", PublishStatus: 1, EInvoiceStatus: 1 }];
    expect(docPhanHoiTraCuu(phanHoi(d), REF)).toMatchObject({ loai: "DA_PHAT_HANH", soHoaDon: "00000001", kyHieu: "1C26TSR", maTraCuu: "A6TPCXEA_W" });
    expect(docPhanHoiTraCuu(phanHoi([]), REF)).toEqual({ loai: "CHUA_CO" });
  });

  it("[MEI-TC-02] lỗi / chuỗi hỏng / trạng thái Xoá ⇒ KHONG_RO (không bao giờ CHUA_CO khi không chắc)", () => {
    expect(docPhanHoiTraCuu({ Success: false, ErrorCode: "Exception" }, REF).loai).toBe("KHONG_RO");
    expect(docPhanHoiTraCuu(phanHoi("[{"), REF).loai).toBe("KHONG_RO");
    expect(docPhanHoiTraCuu(phanHoi({ a: 1 }), REF).loai).toBe("KHONG_RO");
    expect(docPhanHoiTraCuu(phanHoi([{ RefID: REF, InvNo: "1", TransactionID: "x", InvDate: "2026-09-30", EInvoiceStatus: 2 }]), REF).loai).toBe("KHONG_RO");
  });
});
