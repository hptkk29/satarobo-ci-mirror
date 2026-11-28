import { describe, expect, it } from "vitest";

import { CAU_MAT_KHAU_YEU, lyDoMatKhauYeu } from "./mat-khau-yeu";

describe("[MKY] SEC-12 — chặn mật khẩu quá yếu (hàm thuần)", () => {
  it("[MKY-01] dãy / lặp / từ thông dụng bị chặn (có cả biến thể hoa-thường, dấu, đuôi số)", () => {
    for (const mk of ["12345678", "123456789", "87654321", "11111111", "00000000", "abababab", "12341234", "Password", "PASSWORD1", "matkhau123", "Mật Khẩu 123".replace(/ /g, ""), "satarobo2026", "Sata1234", "qwertyui", "abcd1234", "98765432109", "01234567890", "admin123!", "iloveyou"]) {
      expect(lyDoMatKhauYeu(mk), mk).toBe(CAU_MAT_KHAU_YEU);
    }
  });

  it("[MKY-02] mật khẩu CHỨA số điện thoại của chính tài khoản (0…, 84…, +84…) hoặc phần tên email ⇒ bị chặn; của người khác thì không", () => {
    expect(lyDoMatKhauYeu("Xx0901234567", { sdt: "0901234567" })).toBe(CAU_MAT_KHAU_YEU);
    expect(lyDoMatKhauYeu("901234567ab", { sdt: "84901234567" })).toBe(CAU_MAT_KHAU_YEU);
    expect(lyDoMatKhauYeu("zz+84901234567zz", { sdt: "+84901234567" })).toBe(CAU_MAT_KHAU_YEU);
    expect(lyDoMatKhauYeu("nguyenvanan2026!", { email: "NguyenVanAn@gmail.com" })).toBe(CAU_MAT_KHAU_YEU);
    expect(lyDoMatKhauYeu("Xx0901234567", { sdt: "0912345678" })).toBeNull(); // SĐT của người KHÁC không làm yếu
  });

  it("[MKY-03] ĐỐI CHỨNG DƯƠNG: mật khẩu bình thường của phụ huynh KHÔNG bị chặn (không ép hoa/thường/ký tự đặc biệt)", () => {
    for (const mk of ["bongdacamnang", "Mua2026Dep", "toiyeucon.vn", "x7Kp9mQz", "cacongcaphe", "banhmi_nuong_5"]) {
      expect(lyDoMatKhauYeu(mk, { sdt: "0901234567", email: "phuhuynh.an@gmail.com" }), mk).toBeNull();
    }
    expect(lyDoMatKhauYeu("", {})).toBe(CAU_MAT_KHAU_YEU);
    expect(lyDoMatKhauYeu("   ")).toBe(CAU_MAT_KHAU_YEU);
  });

  it("[MKY-04] luôn MỘT câu chung (không lộ luật nào bắt)", () => {
    const cau = new Set(["12345678", "aaaaaaaa", "Password1", "0901234567zz"].map((m) => lyDoMatKhauYeu(m, { sdt: "0901234567" })));
    expect([...cau]).toEqual([CAU_MAT_KHAU_YEU]);
  });
});
