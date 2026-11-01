import { describe, it, expect } from "vitest";
import { noiDungTrongAnhQr, anhQrDaCu } from "./noi-dung-trong-anh";
import { buildVietQrImageUrl, VIETQR_ADDINFO_MAX, transferContentForOrder } from "./vietqr";
import { noiDungCkCoKhoa } from "./noi-dung-ck";

const CFG = {
  bankBin: "970415",
  accountNumber: "0123456789",
  accountName: "CTY CP CN GD SATA ROBO",
} as Parameters<typeof buildVietQrImageUrl>[0];

describe("nội dung CK đọc ngược từ ảnh QR", () => {
  it("[NTA-01] đọc đúng chuỗi mà `buildVietQrImageUrl` vừa nhét vào — kể cả khoảng trắng", () => {
    // Chuỗi thật của khuôn đời cũ: khoá + KHOẢNG TRẮNG + phần người đọc bị cắt.
    // `URLSearchParams` mã hoá khoảng trắng thành `+`; đọc bằng `decodeURIComponent`
    // sẽ giữ nguyên dấu `+` và ra một chuỗi SAI trông y như thật.
    const memo = "ORD260924000001D1 Anh_090";
    const url = buildVietQrImageUrl(CFG, 3_000_000, memo)!;
    expect(url).toContain("addInfo=ORD260924000001D1+Anh_090");
    expect(noiDungTrongAnhQr(url)).toBe(memo);
  });

  it("[NTA-02] đi trọn vòng với chuỗi do CHÍNH đường phát hành dựng ra", () => {
    const nguoiDoc = transferContentForOrder(
      {
        studentName: "Nguyễn Phương Quỳnh Anh",
        customerName: "Nguyễn Văn Ba",
        customerPhone: "0905123456",
        courseName: "Sata 4 - Lập trình Robot",
      },
      VIETQR_ADDINFO_MAX,
    );
    const memo = noiDungCkCoKhoa("ORD260924000001D1", nguoiDoc, VIETQR_ADDINFO_MAX);
    const url = buildVietQrImageUrl(CFG, 3_000_000, memo)!;
    expect(noiDungTrongAnhQr(url)).toBe(memo);
    // Và đây là con số của sự cố: chuỗi người-đọc KHÁC chuỗi nằm trong ảnh.
    expect(nguoiDoc).not.toBe(memo);
  });

  it("[NTA-03] chuỗi EMVCo của cổng → null (KHÔNG đoán)", () => {
    // Đọc sai một chuỗi EMVCo rồi in ra màn tiền còn tệ hơn không đọc — xem chú thích
    // đầu tệp. `null` để chỗ gọi lùi về chuỗi nó có, và phép lùi đó là khai báo được.
    expect(noiDungTrongAnhQr("00020101021238570010A00000072701270006970422")).toBeNull();
  });

  it("[NTA-04] null / rỗng / URL không có addInfo → null", () => {
    expect(noiDungTrongAnhQr(null)).toBeNull();
    expect(noiDungTrongAnhQr(undefined)).toBeNull();
    expect(noiDungTrongAnhQr("   ")).toBeNull();
    expect(noiDungTrongAnhQr("https://img.vietqr.io/image/970415-1-compact2.png")).toBeNull();
    expect(noiDungTrongAnhQr("https://img.vietqr.io/image/x.png?addInfo=")).toBeNull();
  });

  it("[NTA-05] chuỗi rác không làm ném — đường gọi là render trang đơn", () => {
    expect(() => noiDungTrongAnhQr("http://[kh" + "ong-phai-url")).not.toThrow();
    expect(noiDungTrongAnhQr("http://[khong-phai-url")).toBeNull();
  });

  it("[NTA-06] `anhQrDaCu` bật đúng khi dữ liệu đơn đã đổi sau lúc phát mã", () => {
    const cu = buildVietQrImageUrl(CFG, 3_000_000, "ORD260924000001D1 Anh_090")!;
    expect(anhQrDaCu(cu, "ORD260924000001D1 Anh_090")).toBe(false);
    expect(anhQrDaCu(cu, "ORD260924000001D1 Anh_091")).toBe(true);
  });

  it("[NTA-07] không đọc được nội dung trong ảnh ⇒ KHÔNG báo động (fail-quiet có chủ đích)", () => {
    // Báo động giả trên màn tiền bị người dùng học cách bỏ qua, rồi bỏ qua luôn lần thật.
    expect(anhQrDaCu(null, "bat-ky")).toBe(false);
    expect(anhQrDaCu("00020101021238570010A0000007", "bat-ky")).toBe(false);
  });
});
