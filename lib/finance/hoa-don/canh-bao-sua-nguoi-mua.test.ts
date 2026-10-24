// Ca [TTHD-08] — câu cảnh báo khi sửa "Người mua trên hoá đơn" của đơn đang có hoá đơn (GĐ 8 bước 12).
import { describe, expect, it } from "vitest";
import { canhBaoSuaNguoiMua } from "./canh-bao-sua-nguoi-mua";

const NHAP = { trangThai: "NHAP", kyHieu: "1C26TSR", soHoaDon: "127" };
const XN = { trangThai: "DA_XAC_NHAN", kyHieu: "1C26TSR", soHoaDon: "128" };

describe("[TTHD-08] canhBaoSuaNguoiMua", () => {
  it("không đổi gì / không hoá đơn còn hiệu lực ⇒ im lặng", () => {
    expect(canhBaoSuaNguoiMua({ doi: [], con: [NHAP], emailMoi: "a@x.vn" })).toBeNull();
    expect(canhBaoSuaNguoiMua({ doi: ["invoiceBuyerName"], con: [], emailMoi: "a@x.vn" })).toBeNull();
    expect(canhBaoSuaNguoiMua({ doi: ["invoiceBuyerName"], con: [{ trangThai: "KHONG_XUAT", kyHieu: null, soHoaDon: null }], emailMoi: null })).toBeNull();
  });

  it("đổi người mua / MST ⇒ tờ hoá đơn KHÔNG tự đổi; việc cần làm theo trạng thái từng tờ", () => {
    expect(canhBaoSuaNguoiMua({ doi: ["invoiceTaxCode"], con: [NHAP], emailMoi: null })).toBe(
      "Đơn đang có hoá đơn 1C26TSR-127 (nháp) in người mua cũ — tờ hoá đơn không tự đổi; báo kế toán gỡ bản nháp rồi tải lại nếu cần",
    );
    expect(canhBaoSuaNguoiMua({ doi: ["invoiceBuyerName", "invoiceEmail"], con: [XN], emailMoi: "a@x.vn" })).toBe(
      "Đơn đang có hoá đơn 1C26TSR-128 (đã xuất) in người mua cũ — tờ hoá đơn không tự đổi; báo kế toán huỷ hoá đơn rồi xuất lại nếu cần",
    );
    expect(canhBaoSuaNguoiMua({ doi: ["invoiceCompanyName"], con: [NHAP, XN], emailMoi: null })).toMatch(
      /1C26TSR-127 \(nháp\), 1C26TSR-128 \(đã xuất\).*gỡ bản nháp rồi tải lại \/ huỷ hoá đơn rồi xuất lại/,
    );
  });

  it("CHỈ đổi email: nháp ⇒ email MỚI sẽ được dùng (không phải 'tờ cũ'); đã xuất ⇒ nhờ gửi lại", () => {
    const nhap = canhBaoSuaNguoiMua({ doi: ["invoiceEmail"], con: [NHAP], emailMoi: "moi@x.vn" });
    expect(nhap).toBe("Hoá đơn nháp sẽ gửi tới email mới khi kế toán xác nhận");
    expect(nhap).not.toMatch(/người mua cũ/);
    expect(canhBaoSuaNguoiMua({ doi: ["invoiceEmail"], con: [XN], emailMoi: "moi@x.vn" })).toBe(
      "Hoá đơn đã gửi tới email cũ — nhờ kế toán 'Gửi lại email' tới email hiện tại nếu cần",
    );
  });

  it("xoá hẳn email: nháp nói 'sẽ không gửi'; đã xuất thì không có gì để gửi lại ⇒ im lặng", () => {
    expect(canhBaoSuaNguoiMua({ doi: ["invoiceEmail"], con: [NHAP], emailMoi: null })).toMatch(/sẽ không gửi email/);
    expect(canhBaoSuaNguoiMua({ doi: ["invoiceEmail"], con: [XN], emailMoi: null })).toBeNull();
  });
});
