import { afterEach, describe, expect, it } from "vitest";

import { layThuNhap, thuNhapQuery } from "./dich-vu/thu-nhap";
import { LoiApiMobile } from "./xac-thuc/dich-vu";

describe("OD-10 (đọc) — Thu nhập thêm trên app: cờ + đầu vào, không cần DB", () => {
  afterEach(() => {
    delete process.env.THU_NHAP_THEM_ENABLED;
  });

  it("[TN-01] cờ THU_NHAP_THEM_ENABLED TẮT (mặc định) ⇒ 404 TRƯỚC khi đụng DB; chỉ đúng chuỗi 'true' mới bật", async () => {
    for (const v of [undefined, "false", "TRUE", "1", ""]) {
      if (v === undefined) delete process.env.THU_NHAP_THEM_ENABLED;
      else process.env.THU_NHAP_THEM_ENABLED = v;
      const e = await layThuNhap("u1", {}).catch((x: unknown) => x);
      expect(e, `cờ=${String(v)}`).toBeInstanceOf(LoiApiMobile);
      expect([(e as LoiApiMobile).code, (e as LoiApiMobile).status]).toEqual(["NOT_FOUND", 404]);
    }
  });

  it("[TN-02] ô tìm: cắt khoảng trắng, tối đa 60 ký tự; quá dài ⇒ từ chối (không cắt âm thầm)", () => {
    expect(thuNhapQuery.parse({ q: "  Lan  " }).q).toBe("Lan");
    expect(thuNhapQuery.safeParse({ q: "x".repeat(61) }).success).toBe(false);
    expect(thuNhapQuery.safeParse({ tt: "y".repeat(31) }).success).toBe(false);
  });
});
