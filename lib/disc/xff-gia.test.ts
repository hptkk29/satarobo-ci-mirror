import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ipDiscChoGioiHan } from "./phone-key";

/**
 * [DISC-XFF-*] `X-Forwarded-For` GIẢ không được đổi khoá chặn tần suất của các route DISC.
 * Kẻ tấn công tự viết phần tử ĐẦU của XFF (proxy chỉ nối thêm IP thật vào CUỐI) — nếu khoá lấy phần tử đầu thì mỗi
 * lượt gọi một "IP" khác ⇒ trần IP (10/10', 5 OTP/giờ…) vô hiệu. Các ca [CIP-*] của `client-ip` đã canh hàm gốc; ở đây canh
 * ĐƯỜNG DISC: (A) hàm khoá dùng chung, (B) lưới ghim mã: mọi cổng vào DISC lấy IP qua hàm đó, không tự đọc header.
 * Dữ liệu GIẢ (dải tài liệu RFC 5737/3849).
 */
const h = (xff: string) => new Headers({ "x-forwarded-for": xff });

describe("[DISC-XFF-01] khoá IP theo phần tử CUỐI của XFF", () => {
  it("đổi phần tử đầu (do khách viết) không đổi khoá; đổi phần tử cuối thì đổi", () => {
    const a = ipDiscChoGioiHan(h("198.51.100.1, 203.0.113.9"));
    expect(a).toBe("203.0.113.9");
    expect(ipDiscChoGioiHan(h("198.51.100.77, 203.0.113.9"))).toBe(a);
    expect(ipDiscChoGioiHan(h("1.2.3.4, 5.6.7.8, 203.0.113.9"))).toBe(a);
    expect(ipDiscChoGioiHan(h("198.51.100.1, 203.0.113.10"))).not.toBe(a);
  });
  it("phần tử đầu là IPv6 giả khác /64 cũng vô hiệu; phần tử cuối IPv6 vẫn gộp /64", () => {
    expect(ipDiscChoGioiHan(h("2001:db8:aaaa::1, 2001:db8:1:2:aaaa::1"))).toBe(ipDiscChoGioiHan(h("2001:db8:bbbb::9, 2001:db8:1:2:bbbb::2")));
  });
});

const doc = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
/** Bỏ chú thích để câu giải thích bản vá không tự khớp mẫu (bài học luật 14). */
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("[DISC-XFF-02] lưới ghim mã: cổng vào DISC lấy IP qua hàm dùng chung", () => {
  it.each(["app/api/disc/bo-de/route.ts", "app/api/disc/luu/route.ts", "app/api/disc/tai/route.ts", "app/api/disc/xoa/route.ts"])("%s", (rel) => {
    const ma = boChuThich(doc(rel));
    expect(ma).toMatch(/ipDiscChoGioiHan\(\s*req\.headers\s*\)/); // neo vào LỜI GỌI, không vào dòng import
    expect(ma).not.toMatch(/x-forwarded-for/i); // không tự đọc header
    expect(ma).not.toMatch(/x-real-ip/i);
  });
  it("server action nhận bài: IP đến từ getRequestMetadata (luật chung) rồi gộp /64, không đọc header thô", () => {
    const ma = boChuThich(doc("app/(auth)/kich-hoat/nhan-disc-actions.ts"));
    expect(ma).toMatch(/getRequestMetadata\(\)/);
    expect(ma.match(/gopIpChoGioiHan\(/g)?.length).toBe(2); // xin OTP + nhận bài
    expect(ma).not.toMatch(/x-forwarded-for/i);
  });
});
