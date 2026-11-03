import { describe, expect, it } from "vitest";
import type { PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";
import {
  MA_TU_CHAN,
  chuanHoaMa,
  docDoiTuong,
  docPhanHoiPhatHanh,
  docPhanHoiTep,
  docPhanHoiTraCuu,
  giaiMaTepVin,
  kiemPhieuVin,
  maHinhThucThanhToan,
  maThueVin,
  ngayLapVin,
  phieuSangVin,
  tachKyHieu,
} from "./anh-xa";

function phieu(ghiDe: Partial<PhieuPhatHanh> = {}): PhieuPhatHanh {
  return {
    refId: "ref-001",
    kyHieu: "1C26TSR",
    mstNguoiBan: "0402145678",
    ngayHoaDon: new Date("2026-09-30T00:00:00.000Z"),
    nguoiMua: { hoTen: "Nguyễn Văn A", donVi: null, mst: null, diaChi: "Đà Nẵng", email: "a@b.vn" },
    hinhThucThanhToan: "Chuyển khoản",
    dong: [
      { stt: 1, ten: "Học phí", donViTinh: "Khoá", soLuong: 1, donGia: 5_000_000, thanhTien: 5_000_000, thueSuat: "KCT", tienThue: 0 },
    ],
    tongTruocThue: 5_000_000,
    tongThue: 0,
    tongThanhToan: 5_000_000,
    soTienBangChu: "Năm triệu đồng.",
    ...ghiDe,
  };
}

describe("[VIN-AX] kiểm phiếu trước khi gửi", () => {
  it("[VIN-AX-01] phiếu mẫu hợp lệ; tách ký hiệu: mauso = chữ số đầu, kyhieu = 6 ký tự còn lại, chuẩn hoá hoa/khoảng trắng", () => {
    expect(kiemPhieuVin(phieu())).toBeNull();
    expect(tachKyHieu("1C26TSR")).toEqual({ mauSo: "1", kyHieu6: "C26TSR" });
    expect(tachKyHieu("  2k26abc ")).toEqual({ mauSo: "2", kyHieu6: "K26ABC" });
    for (const sai of ["", "KY-HIEU-SAI", "3C26TSR", "1X26TSR", "1C2TSR", "1C26TSRX"]) expect(tachKyHieu(sai), sai).toBeNull();
  });

  it("[VIN-AX-02] từng điều kiện tự chặn ra câu lỗi riêng (không in lại PII)", () => {
    const ca: Array<readonly [string, Partial<PhieuPhatHanh>, RegExp]> = [
      ["thiếu refId", { refId: " " }, /RefID/],
      ["refId > 50", { refId: "x".repeat(51) }, /50/],
      ["ký hiệu sai", { kyHieu: "KY-HIEU-SAI" }, /Ký hiệu/],
      ["MST bán sai", { mstNguoiBan: "123" }, /MST người bán/],
      ["ngày lỗi", { ngayHoaDon: new Date("x") }, /Ngày hoá đơn/],
      ["thanh toán lạ", { hinhThucThanhToan: "Quẹt thẻ" }, /Hình thức thanh toán/],
      ["tiền mặt > 20tr", { hinhThucThanhToan: "Tiền mặt", dong: [dong(20_000_001)], tongTruocThue: 20_000_001, tongThanhToan: 20_000_001 }, /20 triệu/],
      ["thiếu tên mua", { nguoiMua: { hoTen: null, donVi: null, mst: null, diaChi: null, email: null } }, /tên người mua/],
      ["MST mua sai", { nguoiMua: { hoTen: "A", donVi: null, mst: "12", diaChi: null, email: null } }, /MST người mua/],
      ["email sai", { nguoiMua: { hoTen: "A", donVi: null, mst: null, diaChi: null, email: "khong-hop-le" } }, /Email/],
      ["email > 50", { nguoiMua: { hoTen: "A", donVi: null, mst: null, diaChi: null, email: `${"a".repeat(46)}@b.vn` } }, /50/],
      ["không dòng", { dong: [], tongTruocThue: 0, tongThanhToan: 0 }, /không có dòng/],
      ["tổng lệch", { tongTruocThue: 1, tongThanhToan: 1 }, /Tổng trước thuế/],
      ["KCT mà có thuế", { dong: [{ ...dong(5_000_000), tienThue: 10 }], tongThue: 10, tongThanhToan: 5_000_010 }, /không chịu thuế/],
      ["HĐ bán hàng có thuế", { kyHieu: "2C26TSR", dong: [{ ...dong(1_000_000), thueSuat: 10, tienThue: 100_000 }], tongTruocThue: 1_000_000, tongThue: 100_000, tongThanhToan: 1_100_000 }, /bán hàng/],
    ];
    for (const [nhan, ghiDe, mau] of ca) {
      const loi = kiemPhieuVin(phieu(ghiDe));
      expect(loi, nhan).not.toBeNull();
      expect(String(loi), nhan).toMatch(mau);
      expect(String(loi), nhan).not.toContain("a@b.vn");
    }
  });

  it("[VIN-AX-03] đúng NGƯỠNG 20 triệu: bằng 20.000.000 vẫn được tiền mặt; chuyển khoản và TM/CK không bị chặn", () => {
    const d = { dong: [dong(20_000_000)], tongTruocThue: 20_000_000, tongThanhToan: 20_000_000 };
    expect(kiemPhieuVin(phieu({ ...d, hinhThucThanhToan: "Tiền mặt" }))).toBeNull();
    const lon = { dong: [dong(30_000_000)], tongTruocThue: 30_000_000, tongThanhToan: 30_000_000 };
    expect(kiemPhieuVin(phieu({ ...lon, hinhThucThanhToan: "Chuyển khoản" }))).toBeNull();
    expect(kiemPhieuVin(phieu({ ...lon, hinhThucThanhToan: "TM/CK" }))).toBeNull();
  });
});

function dong(tien: number): PhieuPhatHanh["dong"][number] {
  return { stt: 1, ten: "Học phí", donViTinh: "Khoá", soLuong: 1, donGia: tien, thanhTien: tien, thueSuat: "KCT", tienThue: 0 };
}

describe("[VIN-AX] ánh xạ phiếu → body VIN (đối chiếu PDF v13.0)", () => {
  it("[VIN-AX-04] hình thức thanh toán → mã số; thuế → mã VIN (KCT -1, KKKNT -2)", () => {
    expect(maHinhThucThanhToan("Tiền mặt")).toEqual({ ma: 1, ten: "Tiền mặt" });
    expect(maHinhThucThanhToan("  CHUYỂN KHOẢN ")).toEqual({ ma: 2, ten: "Chuyển khoản" });
    expect(maHinhThucThanhToan("TM/CK")?.ma).toBe(3);
    expect(maHinhThucThanhToan("tm / ck")?.ma).toBe(3);
    expect(maHinhThucThanhToan("Thẻ")).toBeNull();
    expect([0, 5, 8, 10, "KCT", "KKKNT"].map((t) => maThueVin(t as never))).toEqual(["0", "5", "8", "10", "-1", "-2"]);
  });

  it("[VIN-AX-05] body HĐ GTGT (mẫu số 1): khoá đúng tên trong PDF; ma_hoadon = refId; mathue/tienthue/dsthuesuat có mặt", () => {
    const body = phieuSangVin(
      phieu({
        nguoiMua: { hoTen: " Nguyễn Văn A ", donVi: "Công ty X", mst: "0102030405", diaChi: " Đà Nẵng ", email: "a@b.vn" },
        dong: [
          { stt: 1, ten: "Học phí", donViTinh: "Khoá", soLuong: 1, donGia: 1_851_851.85185, thanhTien: 1_851_852, thueSuat: 8, tienThue: 148_148 },
          { stt: 2, ten: "Giáo trình", donViTinh: "Bộ", soLuong: 2, donGia: 500_000, thanhTien: 1_000_000, thueSuat: 8, tienThue: 80_000 },
          { stt: 3, ten: "Phí", donViTinh: "Lần", soLuong: 1, donGia: 100_000, thanhTien: 100_000, thueSuat: "KCT", tienThue: 0 },
        ],
        tongTruocThue: 2_951_852,
        tongThue: 228_148,
        tongThanhToan: 3_180_000,
      }),
    );
    expect(body).toMatchObject({
      doanhnghiep_mst: "0402145678",
      mauso: "1",
      kyhieu: "C26TSR",
      ma_hoadon: "ref-001",
      ngaylap: "2026-09-30 00:00:00",
      dnmua_ten: "Công ty X",
      dnmua_tennguoimua: "Nguyễn Văn A",
      dnmua_mst: "0102030405",
      dnmua_diachi: "Đà Nẵng",
      dnmua_email: "a@b.vn",
      thanhtoan_phuongthuc: 2,
      thanhtoan_phuongthuc_ten: "Chuyển khoản",
      tiente_ma: "VND",
      tongtien_chuavat: 2_951_852,
      tienthue: 228_148,
      tongtien_covat: 3_180_000,
    });
    expect(body.dschitiet).toHaveLength(3);
    expect(body.dschitiet[0]).toMatchObject({ stt: 1, hanghoa_loai: 1, dongia: 1_851_851.85, tongtien_chuathue: 1_851_852, mathue: "8", tongtien_cothue: 2_000_000 });
    expect(body.dschitiet[2]).toMatchObject({ mathue: "-1", tongtien_cothue: 100_000 });
    expect(body.dsthuesuat).toEqual([
      { mathue: "8", tongtien_chiuthue: 2_851_852, tongtien_thue: 228_148 },
      { mathue: "-1", tongtien_chiuthue: 100_000, tongtien_thue: 0 },
    ]);
  });

  it("[VIN-AX-06] HĐ bán hàng (mẫu số 2): KHÔNG có mathue/tienthue/dsthuesuat; tongtien_cothue = thành tiền", () => {
    const body = phieuSangVin(phieu({ kyHieu: "2C26TSR" }));
    expect(body.mauso).toBe("2");
    expect(body).not.toHaveProperty("tienthue");
    expect(body).not.toHaveProperty("dsthuesuat");
    expect(body.dschitiet[0]).not.toHaveProperty("mathue");
    expect(body.dschitiet[0]!.tongtien_cothue).toBe(5_000_000);
  });

  it("[VIN-AX-07] trường người mua rỗng KHÔNG được gửi (không gửi chuỗi rỗng); người mua cá nhân không mang dnmua_ten", () => {
    const body = phieuSangVin(phieu({ nguoiMua: { hoTen: "A", donVi: "  ", mst: "", diaChi: null, email: null } }));
    for (const k of ["dnmua_ten", "dnmua_mst", "dnmua_diachi", "dnmua_email"]) expect(body, k).not.toHaveProperty(k);
    expect(body.dnmua_tennguoimua).toBe("A");
  });

  it("[VIN-AX-08] ngày lập theo lịch VN: nửa đêm UTC và 17:30Z (đã sang ngày hôm sau ở VN) — không phụ thuộc múi giờ máy", () => {
    expect(ngayLapVin(new Date("2026-09-30T00:00:00.000Z"))).toBe("2026-09-30 00:00:00");
    expect(ngayLapVin(new Date("2026-09-30T17:30:00.000Z"))).toBe("2026-10-01 00:00:00");
    expect(ngayLapVin(new Date("2026-12-31T16:59:59.000Z"))).toBe("2026-12-31 00:00:00");
    expect(ngayLapVin(new Date("2026-12-31T17:00:00.000Z"))).toBe("2027-01-01 00:00:00");
  });

  it("[VIN-AX-09] phieuSangVin gọi sai thứ tự (phiếu chưa qua kiểm) ⇒ ném, không gửi dữ liệu rác", () => {
    expect(() => phieuSangVin(phieu({ kyHieu: "SAI" }))).toThrow(/kiemPhieuVin/);
  });
});

describe("[VIN-AX] đọc phản hồi — ba kết quả, KHONG_RO là mặc định của mọi thứ không chắc", () => {
  const p = { refId: "ref-001", kyHieu: "1C26TSR", ngayHoaDon: new Date("2026-09-30T00:00:00.000Z") };
  const OK = { maketqua: "31", motaketqua: "Phát hành thành công", mauso: "1", kyhieu: "C26TSR", sohoadon: "0000123", trangthai: "3", ngayky: "2026-09-30 10:15:00", magiaodich: "GD-1" };

  it("[VIN-AX-10] thành công (01 hoặc 31, kể cả số 1 không đệm) ⇒ DA_PHAT_HANH đủ số/ký hiệu/mã tra cứu; ngày ký đọc theo giờ VN", () => {
    for (const ma of ["31", "01", 1, "1"]) {
      const kq = docPhanHoiPhatHanh({ ...OK, maketqua: ma }, p);
      expect(kq, String(ma)).toEqual({
        loai: "DA_PHAT_HANH",
        refId: "ref-001",
        kyHieu: "1C26TSR",
        soHoaDon: "0000123",
        ngayPhatHanh: new Date("2026-09-30T03:15:00.000Z"),
        maTraCuu: "GD-1",
      });
    }
  });

  it("[VIN-AX-11] khoá JSON hoa/thường lẫn lộn và bọc trong result vẫn đọc được", () => {
    expect(docPhanHoiPhatHanh({ MaKetQua: "31", SoHoaDon: "9", MauSo: "1", KyHieu: "C26TSR", MaGiaoDich: "x", magiaodich: "GD-2", sohoadon: "9" }, p).loai).toBe("DA_PHAT_HANH");
    expect(docDoiTuong({ result: { duLieu: "abc", maKetQua: "01" } })).toMatchObject({ maketqua: "01", dulieu: "abc" });
    expect(docDoiTuong([1, 2])).toBeNull();
    expect(docDoiTuong("x")).toBeNull();
  });

  it("[VIN-AX-12] báo thành công nhưng THIẾU số hoá đơn / mã giao dịch / chưa ký / phản hồi hỏng ⇒ KHONG_RO (không bao giờ DA_PHAT_HANH một nửa)", () => {
    const bo = (k: string) => {
      const con: Record<string, unknown> = { ...OK };
      delete con[k];
      return con;
    };
    expect(docPhanHoiPhatHanh(bo("sohoadon"), p).loai).toBe("KHONG_RO");
    expect(docPhanHoiPhatHanh(bo("magiaodich"), p).loai).toBe("KHONG_RO");
    for (const t of ["0", "1", "2"]) expect(docPhanHoiPhatHanh({ ...OK, trangthai: t }, p).loai, `trangthai ${t}`).toBe("KHONG_RO");
    for (const hong of [null, "x", [], undefined, 42]) expect(docPhanHoiPhatHanh(hong, p).loai).toBe("KHONG_RO");
  });

  it("[VIN-AX-13] trùng (03 / 26) ⇒ TRUNG (nơi gọi tra cứu), KHÔNG phải TU_CHOI", () => {
    for (const ma of ["03", "26"]) expect(docPhanHoiPhatHanh({ maketqua: ma }, p).loai, ma).toBe("TRUNG");
  });

  it("[VIN-AX-14] TU_CHOI chỉ cho lỗi dữ liệu/cấu hình chắc chắn trước khi lưu; lỗi ký/cấp số/chứng thư/đang xử lý ⇒ KHONG_RO", () => {
    for (const ma of ["02", "04", "08", "12", "14", "18", "20", "21", "28", "42", "43", "44", "50"]) {
      const kq = docPhanHoiPhatHanh({ maketqua: ma, motaketqua: "x" }, p);
      expect(kq.loai, ma).toBe("TU_CHOI");
      if (kq.loai === "TU_CHOI") expect(kq.ma, ma).toBe(`VIN_${ma}`);
    }
    for (const ma of ["13", "27", "16", "17", "22", "23", "51", "-99", "19", "32", "33", "34", "49", "00", "99", "", "abc"]) {
      expect(docPhanHoiPhatHanh({ maketqua: ma }, p).loai, `mã ${ma}`).toBe("KHONG_RO");
    }
  });

  it("[VIN-AX-15] tra cứu: 11 ⇒ CHUA_CO; có + đã ký ⇒ DA_PHAT_HANH; chưa ký / khoá khác / thiếu trường / mã lạ ⇒ KHONG_RO", () => {
    const co = { maketqua: "01", mahoadon: "ref-001", mauso: "1", kyhieu: "C26TSR", sohoadon: "0000123", ngaylap: "2026-09-30 00:00:00", trangthai: "3", ngayky: "2026-09-30 10:15:00", magiaodich: "GD-1" };
    expect(docPhanHoiTraCuu({ maketqua: "11" }, "ref-001")).toEqual({ loai: "CHUA_CO" });
    expect(docPhanHoiTraCuu(co, "ref-001")).toMatchObject({ loai: "DA_PHAT_HANH", refId: "ref-001", soHoaDon: "0000123", maTraCuu: "GD-1", kyHieu: "1C26TSR" });
    expect(docPhanHoiTraCuu({ ...co, trangthai: "1" }, "ref-001").loai).toBe("KHONG_RO");
    expect(docPhanHoiTraCuu({ ...co, mahoadon: "ref-khac" }, "ref-001").loai).toBe("KHONG_RO");
    expect(docPhanHoiTraCuu({ ...co, sohoadon: "" }, "ref-001").loai).toBe("KHONG_RO");
    expect(docPhanHoiTraCuu({ ...co, kyhieu: "" }, "ref-001").loai).toBe("KHONG_RO");
    expect(docPhanHoiTraCuu({ ...co, ngayky: "", ngaylap: "" }, "ref-001").loai).toBe("KHONG_RO");
    expect(docPhanHoiTraCuu({ maketqua: "35" }, "ref-001").loai).toBe("KHONG_RO");
    expect(docPhanHoiTraCuu(null, "ref-001").loai).toBe("KHONG_RO");
  });

  it("[VIN-AX-16] tải tệp: PDF phải '%PDF', XML phải '<' (kể cả khi về chuỗi thô); tệp hỏng/rỗng/mã lỗi ⇒ lỗi rõ", () => {
    const pdf = Buffer.from("%PDF-1.4\nx").toString("base64");
    const xml = Buffer.from("<a/>").toString("base64");
    expect(docPhanHoiTep({ maketqua: "01", base64pdf: pdf }, "pdf")).toEqual({ ok: true, base64: pdf });
    expect(docPhanHoiTep({ Maketqua: "01", Base64xml: xml }, "xml")).toEqual({ ok: true, base64: xml });
    expect(docPhanHoiTep({ maketqua: "11" }, "pdf").ok).toBe(false);
    expect(docPhanHoiTep({ maketqua: "01", base64pdf: "  " }, "pdf").ok).toBe(false);
    expect(docPhanHoiTep({ maketqua: "01", base64xml: xml }, "pdf").ok).toBe(false); // sai khoá cho loại
    expect(Buffer.from(giaiMaTepVin(pdf, "pdf")).toString("latin1").startsWith("%PDF")).toBe(true);
    expect(Buffer.from(giaiMaTepVin(xml, "xml")).toString("utf8")).toBe("<a/>");
    expect(Buffer.from(giaiMaTepVin("<b/>", "xml")).toString("utf8")).toBe("<b/>");
    expect(() => giaiMaTepVin(Buffer.from("khong phai pdf").toString("base64"), "pdf")).toThrow(/PDF/);
    expect(() => giaiMaTepVin(Buffer.from("khong phai xml").toString("base64"), "xml")).toThrow(/XML/);
    expect(() => giaiMaTepVin("%%%", "pdf")).toThrow();
  });

  it("[VIN-AX-17] chuanHoaMa: một chữ số được đệm 0; -99 và chuỗi lạ giữ nguyên; MA_TU_CHAN cố định (nơi gọi dựa vào)", () => {
    expect([chuanHoaMa(1), chuanHoaMa("1"), chuanHoaMa("31"), chuanHoaMa("-99"), chuanHoaMa(null), chuanHoaMa(" 01 ")]).toEqual(["01", "01", "31", "-99", "", "01"]);
    expect(MA_TU_CHAN).toBe("DU_LIEU_PHIEU_KHONG_HOP_LE");
  });
});
