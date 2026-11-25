// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BIEN_GOC_XAC_THUC, gocXacThuc } from "@/lib/elearning/verify-origin";

const MAC_DINH = "https://e-learning.satarobo.vn/";
const voi = (v: string | undefined) => gocXacThuc(MAC_DINH, v === undefined ? {} : { [BIEN_GOC_XAC_THUC]: v });

describe("gốc địa chỉ tra cứu trên QR chứng nhận", () => {
  it("chưa đặt biến ⇒ gốc mặc định (bỏ dấu / cuối)", () => {
    expect(voi(undefined)).toBe("https://e-learning.satarobo.vn");
  });
  it("ĐỐI CHỨNG DƯƠNG: đặt https hợp lệ ⇒ dùng nó (chuẩn hoá chữ hoa và dấu / cuối)", () => {
    expect(voi("https://test.satarobo.vn")).toBe("https://test.satarobo.vn");
    expect(voi("  https://TEST.satarobo.vn/ ")).toBe("https://test.satarobo.vn");
  });
  it("giá trị sai ⇒ lùi về mặc định, KHÔNG sửa ngầm: http · có đường dẫn · có cổng · không phải tên miền · rỗng", () => {
    for (const x of ["http://test.satarobo.vn", "https://test.satarobo.vn/xac-thuc", "https://test.satarobo.vn:8443", "satarobo", "javascript:alert(1)", "https://", ""]) {
      expect(voi(x), x).toBe("https://e-learning.satarobo.vn");
    }
  });
  it("route tải PDF dùng hàm này để dựng verifyUrl (QR phát từ TEST không trỏ về PROD)", () => {
    const src = readFileSync(join(process.cwd(), "app/api/elearning/chung-nhan/route.ts"), "utf8");
    expect(src).toMatch(/gocXacThuc\(elearningHomeUrl\(\)\)/);
    expect(src).toMatch(/verifyUrl = `\$\{gocXacThuc\(elearningHomeUrl\(\)\)\}\/xac-thuc\//);
  });
});
