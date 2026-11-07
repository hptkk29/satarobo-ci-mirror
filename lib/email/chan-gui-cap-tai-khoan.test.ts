// @vitest-environment node
//
// Ca [CGA-*] — môi trường nào BỊ CHẶN gửi email CẤP TÀI KHOẢN / RESET MẬT KHẨU (lib/email/chan-gui-cap-tai-khoan.ts). Thuần: truyền `env` vào hàm.
// Khoá: (1) test/dev/CI KHÔNG BAO GIỜ gửi thư mang mật khẩu; (2) PROD thật KHÔNG đổi hành vi; (3) quyết định KHÔNG phụ thuộc địa chỉ người nhận.
import { describe, expect, it } from "vitest";
import { chanGuiEmailCapTaiKhoan, laNguCanhEmailCapTaiKhoan, NGU_CANH_EMAIL_CAP_TAI_KHOAN } from "./chan-gui-cap-tai-khoan";
import { chanGuiEmailHoaDon, DAU_CHAN_EMAIL_TEST } from "./chan-gui-hoa-don";

const PROD_VPS = { VERCEL_ENV: "production", NODE_ENV: "production" };
const TEST_VPS = { VERCEL_ENV: "preview", NODE_ENV: "production", NEXTAUTH_URL: "https://test.satarobo.vn", NEXT_PUBLIC_APP_URL: "https://test.satarobo.vn" };

describe("[CGA-01] PRODUCTION thật KHÔNG bị chặn (không đổi hành vi prod)", () => {
  it.each([
    ["env prod VPS", PROD_VPS],
    ["prod + URL admin", { ...PROD_VPS, NEXTAUTH_URL: "https://admin.satarobo.vn", NEXT_PUBLIC_APP_URL: "https://satarobo.vn" }],
    ["`next start` thật không đặt VERCEL_ENV", { NODE_ENV: "production" }],
  ])("%s ⇒ chan:false", (_t, env) => {
    expect(chanGuiEmailCapTaiKhoan(env)).toEqual({ chan: false });
  });
});

describe("[CGA-02] TEST / dev / CI BỊ chặn", () => {
  it.each([
    ["env test VPS thật", TEST_VPS],
    ["chỉ VERCEL_ENV=preview", { VERCEL_ENV: "preview", NODE_ENV: "production" }],
    ["máy dev / vitest (NODE_ENV=test)", { NODE_ENV: "test" }],
    ["job CI chạy next start", { NODE_ENV: "production", CI: "true" }],
    ["env rỗng", {}],
    ["host test.* dù VERCEL_ENV=production", { ...PROD_VPS, NEXTAUTH_URL: "https://test.satarobo.vn" }],
  ])("%s ⇒ chặn", (_t, env) => {
    expect(chanGuiEmailCapTaiKhoan(env)).toMatchObject({ chan: true });
  });
  it("lý do mở đầu bằng dấu hiệu cố định, nói rõ thư không đi, KHÔNG nhắc 'hoá đơn'", () => {
    const r = chanGuiEmailCapTaiKhoan(TEST_VPS);
    if (!r.chan) throw new Error("phải chặn");
    expect(r.lyDo.startsWith(DAU_CHAN_EMAIL_TEST)).toBe(true);
    expect(r.lyDo).toMatch(/cấp tài khoản/);
    expect(r.lyDo).toMatch(/KHÔNG được gửi/);
    expect(r.lyDo).not.toMatch(/hoá đơn/);
  });
});

describe("[CGA-03] cùng MỘT quyết định môi trường với email hoá đơn (không nhân đôi luật)", () => {
  it.each([PROD_VPS, TEST_VPS, { NODE_ENV: "test" }, {}, { ...PROD_VPS, AUTH_URL: "https://test.satarobo.vn" }])("env %j: hai hàm cùng chan + cùng nguồn", (env) => {
    const a = chanGuiEmailCapTaiKhoan(env);
    const b = chanGuiEmailHoaDon(env);
    expect(a.chan).toBe(b.chan);
    if (a.chan && b.chan) expect(a.nguon).toBe(b.nguon);
  });
});

describe("[CGA-04] KHÔNG phụ thuộc địa chỉ nhận, KHÔNG có công tắc 'cho gửi thật'", () => {
  it("hàm không nhận địa chỉ; đặt đủ biến nghe như bật gửi thật trên env test ⇒ vẫn chặn", () => {
    expect(chanGuiEmailCapTaiKhoan.length).toBeLessThanOrEqual(1);
    const env = { ...TEST_VPS, ALLOW_REAL_EMAIL: "true", EMAIL_DRY_RUN: "0", SEND_REAL_EMAIL: "1", ACCOUNT_EMAIL_REAL: "1", RESEND_API_KEY: "re_xxx" };
    expect(chanGuiEmailCapTaiKhoan(env)).toMatchObject({ chan: true });
  });
});

describe("[CGA-05] nhận diện ngữ cảnh", () => {
  it("chỉ đúng STAFF_ACCOUNT_GRANTED", () => {
    expect(NGU_CANH_EMAIL_CAP_TAI_KHOAN).toBe("STAFF_ACCOUNT_GRANTED");
    expect(laNguCanhEmailCapTaiKhoan("STAFF_ACCOUNT_GRANTED")).toBe(true);
    for (const x of [null, undefined, "", "HoaDonGuiEmail", "ACCOUNT_ACTIVATED", "staff_account_granted"]) expect(laNguCanhEmailCapTaiKhoan(x)).toBe(false);
  });
});
