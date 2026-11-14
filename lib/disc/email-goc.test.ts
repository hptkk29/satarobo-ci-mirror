import { describe, expect, it } from "vitest";
import { gocUngDungEmail } from "./email-goc";

describe("[DISC-EGC-01] gốc URL trong thư DISC", () => {
  it("lấy biến đầu tiên hợp lệ theo thứ tự NEXTAUTH_URL → AUTH_URL → NEXT_PUBLIC_APP_URL; bỏ đường dẫn/dấu / cuối", () => {
    expect(gocUngDungEmail({ NEXTAUTH_URL: "https://satarobo.vn/", AUTH_URL: "https://khac.vn" })).toBe("https://satarobo.vn");
    expect(gocUngDungEmail({ AUTH_URL: "https://test.satarobo.vn/abc?x=1" })).toBe("https://test.satarobo.vn");
    expect(gocUngDungEmail({ NEXT_PUBLIC_APP_URL: "https://satarobo.vn" })).toBe("https://satarobo.vn");
  });
  it("biến sai (http công khai · có thông tin đăng nhập · không phải URL) bị BỎ QUA và rơi sang biến kế", () => {
    expect(gocUngDungEmail({ NEXTAUTH_URL: "http://satarobo.vn", AUTH_URL: "https://ok.satarobo.vn" })).toBe("https://ok.satarobo.vn");
    expect(gocUngDungEmail({ NEXTAUTH_URL: "https://u:p@evil.vn", NEXT_PUBLIC_APP_URL: "https://ok.vn" })).toBe("https://ok.vn");
    expect(gocUngDungEmail({ NEXTAUTH_URL: "khong-phai-url", AUTH_URL: "" })).toBeNull();
  });
  it("không có biến nào ⇒ null (nơi gọi phải dừng, không tự bịa tên miền)", () => {
    expect(gocUngDungEmail({})).toBeNull();
  });
  it("máy dev: http://localhost được chấp nhận; AFFILIATE_PUBLIC_ORIGIN và Host KHÔNG được dùng", () => {
    expect(gocUngDungEmail({ NEXTAUTH_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
    expect(gocUngDungEmail({ AFFILIATE_PUBLIC_ORIGIN: "https://satarobo.vn" })).toBeNull();
  });
});
