import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isLoginLimiterV2Enabled } from "@/lib/flags";

/**
 * LƯỚI GHIM DÂY NỐI của bộ giới hạn đăng nhập dùng chung (B4; mã ca: GHW). Hai nơi gọi (web `lib/auth.ts`, mobile `dich-vu.ts`) chạm DB/Auth.js nên test hành vi ở
 * `tests/mobile-api/xac-thuc.spec.ts` ([MA-39..43], mobile) và `tests/e2e/a0/gioi-han-dang-nhap-v2.spec.ts` (web, Playwright). Ở đây khoá những thứ CHỈ đọc mã mới thấy:
 *   · cờ mặc định TẮT và đường CŨ của web còn nguyên văn (bảo vệ luồng web khi cờ TẮT — rollback = tắt cờ);
 *   · `thanhCong()` (hoàn lượt + ghi dấu ấy) chỉ gọi SAU khi mật khẩu đã đúng — ghi dấu ấy trước là cho kẻ dò tự tạo "thiết bị quen".
 * Bỏ chú thích TRƯỚC khi soi (lời giải thích chứa đúng chuỗi đang tìm — bài học luật 11).
 */
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("giới hạn đăng nhập dùng chung — dây nối", () => {
  afterEach(() => {
    delete process.env.LOGIN_LIMITER_V2;
  });

  it("[GHW-01] cờ LOGIN_LIMITER_V2 mặc định TẮT; chỉ chuỗi đúng \"true\" mới bật", () => {
    delete process.env.LOGIN_LIMITER_V2;
    expect(isLoginLimiterV2Enabled()).toBe(false);
    for (const v of ["", "1", "TRUE", "yes", "false"]) {
      process.env.LOGIN_LIMITER_V2 = v;
      expect(isLoginLimiterV2Enabled()).toBe(false);
    }
    process.env.LOGIN_LIMITER_V2 = "true";
    expect(isLoginLimiterV2Enabled()).toBe(true);
  });

  it("[GHW-02] WEB: đường CŨ còn nguyên văn trong nhánh cờ TẮT (hai lời gọi rateLimit 10/phút/IP và 5/phút/định danh)", () => {
    const a = doc("lib/auth.ts");
    expect(a).toMatch(/rateLimit\(\{ key: `login:ip:\$\{ip\}`, max: 10, windowMs: 60_000 \}\)/);
    expect(a).toMatch(/rateLimit\(\{ key: `login:id:\$\{idKey\}`, max: 5, windowMs: 60_000 \}\)/);
    // cờ BẬT rẽ nhánh TRƯỚC đường cũ, và đường cũ nằm trong `else`
    expect(a).toMatch(/if \(isLoginLimiterV2Enabled\(\)\) \{[\s\S]*kiemTruocDangNhap\("web"[\s\S]*\} else \{[\s\S]*rateLimit\(\{ key: `login:ip:/);
  });

  it("[GHW-03] WEB: lỗi đếm ⇒ TỪ CHỐI (không cho qua) và `thanhCong()` chỉ gọi MỘT lần, SAU bcrypt.compare đúng", () => {
    const a = doc("lib/auth.ts");
    expect(a).toMatch(/catch \{\s*return null;/);
    expect(dem(a, /luotDangNhap\?\.thanhCong\(\)/g)).toBe(1);
    const iSoSanh = a.indexOf("bcrypt.compare(parsed.data.password, user.password)");
    const iNull = a.indexOf("if (!valid) return null;");
    const iThanhCong = a.indexOf("luotDangNhap?.thanhCong()");
    expect(iSoSanh).toBeGreaterThan(0);
    expect(iNull).toBeGreaterThan(iSoSanh);
    expect(iThanhCong).toBeGreaterThan(iNull); // SAU khi mật khẩu đã đúng
  });

  it("[GHW-04] MOBILE: `thanhCong()` chỉ gọi MỘT lần, SAU kiểm tra 'phụ huynh thuần' (nhân viên đúng mật khẩu không tạo dấu ấy); lỗi đếm ⇒ 503", () => {
    const m = doc("lib/mobile-api/xac-thuc/dich-vu.ts");
    expect(dem(m, /luotDangNhap\?\.thanhCong\(\)/g)).toBe(1);
    const iPh = m.indexOf("if (!laPhuHuynhThuan(user)) throw loi.thongTinSai();");
    expect(iPh).toBeGreaterThan(0);
    expect(m.indexOf("luotDangNhap?.thanhCong()")).toBeGreaterThan(iPh);
    expect(m).toMatch(/instanceof LoiKhongDemDuocChung\) throw loi\.bận\(30\)/);
  });

  it("[GHW-05] KHÔNG nơi nào nhận định danh thiết bị vào bộ giới hạn: cổng/động cơ không có tham số `thietBi*`, nơi gọi không truyền maThietBi", () => {
    for (const p of ["lib/security/gioi-han-dang-nhap/cong.ts", "lib/security/gioi-han-dang-nhap/dong-co.ts", "lib/security/gioi-han-dang-nhap/chinh-sach.ts"]) {
      expect(doc(p)).not.toMatch(/thietBi|maThietBi/i);
    }
    const m = doc("lib/mobile-api/xac-thuc/dich-vu.ts");
    const khoi = m.slice(m.indexOf("isLoginLimiterV2Enabled()"), m.indexOf("const user = await db.user.findFirst"));
    expect(khoi.length).toBeGreaterThan(200); // đối chứng: đã cắt đúng khối giới hạn (không rỗng, không lố)
    expect(khoi).not.toMatch(/maThietBi|thietBi/);
  });
});
