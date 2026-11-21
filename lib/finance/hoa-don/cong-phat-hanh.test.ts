// [PHM-W0] Dây nối gộp nhánh 30/09: `layCongHoaDon()` PHẢI trả đúng cổng do env quyết định.
// Trước khi gộp, thân hàm là `return null` ⇒ nút "Phát hành qua MISA" không bao giờ hiện, và KHÔNG
// ca nào đỏ (mọi test khác đều `vi.mock` hàm này). Ca này là thứ duy nhất đo dây nối thật.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { layCongHoaDon } from "./cong-phat-hanh";

describe("[PHM-W0] layCongHoaDon đọc cấu hình MISA từ env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("[VINW-CP-01] VIN: MODE off ⇒ null; sandbox đủ biến ⇒ cổng THẬT môi trường sandbox; thiếu biến ⇒ null", () => {
    vi.stubEnv("VIN_EINVOICE_MODE", "off");
    expect(layCongHoaDon("VIN_HOADON")).toBeNull();
    vi.stubEnv("VIN_EINVOICE_MODE", "sandbox");
    vi.stubEnv("VIN_EINVOICE_BASE_URL", "https://vin-thu.example.test");
    vi.stubEnv("VIN_EINVOICE_USERNAME", "u");
    vi.stubEnv("VIN_EINVOICE_PASSWORD", "p");
    const cong = layCongHoaDon("VIN_HOADON");
    expect(cong?.cheDo).toBe("HSM");
    expect(cong?.moiTruong).toBe("sandbox");
    vi.stubEnv("VIN_EINVOICE_PASSWORD", "");
    expect(layCongHoaDon("VIN_HOADON")).toBeNull();
  });

  it("[VINW-CP-02] KHÔNG rơi chéo: MISA bật mà VIN tắt ⇒ cổng VIN là null (và ngược lại) — không bao giờ dùng cổng của nhà cung cấp kia", () => {
    vi.stubEnv("MISA_EINVOICE_MODE", "gia-lap");
    vi.stubEnv("VIN_EINVOICE_MODE", "off");
    expect(layCongHoaDon("MISA_MEINVOICE")).not.toBeNull();
    expect(layCongHoaDon("VIN_HOADON")).toBeNull();
    vi.stubEnv("MISA_EINVOICE_MODE", "off");
    vi.stubEnv("VIN_EINVOICE_MODE", "sandbox");
    vi.stubEnv("VIN_EINVOICE_BASE_URL", "https://vin-thu.example.test");
    vi.stubEnv("VIN_EINVOICE_USERNAME", "u");
    vi.stubEnv("VIN_EINVOICE_PASSWORD", "p");
    expect(layCongHoaDon("MISA_MEINVOICE")).toBeNull();
    expect(layCongHoaDon()).toBeNull(); // mặc định = MISA
    expect(layCongHoaDon("VIN_HOADON")).not.toBeNull();
  });

  it("MODE off (mặc định) ⇒ null", () => {
    vi.stubEnv("MISA_EINVOICE_MODE", "off");
    expect(layCongHoaDon()).toBeNull();
  });

  it("MODE gia-lap ⇒ cổng mô phỏng (đối chứng dương: dây nối SỐNG)", () => {
    vi.stubEnv("MISA_EINVOICE_MODE", "gia-lap");
    const cong = layCongHoaDon();
    expect(cong?.cheDo).toBe("GIA_LAP");
    expect(cong?.moiTruong).toBe("gia-lap");
  });

  it("MODE sandbox thiếu biến ⇒ null (không dựng cổng nửa vời)", () => {
    vi.stubEnv("MISA_EINVOICE_MODE", "sandbox");
    vi.stubEnv("MISA_EINVOICE_BASE_URL", "");
    vi.stubEnv("MISA_EINVOICE_APP_ID", "");
    expect(layCongHoaDon()).toBeNull();
  });
});
