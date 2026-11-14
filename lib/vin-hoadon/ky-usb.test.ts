import { beforeEach, describe, expect, it } from "vitest";
import type { PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";
import type { CauHinhVin } from "./cau-hinh";
import { _xoaBoNhoTokenVinChoTest, taoCongVin, type FetchLike } from "./http";
import {
  BIEN_AN_TOAN_PHIEN_MS,
  docPhanHoiLuuNhap,
  docPhanHoiTaiXmlChuaKy,
  HAN_PHIEN_KY_USB_MS,
  kiemXmlDaKy,
  phienConDungDuoc,
} from "./ky-usb";
import { kyXmlGiaChoTest, TAI_KHOAN_VIN_GIA, taoMayChuVinGia, xmlChuaKyGia } from "./may-chu-vin-gia";

// Ca [KYU-*] — ký USB token với VIN-HOADON: lưu nháp → tải XML chưa ký → (máy kế toán ký) → gửi XML đã ký.
// Máy chủ VIN GIẢ dựng theo bộ Postman v11 + đo demo 03/11/2026. Mã thành công của hai lời gọi ký USB, mã khi phiên hết hạn,
// và định dạng XML thật CHƯA đo (cần token + tài khoản VIN thật) — xem hub/13 §8. Test xanh chứng minh MÃ CỦA TA khớp những gì đã biết.

const CAU_HINH: CauHinhVin = {
  cheDo: "sandbox",
  baseUrl: "https://vin-thu.example.test",
  username: TAI_KHOAN_VIN_GIA.username,
  password: TAI_KHOAN_VIN_GIA.password,
};
const MST = "0402145678";

function phieu(refId: string): PhieuPhatHanh {
  return {
    refId,
    kyHieu: "1C26TSR",
    mstNguoiBan: MST,
    ngayHoaDon: new Date("2026-09-30T00:00:00.000Z"),
    nguoiMua: { hoTen: "Nguyễn Văn A", donVi: null, mst: null, diaChi: null, email: null },
    hinhThucThanhToan: "Chuyển khoản",
    dong: [{ stt: 1, ten: "Học phí", donViTinh: "Khoá", soLuong: 1, donGia: 5_000_000, thanhTien: 5_000_000, thueSuat: "KCT", tienThue: 0 }],
    tongTruocThue: 5_000_000,
    tongThue: 0,
    tongThanhToan: 5_000_000,
    soTienBangChu: "Năm triệu đồng.",
  };
}

function dung(fetchImpl: FetchLike, nhatKy: string[] = []) {
  return taoCongVin({ cauHinh: CAU_HINH, fetchImpl, log: (s) => nhatKy.push(s) });
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const deB64 = (s: string) => Buffer.from(s, "base64").toString("utf8");
const XML_CHUA_KY = xmlChuaKyGia({ maHoaDon: "x1", mauSo: "1", kyHieu: "C26TSR", tongTien: "5000000" });

beforeEach(() => _xoaBoNhoTokenVinChoTest());

describe("[KYU] đọc phản hồi — thuần", () => {
  it("[KYU-01] lưu nháp: 01 + magiaodich ⇒ DA_LUU; thiếu magiaodich ⇒ KHONG_RO; 08 ⇒ TU_CHOI chắc chắn; 03/26 ⇒ TRUNG; rác ⇒ KHONG_RO", () => {
    expect(docPhanHoiLuuNhap({ maketqua: "01", magiaodich: "25V2BLLBXU6U", trangthai: "0" })).toEqual({ loai: "DA_LUU", maGiaoDich: "25V2BLLBXU6U" });
    expect(docPhanHoiLuuNhap({ maketqua: "01", magiaodich: "" }).loai).toBe("KHONG_RO");
    expect(docPhanHoiLuuNhap({ maketqua: "01" }).loai).toBe("KHONG_RO");
    const t = docPhanHoiLuuNhap({ result: { maketqua: "08", motaketqua: "Dữ liệu hóa đơn không hợp lệ" } });
    expect(t).toMatchObject({ loai: "TU_CHOI", ma: "VIN_08" });
    expect(docPhanHoiLuuNhap({ maketqua: "03" }).loai).toBe("TRUNG");
    expect(docPhanHoiLuuNhap({ maketqua: "26" }).loai).toBe("TRUNG");
    expect(docPhanHoiLuuNhap(null).loai).toBe("KHONG_RO");
    expect(docPhanHoiLuuNhap({ maketqua: "99" }).loai).toBe("KHONG_RO");
  });

  it("[KYU-02] tải XML chưa ký: cần ĐỦ cả xml (mở đầu '<') lẫn maphiengiaodich; thiếu một ⇒ LOI; mã khác 01 ⇒ LOI có mô tả", () => {
    const ok = docPhanHoiTaiXmlChuaKy({ maketqua: "01", maphiengiaodich: "PHIEN1", base64xml: b64(XML_CHUA_KY) });
    expect(ok).toEqual({ loai: "OK", xmlBase64: b64(XML_CHUA_KY), maPhien: "PHIEN1" });
    expect(docPhanHoiTaiXmlChuaKy({ maketqua: "01", base64xml: b64(XML_CHUA_KY) }).loai).toBe("LOI");
    expect(docPhanHoiTaiXmlChuaKy({ maketqua: "01", maphiengiaodich: "PHIEN1" }).loai).toBe("LOI");
    expect(docPhanHoiTaiXmlChuaKy({ maketqua: "01", maphiengiaodich: "PHIEN1", base64xml: b64("không phải xml") }).loai).toBe("LOI");
    const l = docPhanHoiTaiXmlChuaKy({ maketqua: "11", motaketqua: "Không tìm thấy" });
    expect(l).toMatchObject({ loai: "LOI", ma: "VIN_11" });
    expect(docPhanHoiTaiXmlChuaKy("rác").loai).toBe("LOI");
  });

  it("[KYU-03] so XML đã ký với XML chưa ký: chấp nhận khi chỉ khác khối chữ ký / khai báo xml / khoảng trắng giữa thẻ / thẻ tự đóng", () => {
    const daKy = kyXmlGiaChoTest(XML_CHUA_KY);
    expect(kiemXmlDaKy(b64(XML_CHUA_KY), b64(daKy))).toBeNull(); // đối chứng dương
    const dinhDang = daKy.replace('<?xml version="1.0" encoding="UTF-8"?>\n', "").replace("><", ">\n  <");
    expect(kiemXmlDaKy(b64(XML_CHUA_KY), b64(dinhDang))).toBeNull();
    const tuDong = XML_CHUA_KY.replace("<SHDon></SHDon>", "<SHDon/>");
    expect(kiemXmlDaKy(b64(tuDong), b64(daKy))).toBeNull();
    const coTienTo = daKy.replace(/<Signature /, "<ds:Signature ").replace("</Signature>", "</ds:Signature>");
    expect(kiemXmlDaKy(b64(XML_CHUA_KY), b64(coTienTo))).toBeNull();
  });

  it("[KYU-04] so XML: TỪ CHỐI khi chưa có chữ ký · nội dung bị sửa (đổi số tiền) · rỗng/không phải XML · chữ ký rỗng · XML chưa ký rỗng", () => {
    const daKy = kyXmlGiaChoTest(XML_CHUA_KY);
    expect(kiemXmlDaKy(b64(XML_CHUA_KY), b64(daKy))).toBeNull(); // đối chứng dương
    expect(kiemXmlDaKy(b64(XML_CHUA_KY), b64(XML_CHUA_KY))).toMatch(/chữ ký/i);
    expect(kiemXmlDaKy(b64(XML_CHUA_KY), b64(daKy.replace("5000000", "50000000")))).toMatch(/nội dung/i);
    expect(kiemXmlDaKy(b64(XML_CHUA_KY), b64(daKy.replace("<MaHoaDon>x1</MaHoaDon>", "<MaHoaDon>x2</MaHoaDon>")))).toMatch(/nội dung/i);
    expect(kiemXmlDaKy(b64(XML_CHUA_KY), "")).not.toBeNull();
    expect(kiemXmlDaKy(b64(XML_CHUA_KY), b64("không phải xml"))).not.toBeNull();
    expect(kiemXmlDaKy(b64(XML_CHUA_KY), b64(daKy.replace("<SignatureValue>ZmFrZQ==</SignatureValue>", "<SignatureValue></SignatureValue>")))).toMatch(/chữ ký/i);
    expect(kiemXmlDaKy("", b64(daKy))).not.toBeNull();
  });

  it("[KYU-05] phiên ký sống 30 phút: dùng được khi còn dư biên an toàn; hết biên ⇒ không; đồng hồ lùi (lấy 'trong tương lai') ⇒ không", () => {
    const layLuc = new Date("2026-11-04T10:00:00.000Z");
    const sau = (ms: number) => new Date(layLuc.getTime() + ms);
    expect(HAN_PHIEN_KY_USB_MS).toBe(30 * 60 * 1000);
    expect(phienConDungDuoc(layLuc, sau(0))).toBe(true);
    expect(phienConDungDuoc(layLuc, sau(HAN_PHIEN_KY_USB_MS - BIEN_AN_TOAN_PHIEN_MS - 1))).toBe(true);
    expect(phienConDungDuoc(layLuc, sau(HAN_PHIEN_KY_USB_MS - BIEN_AN_TOAN_PHIEN_MS))).toBe(false);
    expect(phienConDungDuoc(layLuc, sau(HAN_PHIEN_KY_USB_MS))).toBe(false);
    expect(phienConDungDuoc(layLuc, sau(-1))).toBe(false);
  });
});

describe("[KYU] cổng VIN — luồng ký USB qua máy chủ giả", () => {
  it("[KYU-10] lưu nháp: GetToken rồi LapHoaDonGoc, BODY PHẲNG, Bearer; ra magiaodich; máy chủ giữ bản NHÁP (chưa ký)", async () => {
    const may = taoMayChuVinGia();
    const kq = await dung(may.fetchImpl).kyUsb.luuNhap(phieu("kyu-10"));
    expect(kq.loai).toBe("DA_LUU");
    expect(may.cuocGoi.map((c) => c.duong)).toEqual(["/Authentication/GetToken", "/QuanLyHoaDon/LapHoaDonGoc"]);
    expect(may.cuocGoi[1]!.auth).toBe(`Bearer ${TAI_KHOAN_VIN_GIA.token}`);
    const body = may.cuocGoi[1]!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("hoadon");
    expect(body).toMatchObject({ doanhnghiep_mst: MST, ma_hoadon: "kyu-10", mauso: "1", kyhieu: "C26TSR" });
    expect(may.daGhi.get("kyu-10")?.daKy).toBe(false);
  });

  it("[KYU-11] lưu nháp gửi LẠI cùng refId (VIN báo trùng) ⇒ tự tra cứu và trả đúng magiaodich cũ, không tạo bản thứ hai", async () => {
    const may = taoMayChuVinGia();
    const cong = dung(may.fetchImpl);
    const a = await cong.kyUsb.luuNhap(phieu("kyu-11"));
    const b = await cong.kyUsb.luuNhap(phieu("kyu-11"));
    expect(a.loai).toBe("DA_LUU");
    expect(b).toEqual(a);
    expect(may.daGhi.size).toBe(1);
  });

  it("[KYU-12] lưu nháp: phiếu tự chặn được ⇒ TU_CHOI và KHÔNG gửi gì (đối chứng: phiếu hợp lệ thì có gửi)", async () => {
    const may = taoMayChuVinGia();
    const cong = dung(may.fetchImpl);
    const hong = { ...phieu("kyu-12"), kyHieu: "" };
    const kq = await cong.kyUsb.luuNhap(hong);
    expect(kq.loai).toBe("TU_CHOI");
    expect(may.cuocGoi).toHaveLength(0);
    await cong.kyUsb.luuNhap(phieu("kyu-12b"));
    expect(may.cuocGoi.length).toBeGreaterThan(0);
  });

  it("[KYU-13] lưu nháp: timeout/lỗi mạng ⇒ KHONG_RO (không bao giờ gửi lại mù): đúng MỘT lời gọi LapHoaDonGoc", async () => {
    const may = taoMayChuVinGia("TIMEOUT_DA_GHI");
    const kq = await dung(may.fetchImpl).kyUsb.luuNhap(phieu("kyu-13"));
    expect(kq.loai).toBe("KHONG_RO");
    expect(may.cuocGoi.filter((c) => c.duong === "/QuanLyHoaDon/LapHoaDonGoc")).toHaveLength(1);
  });

  it("[KYU-14] tải XML chưa ký: POST /XuLyHoaDon/TaiXmlChuaKy với {doanhnghiep_mst, magiaodich, ma_hoadon}; ra XML + maphiengiaodich", async () => {
    const may = taoMayChuVinGia();
    const cong = dung(may.fetchImpl);
    const nhap = await cong.kyUsb.luuNhap(phieu("kyu-14"));
    if (nhap.loai !== "DA_LUU") throw new Error("kỳ vọng DA_LUU");
    const kq = await cong.kyUsb.taiXmlChuaKy({ mstNguoiBan: MST, refId: "kyu-14", maGiaoDich: nhap.maGiaoDich });
    if (kq.loai !== "OK") throw new Error(`kỳ vọng OK: ${JSON.stringify(kq)}`);
    expect(kq.maPhien).toMatch(/^PHIEN/);
    expect(deB64(kq.xmlBase64).startsWith("<?xml")).toBe(true);
    const cuoc = may.cuocGoi.at(-1)!;
    expect(cuoc.duong).toBe("/XuLyHoaDon/TaiXmlChuaKy");
    expect(cuoc.body).toEqual({ doanhnghiep_mst: MST, magiaodich: nhap.maGiaoDich, ma_hoadon: "kyu-14" });
  });

  it("[KYU-15] tải XML chưa ký: hoá đơn không có ⇒ LOI; mạng lỗi ⇒ LOI (tải XML không tạo hoá đơn nên được phép thử lại — mỗi lần là một phiên mới)", async () => {
    const may = taoMayChuVinGia();
    const cong = dung(may.fetchImpl);
    const khongCo = await cong.kyUsb.taiXmlChuaKy({ mstNguoiBan: MST, refId: "khong-co", maGiaoDich: "KHONGCO" });
    expect(khongCo.loai).toBe("LOI");
    may.epMotLan("/XuLyHoaDon/TaiXmlChuaKy", () => {
      throw new Error("mạng đứt");
    });
    const mang = await cong.kyUsb.taiXmlChuaKy({ mstNguoiBan: MST, refId: "khong-co", maGiaoDich: "KHONGCO" });
    expect(mang.loai).toBe("LOI");
  });

  it("[KYU-16] gửi XML đã ký: đủ luồng ⇒ DA_PHAT_HANH có số hoá đơn thật; body mang maphiengiaodich + base64xml; máy chủ đánh dấu đã ký", async () => {
    const may = taoMayChuVinGia();
    const cong = dung(may.fetchImpl);
    const p = phieu("kyu-16");
    const nhap = await cong.kyUsb.luuNhap(p);
    if (nhap.loai !== "DA_LUU") throw new Error("kỳ vọng DA_LUU");
    const tai = await cong.kyUsb.taiXmlChuaKy({ mstNguoiBan: MST, refId: p.refId, maGiaoDich: nhap.maGiaoDich });
    if (tai.loai !== "OK") throw new Error("kỳ vọng OK");
    const daKy = b64(kyXmlGiaChoTest(deB64(tai.xmlBase64)));
    const kq = await cong.kyUsb.guiXmlDaKy({ phieu: p, maGiaoDich: nhap.maGiaoDich, maPhien: tai.maPhien, xmlChuaKyBase64: tai.xmlBase64, xmlDaKyBase64: daKy });
    expect(kq.loai).toBe("DA_PHAT_HANH");
    if (kq.loai === "DA_PHAT_HANH") {
      expect(kq.soHoaDon).toMatch(/^\d{7}$/);
      expect(kq.refId).toBe("kyu-16");
      expect(kq.maTraCuu).toBe(nhap.maGiaoDich);
    }
    const cuoc = may.cuocGoi.at(-1)!;
    expect(cuoc.duong).toBe("/XuLyHoaDon/KyHoaDonToken_GuiXmlDaKy");
    expect(cuoc.body).toEqual({ doanhnghiep_mst: MST, magiaodich: nhap.maGiaoDich, ma_hoadon: "kyu-16", base64xml: daKy, maphiengiaodich: tai.maPhien });
    expect(may.daGhi.get("kyu-16")?.daKy).toBe(true);
  });

  it("[KYU-17] gửi XML đã ký: XML CHƯA có chữ ký hoặc bị sửa nội dung ⇒ TU_CHOI chắc chắn và KHÔNG có lời gọi nào tới VIN (đối chứng dương: bản đúng thì có gọi)", async () => {
    const may = taoMayChuVinGia();
    const cong = dung(may.fetchImpl);
    const p = phieu("kyu-17");
    const nhap = await cong.kyUsb.luuNhap(p);
    if (nhap.loai !== "DA_LUU") throw new Error("kỳ vọng DA_LUU");
    const tai = await cong.kyUsb.taiXmlChuaKy({ mstNguoiBan: MST, refId: p.refId, maGiaoDich: nhap.maGiaoDich });
    if (tai.loai !== "OK") throw new Error("kỳ vọng OK");
    const truoc = may.cuocGoi.length;
    const goi = (xmlDaKyBase64: string) =>
      cong.kyUsb.guiXmlDaKy({ phieu: p, maGiaoDich: nhap.maGiaoDich, maPhien: tai.maPhien, xmlChuaKyBase64: tai.xmlBase64, xmlDaKyBase64 });
    const chuaKy = await goi(tai.xmlBase64);
    const biSua = await goi(b64(kyXmlGiaChoTest(deB64(tai.xmlBase64)).replace("5000000", "1")));
    expect(chuaKy).toMatchObject({ loai: "TU_CHOI" });
    expect(biSua).toMatchObject({ loai: "TU_CHOI" });
    expect(may.cuocGoi).toHaveLength(truoc);
    expect(may.daGhi.get("kyu-17")?.daKy).toBe(false);
    const dung_ = await goi(b64(kyXmlGiaChoTest(deB64(tai.xmlBase64))));
    expect(dung_.loai).toBe("DA_PHAT_HANH");
  });

  it("[KYU-18] gửi XML đã ký: timeout SAU KHI VIN đã ghi ⇒ KHONG_RO và đúng MỘT lời gọi (không gửi lại); tra cứu sau đó thấy đã ký", async () => {
    const may = taoMayChuVinGia();
    const cong = dung(may.fetchImpl);
    const p = phieu("kyu-18");
    const nhap = await cong.kyUsb.luuNhap(p);
    if (nhap.loai !== "DA_LUU") throw new Error("kỳ vọng DA_LUU");
    const tai = await cong.kyUsb.taiXmlChuaKy({ mstNguoiBan: MST, refId: p.refId, maGiaoDich: nhap.maGiaoDich });
    if (tai.loai !== "OK") throw new Error("kỳ vọng OK");
    may.datKichBan("TIMEOUT_DA_GHI");
    const kq = await cong.kyUsb.guiXmlDaKy({
      phieu: p,
      maGiaoDich: nhap.maGiaoDich,
      maPhien: tai.maPhien,
      xmlChuaKyBase64: tai.xmlBase64,
      xmlDaKyBase64: b64(kyXmlGiaChoTest(deB64(tai.xmlBase64))),
    });
    expect(kq.loai).toBe("KHONG_RO");
    expect(may.cuocGoi.filter((c) => c.duong === "/XuLyHoaDon/KyHoaDonToken_GuiXmlDaKy")).toHaveLength(1);
    const tc = await cong.traCuu("kyu-18", MST);
    expect(tc.loai).toBe("DA_PHAT_HANH");
  });

  it("[KYU-19] gửi XML đã ký với phiên LẠ/hết hạn ⇒ không ghi nhận đã ký (KHONG_RO để nơi gọi tra cứu), hoá đơn vẫn là NHÁP chưa ký trên VIN", async () => {
    const may = taoMayChuVinGia();
    const cong = dung(may.fetchImpl);
    const p = phieu("kyu-19");
    const nhap = await cong.kyUsb.luuNhap(p);
    if (nhap.loai !== "DA_LUU") throw new Error("kỳ vọng DA_LUU");
    const tai = await cong.kyUsb.taiXmlChuaKy({ mstNguoiBan: MST, refId: p.refId, maGiaoDich: nhap.maGiaoDich });
    if (tai.loai !== "OK") throw new Error("kỳ vọng OK");
    const kq = await cong.kyUsb.guiXmlDaKy({
      phieu: p,
      maGiaoDich: nhap.maGiaoDich,
      maPhien: "PHIEN-LA",
      xmlChuaKyBase64: tai.xmlBase64,
      xmlDaKyBase64: b64(kyXmlGiaChoTest(deB64(tai.xmlBase64))),
    });
    expect(kq.loai).toBe("KHONG_RO");
    expect(may.daGhi.get("kyu-19")?.daKy).toBe(false);
  });

  it("[KYU-20] gửi XML đã ký: VIN 401 dai dẳng ⇒ TU_CHOI VIN_DANG_NHAP (chưa xử lý gì); 400 ⇒ TU_CHOI VIN_400", async () => {
    const may = taoMayChuVinGia();
    const cong = dung(may.fetchImpl);
    const p = phieu("kyu-20");
    const nhap = await cong.kyUsb.luuNhap(p);
    if (nhap.loai !== "DA_LUU") throw new Error("kỳ vọng DA_LUU");
    const tai = await cong.kyUsb.taiXmlChuaKy({ mstNguoiBan: MST, refId: p.refId, maGiaoDich: nhap.maGiaoDich });
    if (tai.loai !== "OK") throw new Error("kỳ vọng OK");
    const a = { phieu: p, maGiaoDich: nhap.maGiaoDich, maPhien: tai.maPhien, xmlChuaKyBase64: tai.xmlBase64, xmlDaKyBase64: b64(kyXmlGiaChoTest(deB64(tai.xmlBase64))) };
    may.epMotLan("/XuLyHoaDon/KyHoaDonToken_GuiXmlDaKy", () => new Response("{}", { status: 400 }));
    expect(await cong.kyUsb.guiXmlDaKy(a)).toMatchObject({ loai: "TU_CHOI", ma: "VIN_400" });
    expect(may.daGhi.get("kyu-20")?.daKy).toBe(false);
    may.datKichBan("LOI_XAC_THUC");
    expect(await cong.kyUsb.guiXmlDaKy(a)).toMatchObject({ loai: "TU_CHOI", ma: "VIN_DANG_NHAP" });
  });

  it("[KYU-21] KHÔNG rò: nhật ký và thông điệp lỗi của cả ba hàm không chứa token, mật khẩu, hay nội dung XML", async () => {
    const nhatKy: string[] = [];
    const may = taoMayChuVinGia("TIMEOUT_DA_GHI");
    const cong = dung(may.fetchImpl, nhatKy);
    const p = phieu("kyu-21");
    const kqs: unknown[] = [await cong.kyUsb.luuNhap(p)];
    may.datKichBan("THANH_CONG");
    const nhap = await cong.kyUsb.luuNhap(phieu("kyu-21b"));
    if (nhap.loai !== "DA_LUU") throw new Error("kỳ vọng DA_LUU");
    const tai = await cong.kyUsb.taiXmlChuaKy({ mstNguoiBan: MST, refId: "kyu-21b", maGiaoDich: nhap.maGiaoDich });
    if (tai.loai !== "OK") throw new Error("kỳ vọng OK");
    kqs.push(tai);
    may.datKichBan("TIMEOUT_DA_GHI");
    kqs.push(
      await cong.kyUsb.guiXmlDaKy({ phieu: phieu("kyu-21b"), maGiaoDich: nhap.maGiaoDich, maPhien: tai.maPhien, xmlChuaKyBase64: tai.xmlBase64, xmlDaKyBase64: b64(kyXmlGiaChoTest(deB64(tai.xmlBase64))) }),
    );
    const tatCa = `${nhatKy.join("\n")}\n${JSON.stringify(kqs.filter((k) => (k as { loai: string }).loai !== "OK"))}`;
    for (const bi of [TAI_KHOAN_VIN_GIA.password, TAI_KHOAN_VIN_GIA.token, TAI_KHOAN_VIN_GIA.username]) expect(tatCa).not.toContain(bi);
    expect(tatCa).not.toContain("<HDon>");
    expect(tatCa).not.toContain(tai.xmlBase64);
    expect(nhatKy.length).toBeGreaterThan(0); // đối chứng: có ghi nhật ký thật
  });

  it("[KYU-22] kiểm tra đăng nhập: đúng ⇒ OK (luôn gọi GetToken mới, kể cả khi đã có token trong bộ nhớ); sai tài khoản ⇒ DANG_NHAP_SAI; mạng đứt ⇒ MANG", async () => {
    const may = taoMayChuVinGia();
    const cong = dung(may.fetchImpl);
    expect(await cong.kiemTraDangNhap(MST)).toBe("OK");
    expect(await cong.kiemTraDangNhap(MST)).toBe("OK");
    expect(may.cuocGoi.filter((c) => c.duong === "/Authentication/GetToken")).toHaveLength(2);
    may.datKichBan("LOI_XAC_THUC");
    expect(await cong.kiemTraDangNhap(MST)).toBe("DANG_NHAP_SAI");
    may.datKichBan("THANH_CONG");
    may.epMotLan("/Authentication/GetToken", () => {
      throw new Error("mạng đứt");
    });
    expect(await cong.kiemTraDangNhap(MST)).toBe("MANG");
    may.epMotLan("/Authentication/GetToken", () => new Response("{}", { status: 500 }));
    expect(await cong.kiemTraDangNhap(MST)).toBe("LOI_MAY_CHU");
    may.epMotLan("/Authentication/GetToken", () => new Response(JSON.stringify({ khac: 1 }), { status: 200 }));
    expect(await cong.kiemTraDangNhap(MST)).toBe("PHAN_HOI_LA");
  });

  it("[KYU-23] kiểm tra đăng nhập: kết quả và nhật ký KHÔNG chứa token, mật khẩu, tên đăng nhập", async () => {
    const nhatKy: string[] = [];
    const may = taoMayChuVinGia("LOI_XAC_THUC");
    const kq = await dung(may.fetchImpl, nhatKy).kiemTraDangNhap(MST);
    const tatCa = `${kq}\n${nhatKy.join("\n")}`;
    for (const bi of [TAI_KHOAN_VIN_GIA.password, TAI_KHOAN_VIN_GIA.token, TAI_KHOAN_VIN_GIA.username]) expect(tatCa).not.toContain(bi);
    expect(nhatKy.length).toBeGreaterThan(0);
  });
});
