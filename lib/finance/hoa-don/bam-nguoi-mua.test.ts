// Ca [BNM-*] — dấu người mua dùng để cảnh báo "thông tin người mua đổi sau khi tải phiếu chờ".
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
