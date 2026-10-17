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
