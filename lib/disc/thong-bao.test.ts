import { describe, expect, it } from "vitest";
import { chePhone, chePhoneChuaXacMinh, cheEmail, thongBaoSauLuu, THONG_BAO_LUU_CHINH } from "./thong-bao";

describe("[DISC-TB-01] câu chính TRUNG TÍNH", () => {
  it("không nhắc 'tài khoản đã tồn tại' hay 'chưa kích hoạt' theo SĐT", () => {
    expect(THONG_BAO_LUU_CHINH).toContain("https://satarobo.vn/kich-hoat");
    expect(THONG_BAO_LUU_CHINH).toMatch(/hoặc đăng nhập bằng tài khoản đã có/);
  });
  it("cùng một câu chính cho mọi trạng thái email", () => {
    const tt = ["NONE", "VERIFICATION_REQUIRED", "QUEUED", "SENT", "FAILED"] as const;
    const chinh = new Set(tt.map((t) => thongBaoSauLuu({ email: "a@b.vn", trangThaiEmail: t }).chinh));
    expect(chinh.size).toBe(1);
  });
});

describe("[DISC-TB-02] email", () => {
  it("không có email ⇒ KHÔNG có dòng email nào", () => {
    expect(thongBaoSauLuu({ email: null, trangThaiEmail: "NONE" }).email).toBeNull();
    expect(thongBaoSauLuu({ email: "", trangThaiEmail: "QUEUED" }).email).toBeNull();
  });
  it("QUEUED chỉ được nói 'sẽ gửi', không nói 'đã gửi'", () => {
    const e = thongBaoSauLuu({ email: "an@gmail.com", trangThaiEmail: "QUEUED" }).email!;
    expect(e).toMatch(/sẽ gửi/);
    expect(e).not.toMatch(/đã gửi/);
  });
  it("SENT mới được nói 'đã gửi'; luôn che email", () => {
    const e = thongBaoSauLuu({ email: "an@gmail.com", trangThaiEmail: "SENT" }).email!;
    expect(e).toMatch(/đã gửi/);
    expect(e).toContain("a***@gmail.com");
    expect(e).not.toContain("an@gmail.com");
  });
  it("chưa xác minh ⇒ đòi xác minh, không nói đã gửi báo cáo", () => {
    const e = thongBaoSauLuu({ email: "an@gmail.com", trangThaiEmail: "VERIFICATION_REQUIRED" }).email!;
    expect(e).toMatch(/xác minh/);
    expect(e).not.toMatch(/đã gửi thông tin kết quả/);
  });
  it("chưa xác minh ⇒ KHÔNG khẳng định đã gửi liên kết (luồng gửi chưa chắc đã chạy) và nói chưa gửi báo cáo", () => {
    const e = thongBaoSauLuu({ email: "an@gmail.com", trangThaiEmail: "VERIFICATION_REQUIRED" }).email!;
    expect(e).not.toMatch(/đã gửi/);
    expect(e).toMatch(/sẽ gửi liên kết xác minh/);
    expect(e).toMatch(/chưa gửi báo cáo/);
    expect(e).toContain("a***@gmail.com");
    expect(e).not.toContain("an@gmail.com");
  });
  it("[EMAIL-TRUNG-THUC] link đã xếp hàng ⇒ 'sẽ gửi liên kết xác minh'; chưa gửi được ⇒ nói thẳng, vẫn tải được kết quả", () => {
    const ok = thongBaoSauLuu({ email: "an@gmail.com", trangThaiEmail: "VERIFICATION_REQUIRED", linkXacMinh: "DA_XEP_HANG" }).email!;
    expect(ok).toMatch(/sẽ gửi liên kết xác minh/);
    expect(ok).not.toMatch(/đã gửi/);
    const loi = thongBaoSauLuu({ email: "an@gmail.com", trangThaiEmail: "VERIFICATION_REQUIRED", linkXacMinh: "CHUA_GUI_DUOC" }).email!;
    expect(loi).toMatch(/chưa gửi được liên kết xác minh/);
    expect(loi).toMatch(/vẫn tải được kết quả/);
    expect(loi).not.toMatch(/sẽ gửi|đã gửi/);
    expect(loi).toContain("a***@gmail.com");
    expect(loi).not.toContain("an@gmail.com");
  });
  it("[EMAIL-TRUNG-THUC] `linkXacMinh` không đổi câu chính, và không có tác dụng khi không có email / trạng thái khác", () => {
    const a = thongBaoSauLuu({ email: "an@gmail.com", trangThaiEmail: "VERIFICATION_REQUIRED", linkXacMinh: "CHUA_GUI_DUOC" });
    const b = thongBaoSauLuu({ email: "an@gmail.com", trangThaiEmail: "VERIFICATION_REQUIRED", linkXacMinh: "DA_XEP_HANG" });
    expect(a.chinh).toBe(b.chinh);
    expect(thongBaoSauLuu({ email: null, trangThaiEmail: "NONE", linkXacMinh: "CHUA_GUI_DUOC" }).email).toBeNull();
    expect(thongBaoSauLuu({ email: "an@gmail.com", trangThaiEmail: "QUEUED", linkXacMinh: "CHUA_GUI_DUOC" }).email).toMatch(/sẽ gửi thông tin kết quả/);
  });
  it("FAILED không nói đã gửi", () => {
    expect(thongBaoSauLuu({ email: "an@gmail.com", trangThaiEmail: "FAILED" }).email).not.toMatch(/đã gửi/);
  });
});

describe("[DISC-TB-03] che SĐT/email", () => {
  it("0905123456 và 84905123456 cho cùng kết quả, không lộ số đầy đủ", () => {
    expect(chePhone("0905123456")).toBe("0905 *** 456");
    expect(chePhone("84905123456")).toBe("0905 *** 456");
    expect(chePhone("0905123456")).not.toContain("123");
  });
  it("[F-18] chưa xác minh ⇒ chỉ 3 chữ số cuối, mọi dạng nhập cho cùng kết quả", () => {
    for (const raw of ["0905123456", "84905123456", "+84 905 123 456", "0905.123.456"]) {
      expect(chePhoneChuaXacMinh(raw)).toBe("*** *** 456");
    }
    const ra = chePhoneChuaXacMinh("0905123456");
    expect(ra.replace(/\D/g, "")).toBe("456"); // đúng 3 chữ số, không hơn
    expect(ra).not.toContain("0905");
    expect(ra).not.toContain("123");
  });
  it("[F-18] đầu vào hỏng/ngắn ⇒ che hết, không lộ chữ số nào", () => {
    expect(chePhoneChuaXacMinh("12")).toBe("***");
    expect(chePhoneChuaXacMinh("")).toBe("***");
    expect(chePhoneChuaXacMinh("90512345")).toBe("***");
  });
  it("đầu vào hỏng ⇒ che hết", () => {
    expect(chePhone("12")).toBe("***");
    expect(cheEmail("khong-co-a-cong")).toBe("***");
  });
});
