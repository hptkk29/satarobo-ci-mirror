// Ca [BNM-*] — dấu người mua dùng để cảnh báo "thông tin người mua đổi sau khi tải phiếu chờ".
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { bamNguoiMua } from "./bam-nguoi-mua";
import type { NguoiMuaHoaDon } from "./nguoi-mua";

const NM: NguoiMuaHoaDon = {
  hoTen: "Nguyễn Văn A",
  tenDonVi: "Công ty ABC",
  maSoThue: "0401234567",
  diaChi: "12 Lê Lợi, Đà Nẵng",
  cccd: null,
  email: "a@gmail.com",
  dienThoai: "0905123456",
  maKhachHang: null,
};

describe("[BNM-01] dấu người mua", () => {
  it("cùng dữ liệu ⇒ cùng dấu; khoảng trắng + hoa/thường không đổi dấu", () => {
    expect(bamNguoiMua(NM)).toBe(bamNguoiMua({ ...NM }));
    expect(bamNguoiMua({ ...NM, tenDonVi: "  CÔNG TY   abc " })).toBe(bamNguoiMua(NM));
  });

  it("đổi MST / tên đơn vị / địa chỉ ⇒ đổi dấu", () => {
    const goc = bamNguoiMua(NM);
    expect(bamNguoiMua({ ...NM, maSoThue: "0401234568" })).not.toBe(goc);
    expect(bamNguoiMua({ ...NM, tenDonVi: "Công ty XYZ" })).not.toBe(goc);
    expect(bamNguoiMua({ ...NM, diaChi: "13 Lê Lợi, Đà Nẵng" })).not.toBe(goc);
  });

  it("dời ranh giới giữa hai ô KHÔNG va chạm (mảng có thứ tự, không ghép chuỗi trần)", () => {
    const a = bamNguoiMua({ ...NM, hoTen: "AB", tenDonVi: null });
    const b = bamNguoiMua({ ...NM, hoTen: "A", tenDonVi: "B" });
    expect(a).not.toBe(b);
  });

  it("dạng: 32 ký tự hex", () => {
    expect(bamNguoiMua(NM)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("[BNM-MA] mã khách hàng trong dấu người mua", () => {
  it("[BNM-MA-1] KHÔNG có mã ⇒ dấu y hệt công thức BẢY ô cũ (không đổi dấu của hoá đơn đã có)", () => {
    // Tính độc lập bằng chính công thức cũ — nếu ai thêm phần tử thứ tám vô điều kiện, ca này đỏ.
    const chuan = (v: string | null) => (v ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
    const cu = [NM.hoTen, NM.tenDonVi, NM.maSoThue, NM.diaChi, NM.cccd, NM.email, NM.dienThoai].map(chuan);
    const dauCu = createHash("sha256").update(JSON.stringify(cu)).digest("hex").slice(0, 32);
    expect(bamNguoiMua(NM)).toBe(dauCu);
    expect(bamNguoiMua({ ...NM, maKhachHang: null })).toBe(dauCu);
    expect(bamNguoiMua({ ...NM, maKhachHang: "   " })).toBe(dauCu);
  });

  it("[BNM-MA-2] có mã ⇒ đổi dấu; đổi mã ⇒ đổi dấu; hoa/thường + khoảng trắng thì không", () => {
    const goc = bamNguoiMua(NM);
    const coMa = bamNguoiMua({ ...NM, maKhachHang: "CS1-26-AB12CD" });
    expect(coMa).not.toBe(goc);
    expect(bamNguoiMua({ ...NM, maKhachHang: "CS1-26-AB12CE" })).not.toBe(coMa);
    expect(bamNguoiMua({ ...NM, maKhachHang: " cs1-26-ab12cd " })).toBe(coMa);
  });
});
