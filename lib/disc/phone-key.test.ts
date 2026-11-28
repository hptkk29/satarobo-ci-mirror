import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PEPPER_PHIEN_BAN_DUNG_CHUNG, ipKeyTuIp, layKhoaDisc, phienBanPepper, phoneKeyCuaSdt, phoneKeyTuSdtChuan } from "./phone-key";

// Dữ liệu GIẢ.
const KHOA = "k".repeat(32);
const KHOA_KHAC = "z".repeat(32);

describe("[DISC-PK-10] phoneKeyCuaSdt", () => {
  it("HMAC hex 64 ký tự, không chứa SĐT, không phải sha256 trần của SĐT chuẩn hoá hay thô", () => {
    const k = phoneKeyCuaSdt("0905 123 456", () => KHOA)!;
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(k).not.toContain("905123456");
    expect(k).not.toBe(createHash("sha256").update("84905123456").digest("hex"));
    expect(k).not.toBe(createHash("sha256").update("0905123456").digest("hex"));
  });
  it("mọi dạng gõ của cùng một SĐT ⇒ cùng khoá; SĐT khác ⇒ khoá khác", () => {
    const a = phoneKeyCuaSdt("0905123456", () => KHOA);
    expect(phoneKeyCuaSdt("+84 905 123 456", () => KHOA)).toBe(a);
    expect(phoneKeyCuaSdt("84905123456", () => KHOA)).toBe(a);
    expect(phoneKeyCuaSdt("0912345678", () => KHOA)).not.toBe(a);
  });
  it("phụ thuộc KHOÁ bí mật (đổi secret ⇒ đổi khoá — không dò được offline khi chỉ có DB)", () => {
    expect(phoneKeyCuaSdt("0905123456", () => KHOA)).not.toBe(phoneKeyCuaSdt("0905123456", () => KHOA_KHAC));
    expect(phoneKeyTuSdtChuan("84905123456", KHOA)).toBe(phoneKeyCuaSdt("0905123456", () => KHOA));
  });
  it("SĐT không hợp lệ ⇒ null (không băm rác)", () => {
    for (const x of ["12345", "", null, undefined, 123, "02363123456"]) expect(phoneKeyCuaSdt(x, () => KHOA)).toBeNull();
  });
  it("secret yếu ⇒ ném (không ký bằng khoá yếu) — khi dùng khoá mặc định", () => {
    const truoc = { n: process.env.NEXTAUTH_SECRET, a: process.env.AUTH_SECRET };
    process.env.NEXTAUTH_SECRET = "ngan";
    delete process.env.AUTH_SECRET;
    try {
      expect(() => phoneKeyCuaSdt("0905123456")).toThrow();
    } finally {
      if (truoc.n === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = truoc.n;
      if (truoc.a !== undefined) process.env.AUTH_SECRET = truoc.a;
    }
  });
});

describe("[DISC-PK-20] pepper riêng có phiên bản (N9)", () => {
  const KY = "n".repeat(40); // secret ký chung (giả)
  const PEPPER = "p".repeat(40);
  const dat = (env: Record<string, string | undefined>, fn: () => void) => {
    const truoc = { n: process.env.NEXTAUTH_SECRET, a: process.env.AUTH_SECRET };
    process.env.NEXTAUTH_SECRET = KY;
    delete process.env.AUTH_SECRET;
    try {
      fn();
    } finally {
      if (truoc.n === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = truoc.n;
      if (truoc.a !== undefined) process.env.AUTH_SECRET = truoc.a;
    }
    void env;
  };
  it("có DISC_PEPPER ⇒ khoá = pepper, phiên bản 'v1'; KHÔNG phụ thuộc secret ký (đổi NEXTAUTH_SECRET không đổi phoneKey)", () => {
    dat({}, () => {
      expect(layKhoaDisc({ DISC_PEPPER: PEPPER })).toBe(PEPPER);
      expect(phienBanPepper({ DISC_PEPPER: PEPPER })).toBe("v1");
      const a = phoneKeyCuaSdt("0905123456", () => layKhoaDisc({ DISC_PEPPER: PEPPER }));
      process.env.NEXTAUTH_SECRET = "doi-secret-ky-".repeat(4);
      const b = phoneKeyCuaSdt("0905123456", () => layKhoaDisc({ DISC_PEPPER: PEPPER }));
      expect(b).toBe(a);
    });
  });
  it("chưa đặt DISC_PEPPER ⇒ rơi về secret ký chung, phiên bản 'ns0' (đổi secret ký làm đổi phoneKey — runbook cấm xoay)", () => {
    dat({}, () => {
      expect(layKhoaDisc({})).toBe(KY);
      expect(phienBanPepper({})).toBe(PEPPER_PHIEN_BAN_DUNG_CHUNG);
      expect(phienBanPepper({ DISC_PEPPER: "" })).toBe("ns0");
    });
  });
  it("DISC_PEPPER ngắn (<32) ⇒ ném, KHÔNG âm thầm rơi về secret ký (thà lỗi to còn hơn băm bằng khoá yếu)", () => {
    dat({}, () => {
      expect(() => layKhoaDisc({ DISC_PEPPER: "ngan" })).toThrow(/DISC_PEPPER/);
      // thông báo lỗi không chứa giá trị khoá
      try {
        layKhoaDisc({ DISC_PEPPER: "bi-mat-ngan" });
      } catch (e) {
        expect(String((e as Error).message)).not.toContain("bi-mat-ngan");
      }
    });
  });
  it("DISC_PEPPER_VERSION hợp lệ được dùng làm nhãn; nhãn lạ ⇒ 'v1'", () => {
    expect(phienBanPepper({ DISC_PEPPER: PEPPER, DISC_PEPPER_VERSION: "v2" })).toBe("v2");
    expect(phienBanPepper({ DISC_PEPPER: PEPPER, DISC_PEPPER_VERSION: "a b;c" })).toBe("v1");
  });
  it("ipKeyTuIp: HMAC miền riêng, không chứa IP, khác phoneKey cùng khoá", () => {
    const k = ipKeyTuIp("203.0.113.9", KHOA);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(k).not.toContain("203.0.113.9");
    expect(ipKeyTuIp("203.0.113.9", KHOA_KHAC)).not.toBe(k);
    expect(ipKeyTuIp("203.0.113.10", KHOA)).not.toBe(k);
  });
});
