import { describe, expect, it } from "vitest";
import { gopIpChoGioiHan, ipDiscChoGioiHan, layKhoaDisc } from "./phone-key";

// Dữ liệu GIẢ. Không đọc đồng hồ.

describe("[DISC-PK-30] S-04: IP giới hạn — IPv6 gộp /64, IPv4 nguyên", () => {
  it("hai địa chỉ khác nhau trong CÙNG /64 ⇒ cùng một khoá; /64 khác ⇒ khoá khác", () => {
    const a = gopIpChoGioiHan("2001:db8:aaaa:bbbb:1:2:3:4");
    expect(gopIpChoGioiHan("2001:db8:aaaa:bbbb:ffff:ffff:ffff:ffff")).toBe(a);
    expect(gopIpChoGioiHan("2001:db8:aaaa:bbbb::1")).toBe(a);
    expect(gopIpChoGioiHan("2001:DB8:AAAA:BBBB::9")).toBe(a); // hoa/thường
    expect(gopIpChoGioiHan("[2001:db8:aaaa:bbbb::9]")).toBe(a); // ngoặc vuông
    expect(gopIpChoGioiHan("2001:db8:aaaa:bbbb::9%eth0")).toBe(a); // zone id
    expect(gopIpChoGioiHan("2001:db8:aaaa:bbbc::1")).not.toBe(a); // khác nhóm thứ 4
    expect(gopIpChoGioiHan("2001:db8:aaab:bbbb::1")).not.toBe(a);
  });
  it("IPv4 giữ nguyên; IPv4-mapped IPv6 quy về IPv4; 'unknown' và rác giữ nguyên", () => {
    expect(gopIpChoGioiHan("203.0.113.9")).toBe("203.0.113.9");
    expect(gopIpChoGioiHan("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(gopIpChoGioiHan("::ffff:cb00:7109")).toBe("203.0.113.9");
    expect(gopIpChoGioiHan("unknown")).toBe("unknown");
    expect(gopIpChoGioiHan("không-phải-ip")).toBe("không-phải-ip");
    expect(gopIpChoGioiHan("::1")).toBe(gopIpChoGioiHan("0:0:0:0:ffff:ffff:ffff:ffff")); // cùng /64 toàn số 0
  });
  it("ipDiscChoGioiHan: đi qua header thật rồi gộp /64 (hai IPv6 cùng /64 ở XFF ⇒ cùng khoá)", () => {
    const h = (ip: string) => new Headers({ "x-forwarded-for": ip });
    expect(ipDiscChoGioiHan(h("2001:db8:1:2:aaaa::1"))).toBe(ipDiscChoGioiHan(h("2001:db8:1:2:bbbb::2")));
    expect(ipDiscChoGioiHan(h("2001:db8:1:2:aaaa::1"))).not.toBe(ipDiscChoGioiHan(h("2001:db8:1:3:aaaa::1")));
    expect(ipDiscChoGioiHan(h("203.0.113.9"))).toBe("203.0.113.9");
  });
});

describe("[DISC-PK-40] S-08: production thật + DISC_ENABLED mà thiếu DISC_PEPPER ⇒ NÉM (không rơi về secret ký chung)", () => {
  const prod = { VERCEL_ENV: "production", DISC_ENABLED: "true", NEXTAUTH_SECRET: "n".repeat(40) };
  it("production + bật + thiếu pepper ⇒ ném, thông điệp không chứa giá trị khoá", () => {
    expect(() => layKhoaDisc(prod)).toThrow(/DISC_PEPPER/);
    expect(() => layKhoaDisc({ ...prod, DISC_PEPPER: "" })).toThrow(/DISC_PEPPER/);
    try {
      layKhoaDisc(prod);
    } catch (e) {
      expect(String(e)).not.toContain("n".repeat(40));
    }
  });
  it("production + bật + CÓ pepper hợp lệ ⇒ dùng pepper; pepper yếu vẫn ném như cũ", () => {
    expect(layKhoaDisc({ ...prod, DISC_PEPPER: "p".repeat(32) })).toBe("p".repeat(32));
    expect(() => layKhoaDisc({ ...prod, DISC_PEPPER: "ngan" })).toThrow(/32/);
  });
  it("KHÔNG làm đỏ môi trường khác: cờ tắt / CI / dev-test / preview ⇒ vẫn rơi về secret ký như trước", () => {
    const truoc = process.env.NEXTAUTH_SECRET;
    process.env.NEXTAUTH_SECRET = "n".repeat(40);
    try {
      expect(layKhoaDisc({ ...prod, DISC_ENABLED: undefined })).toBe("n".repeat(40)); // cờ tắt
      expect(layKhoaDisc({ NODE_ENV: "production", CI: "true", DISC_ENABLED: "true" })).toBe("n".repeat(40)); // build/e2e CI
      expect(layKhoaDisc({ NODE_ENV: "test", DISC_ENABLED: "true" })).toBe("n".repeat(40)); // vitest
      expect(layKhoaDisc({ VERCEL_ENV: "preview", DISC_ENABLED: "true" })).toBe("n".repeat(40));
    } finally {
      if (truoc === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = truoc;
    }
  });
  it("NODE_ENV=production không CI (VPS không có VERCEL_ENV) cũng là production thật ⇒ ném", () => {
    expect(() => layKhoaDisc({ NODE_ENV: "production", DISC_ENABLED: "true" })).toThrow(/DISC_PEPPER/);
  });
});
