import { describe, expect, it } from "vitest";
import { activationIdentifierSchema, loginSchema } from "./auth";
import { userCreateSchema } from "./user";

const PW = "Test@12345";

describe("[AUTH-SDT-P3-C1] loginSchema — identifier nhận cả SĐT lẫn email", () => {
  it("email hợp lệ → pass, giữ NGUYÊN hoa/thường (không đổi ngữ nghĩa so khớp)", () => {
    const r = loginSchema.safeParse({ identifier: "Ceo@Example.com", password: PW });
    expect(r.success).toBe(true);
    expect(r.success && r.data.identifier).toBe("Ceo@Example.com");
  });

  it("SĐT mọi cách gõ (0905… / 84905… / +84 có chấm cách) → pass", () => {
    for (const v of ["0905123456", "84905123456", "+84 905 123 456", "0905.123.456"]) {
      expect(loginSchema.safeParse({ identifier: v, password: PW }).success).toBe(true);
    }
  });

  it("không phải email cũng không phải SĐT di động VN → fail", () => {
    // "02363123456" là số bàn — canonicalPhone trả null (chỉ nhận di động).
    for (const v of ["abc", "02363123456", "123", "phuc@", ""]) {
      expect(loginSchema.safeParse({ identifier: v, password: PW }).success).toBe(false);
    }
  });

  it("password vẫn tối thiểu 8 ký tự", () => {
    expect(loginSchema.safeParse({ identifier: "0905123456", password: "ngắn" }).success).toBe(
      false,
    );
  });
});

describe("[AUTH-SDT-P5-C1] activationIdentifierSchema — /kich-hoat nhận SĐT hoặc email", () => {
  it("SĐT mọi cách gõ → TRANSFORM về canonical 84… (khoá tra cứu + khoá OTP)", () => {
    // Quan trọng hơn việc 'pass': giá trị trả về phải là DẠNG TRA CỨU. Trả nguyên
    // chuỗi user gõ thì `where:{phone}` không khớp và `verifyAndConsumeOtp` tra
    // target khác lúc `requestOtp` đã lưu ⇒ mã đúng vẫn báo sai.
    for (const v of ["0905123456", "84905123456", "+84 905 123 456", "0905.123.456"]) {
      const r = activationIdentifierSchema.safeParse(v);
      expect(r.success).toBe(true);
      expect(r.success && r.data).toBe("84905123456");
    }
  });

  it("email → lowercase (GIỮ ngữ nghĩa của màn kích hoạt trước P5)", () => {
    const r = activationIdentifierSchema.safeParse("  Ceo@Example.COM ");
    expect(r.success).toBe(true);
    expect(r.success && r.data).toBe("ceo@example.com");
  });

  it("số bàn / rác → fail (số cố định không nhận được ZNS, không làm định danh được)", () => {
    for (const v of ["abc", "02363123456", "123", "phuc@", ""]) {
      expect(activationIdentifierSchema.safeParse(v).success).toBe(false);
    }
  });
});

describe("[AUTH-SDT-P3-C2] QĐ-C — tạo tài khoản NHÂN SỰ vẫn BẮT BUỘC email", () => {
  // Khoá ở tầng validator (DB đã nới email nullable cho phụ huynh P5): nếu test
  // này đỏ nghĩa là ai đó vừa nới email ở nhánh staff → sẽ vỡ ở user.upsert sau.
  it("thiếu email → fail", () => {
    const r = userCreateSchema.safeParse({
      name: "NV Test",
      role: "HR",
      roles: ["HR"],
      password: PW,
    });
    expect(r.success).toBe(false);
  });
});
