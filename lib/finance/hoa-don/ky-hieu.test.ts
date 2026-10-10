// Ca [KH-*] — KÝ HIỆU HOÁ ĐƠN theo năm phát hành.
//
// Ký hiệu hoá đơn điện tử (TT 78/2021): `1C26TSR` = [loại 1 chữ số][C|K][2 chữ số NĂM][loại hình
// 1 chữ][2 ký tự tự đặt]. Hai chữ số năm ĐỔI mỗi năm — hoá đơn lập đầu tháng 1 cho tiền về cuối
// tháng 12 mang ký hiệu năm MỚI. Ô điền sẵn giữ cứng "1C26TSR" từ cấu hình thì từ 01/01/2027 sai,
// và kế toán nhìn quen mắt dễ bấm qua (phản biện v1, §6/§1.2).
//
// Luật 19: KHÔNG đọc đồng hồ thật — mọi ngày trong ca là hằng tuyệt đối.
import { describe, it, expect } from "vitest";
import { kyHieuTheoNam, kiemKyHieu } from "./ky-hieu";

const ngay = (s: string) => new Date(`${s}T00:00:00Z`); // `@db.Date` = nửa đêm UTC

describe("[KH-01] điền sẵn ký hiệu theo NĂM của ngày phát hành", () => {
  it("mẫu 1C26TSR + phát hành 31/12/2026 ⇒ 1C26TSR", () => {
    expect(kyHieuTheoNam("1C26TSR", ngay("2026-12-31"))).toBe("1C26TSR");
  });

  it("mẫu 1C26TSR + phát hành 01/01/2027 ⇒ 1C27TSR (không giữ cứng năm của cấu hình)", () => {
    expect(kyHieuTheoNam("1C26TSR", ngay("2027-01-01"))).toBe("1C27TSR");
  });

  it("pháp nhân thứ hai (1C26MNV) cũng đổi đúng năm", () => {
    expect(kyHieuTheoNam("1C26MNV", ngay("2027-03-15"))).toBe("1C27MNV");
  });

  it("mẫu không đúng hình dạng ⇒ trả lại nguyên văn, không bịa", () => {
    expect(kyHieuTheoNam("ABC", ngay("2027-01-01"))).toBe("ABC");
  });
});

describe("[KH-02] kiểm ký hiệu kế toán gõ", () => {
  it("khớp năm ⇒ null (hợp lệ)", () => {
    expect(kiemKyHieu("1C26TSR", ngay("2026-09-04"))).toBeNull();
  });

  it("năm trong ký hiệu KHÁC năm phát hành ⇒ lỗi, nói rõ hai con số", () => {
    const loi = kiemKyHieu("1C26TSR", ngay("2027-01-02"));
    expect(loi).toMatch(/26/);
    expect(loi).toMatch(/2027/);
  });

  it("sai hình dạng ⇒ lỗi", () => {
    expect(kiemKyHieu("1C2TSR", ngay("2026-09-04"))).not.toBeNull();
    expect(kiemKyHieu("", ngay("2026-09-04"))).not.toBeNull();
  });

  it("chữ thường / thừa khoảng trắng được chuẩn hoá trước khi kiểm", () => {
    expect(kiemKyHieu(" 1c26tsr ", ngay("2026-09-04"))).toBeNull();
  });
});
