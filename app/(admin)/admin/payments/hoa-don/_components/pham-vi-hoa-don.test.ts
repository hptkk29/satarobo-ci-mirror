/**
 * [HDNAV-P3] Gợi ý "cơ sở lần trước" của thanh phạm vi (phần client). THUẦN — kho được tiêm vào, không đụng localStorage thật.
 */
import { describe, expect, it } from "vitest";
import { docGoiYCoSo, ghiGoiYCoSo, khoaGoiYCoSo, khoTrinhDuyet } from "./pham-vi-hoa-don";

describe("[HDNAV-P3] gợi ý cơ sở lần trước — CHỈ gợi ý, khoá theo tài khoản, không bao giờ ném", () => {
  const kho = () => {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  const CS = [{ id: "cs1" }, { id: "cs2" }];

  it("khoá mang userId ⇒ hai tài khoản trên cùng trình duyệt không thấy gợi ý của nhau", () => {
    const k = kho();
    ghiGoiYCoSo(k, "u-an", "cs2");
    expect(docGoiYCoSo(k, "u-an", CS)).toBe("cs2");
    expect(docGoiYCoSo(k, "u-binh", CS)).toBeNull();
    expect(khoaGoiYCoSo("u-an")).toContain("u-an");
  });

  it("cơ sở đã lưu nhưng NGOÀI phạm vi hiện tại (đổi vai/đổi cơ sở) ⇒ bỏ, không bao giờ sống sót", () => {
    const k = kho();
    ghiGoiYCoSo(k, "u-an", "cs-cu-da-mat-quyen");
    expect(docGoiYCoSo(k, "u-an", CS)).toBeNull();
  });

  it("kho chặn/ném (cửa sổ riêng tư, thumbnail) ⇒ trả null / nuốt lỗi, trang vẫn dựng", () => {
    const hong = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(docGoiYCoSo(hong, "u-an", CS)).toBeNull();
    expect(() => ghiGoiYCoSo(hong, "u-an", "cs1")).not.toThrow();
    expect(docGoiYCoSo(null, "u-an", CS)).toBeNull();
    expect(() => ghiGoiYCoSo(null, "u-an", "cs1")).not.toThrow();
  });

  it("không lưu gì ngoài mã cơ sở (không PII)", () => {
    const k = kho();
    ghiGoiYCoSo(k, "u-an", "cs1");
    expect([...k.m.values()]).toEqual(["cs1"]);
  });
});

describe("[HDNAV-P3b] khoTrinhDuyet ở môi trường KHÔNG có window (SSR) ⇒ null", () => {
  it("không có window ⇒ null, không ném", () => {
    expect(typeof window).toBe("undefined"); // bộ này chạy ở môi trường node; ca có window nằm ở pham-vi-hoa-don.kho.test.ts
    expect(khoTrinhDuyet()).toBeNull();
  });
});
