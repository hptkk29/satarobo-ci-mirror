// @vitest-environment node
//
// Ca [CGH-*] — môi trường nào BỊ CHẶN gửi email hoá đơn (lib/email/chan-gui-hoa-don.ts). Thuần: truyền `env` vào hàm, không đụng process.env.
// Khoá đúng hai điều người vận hành cần: (1) test/dev/CI KHÔNG BAO GIỜ gửi thư hoá đơn thật; (2) PROD thật KHÔNG đổi hành vi.
import { describe, expect, it } from "vitest";
import { chanGuiEmailHoaDon, DAU_CHAN_EMAIL_TEST, laNguCanhEmailHoaDon, NGU_CANH_EMAIL_HOA_DON } from "./chan-gui-hoa-don";

// Hai env THẬT đo trên VPS 25/10/2026 (chỉ các khoá liên quan): env prod và env test của VPS.
const PROD_VPS = { VERCEL_ENV: "production", NODE_ENV: "production" };
const TEST_VPS = { VERCEL_ENV: "preview", NODE_ENV: "production", NEXTAUTH_URL: "https://test.satarobo.vn", NEXT_PUBLIC_APP_URL: "https://test.satarobo.vn" };

describe("[CGH-01] PRODUCTION thật KHÔNG bị chặn (không đổi hành vi prod)", () => {
  it.each([
    ["env prod VPS", PROD_VPS],
    ["prod + URL admin", { ...PROD_VPS, NEXTAUTH_URL: "https://admin.satarobo.vn", NEXT_PUBLIC_APP_URL: "https://satarobo.vn" }],
    ["prod không đặt VERCEL_ENV nhưng là `next start` thật (NODE_ENV=production, không CI)", { NODE_ENV: "production" }],
  ])("%s ⇒ chan:false", (_t, env) => {
    expect(chanGuiEmailHoaDon(env)).toEqual({ chan: false });
  });
});

describe("[CGH-02] TEST / dev / CI BỊ chặn", () => {
  it("env test VPS thật (VERCEL_ENV=preview, host test.satarobo.vn) ⇒ chặn", () => {
    const r = chanGuiEmailHoaDon(TEST_VPS);
    expect(r.chan).toBe(true);
  });
  it.each([
    ["chỉ VERCEL_ENV=preview", { VERCEL_ENV: "preview", NODE_ENV: "production" }, "KHONG_PHAI_PRODUCTION"],
    ["VERCEL_ENV=test (môi trường tuỳ biến)", { VERCEL_ENV: "test", NODE_ENV: "production" }, "KHONG_PHAI_PRODUCTION"],
    ["máy dev / vitest (NODE_ENV=test, không VERCEL_ENV)", { NODE_ENV: "test" }, "KHONG_PHAI_PRODUCTION"],
    ["job CI chạy `next start` (NODE_ENV=production + CI)", { NODE_ENV: "production", CI: "true" }, "KHONG_PHAI_PRODUCTION"],
    ["env rỗng", {}, "KHONG_PHAI_PRODUCTION"],
  ] as const)("%s ⇒ chặn (nguồn %s)", (_t, env, nguon) => {
    expect(chanGuiEmailHoaDon(env)).toMatchObject({ chan: true, nguon });
  });
});

describe("[CGH-03] lớp THỨ HAI độc lập: host test.* chặn dù lớp một nói 'production'", () => {
  it("env test thiếu VERCEL_ENV + `next start` thật ⇒ lớp một một mình KHÔNG chặn, host test.* chặn", () => {
    const thieuVercelEnv = { NODE_ENV: "production" };
    expect(chanGuiEmailHoaDon(thieuVercelEnv)).toEqual({ chan: false }); // đối chứng: không có lớp hai thì LỌT
    expect(chanGuiEmailHoaDon({ ...thieuVercelEnv, NEXTAUTH_URL: "https://test.satarobo.vn" })).toMatchObject({ chan: true, nguon: "HOST_TEST" });
  });
  it.each(["NEXTAUTH_URL", "AUTH_URL", "NEXT_PUBLIC_APP_URL"])("%s một mình mang host test.* ⇒ chặn dù VERCEL_ENV=production", (khoa) => {
    expect(chanGuiEmailHoaDon({ ...PROD_VPS, [khoa]: "https://test.satarobo.vn/" })).toMatchObject({ chan: true, nguon: "HOST_TEST" });
  });
  it.each(["https://testing.satarobo.vn", "https://contest.satarobo.vn", "https://satarobo.vn/test.html", "https://hocvien.satarobo.vn"])(
    "host KHÔNG bắt đầu bằng `test.` (%s) ⇒ không chặn oan prod",
    (url) => {
      expect(chanGuiEmailHoaDon({ ...PROD_VPS, NEXTAUTH_URL: url })).toEqual({ chan: false });
    },
  );
  it("URL hỏng / rỗng không ném lỗi và không chặn (lớp một vẫn quyết)", () => {
    expect(chanGuiEmailHoaDon({ ...PROD_VPS, NEXTAUTH_URL: "khong phai url", AUTH_URL: "", NEXT_PUBLIC_APP_URL: undefined })).toEqual({ chan: false });
  });
});

describe("[CGH-04] KHÔNG có công tắc 'cho gửi thật'", () => {
  it("đặt đủ thứ biến nghe như bật gửi thật trên env test ⇒ vẫn chặn", () => {
    const env = { ...TEST_VPS, HOA_DON_EMAIL_THAT: "1", ALLOW_REAL_EMAIL: "true", EMAIL_DRY_RUN: "0", SEND_REAL_EMAIL: "1", EMAIL_ENABLED: "true", RESEND_API_KEY: "re_xxx" };
    expect(chanGuiEmailHoaDon(env)).toMatchObject({ chan: true });
  });
});

describe("[CGH-05] lý do + nhận diện ngữ cảnh", () => {
  it("câu lý do mở đầu bằng dấu hiệu cố định và nói rõ thư không đi", () => {
    const r = chanGuiEmailHoaDon(TEST_VPS);
    if (!r.chan) throw new Error("phải chặn");
    expect(r.lyDo.startsWith(DAU_CHAN_EMAIL_TEST)).toBe(true);
    expect(r.lyDo).toMatch(/KHÔNG được gửi/);
    expect(r.lyDo).not.toMatch(/đã gửi thành công/i);
    expect(r.lyDo.length).toBeLessThanOrEqual(500); // `ghiKetQuaGuiHoaDon` cắt ở 500 — đừng để mất đuôi câu
  });
  it("chỉ ngữ cảnh HoaDonGuiEmail là email hoá đơn", () => {
    expect(NGU_CANH_EMAIL_HOA_DON).toBe("HoaDonGuiEmail");
    expect(laNguCanhEmailHoaDon("HoaDonGuiEmail")).toBe(true);
    for (const x of ["Order", "Lead", "", null, undefined, "hoadonguiemail"]) expect(laNguCanhEmailHoaDon(x)).toBe(false);
  });
});
