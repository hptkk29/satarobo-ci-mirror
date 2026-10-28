// @vitest-environment node
//
// Ca [CGA-N*] — ĐƯỜNG THẬT của "cấp tài khoản" và "reset mật khẩu": `notifyStaffAccountGranted` → (real) `sendEmail` → nhà cung cấp. Mock CHỈ ở các đầu:
// DB, cài đặt, ZNS và nhà cung cấp (spy). Cả hai hành động (`createUserAction`, `resetUserPasswordAction`) chỉ gọi hàm này với CÙNG dạng đầu vào, nên đo ở
// đây là đo cả hai (lưới [CGA-W*] canh việc không có đường thứ ba). Khoá: TEST ⇒ nhà cung cấp 0 lần, mật khẩu THẬT không xuất hiện ở bất kỳ nơi nào
// (đối số sendEmail, EmailLog, console); PROD ⇒ thư đi với mật khẩu thật, EmailLog vẫn mask.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MAT_KHAU = "Mk!Thu-9xQ7#zz";

const h = vi.hoisted(() => ({
  emailSend: vi.fn(async (_p: unknown, _o?: unknown) => ({ data: { id: "re_1" }, error: null })),
  getClient: vi.fn(),
  logCreate: vi.fn(async (_a: unknown) => ({ id: "log1" })),
  logUpdate: vi.fn(async (_a: unknown) => ({})),
  tplFind: vi.fn(async () => null),
  tplUpdate: vi.fn(async () => ({})),
  zns: vi.fn(async (_a: unknown) => ({})),
  sendSpy: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    emailLog: { create: h.logCreate, update: h.logUpdate },
    emailTemplate: { findUnique: h.tplFind, update: h.tplUpdate },
  },
}));
vi.mock("./resend", () => ({
  getResendClient: h.getClient,
  getFromEmail: () => "Sata Robo <x@example.invalid>",
  getReplyTo: () => undefined,
}));
vi.mock("@/lib/settings/service", () => ({ getSetting: vi.fn(async () => false) }));
vi.mock("@/lib/zalo/service", () => ({ sendZaloNotification: h.zns }));
// Bọc sendEmail THẬT bằng spy: đo đối số mà `staff-account.ts` đưa vào (lớp một), trong khi chốt chặn trong sendEmail (lớp hai) vẫn chạy thật.
vi.mock("./send", async (goc) => {
  const m = await goc<typeof import("./send")>();
  return { ...m, sendEmail: h.sendSpy.mockImplementation(m.sendEmail) };
});

import { notifyStaffAccountGranted } from "./staff-account";
import { DAU_CHAN_EMAIL_TEST } from "./chan-gui-hoa-don";

const moiTruong = (kieu: "test" | "prod") => {
  vi.stubEnv("VERCEL_ENV", kieu === "prod" ? "production" : "preview");
  for (const k of ["NEXTAUTH_URL", "AUTH_URL", "NEXT_PUBLIC_APP_URL"]) vi.stubEnv(k, kieu === "prod" ? "https://admin.satarobo.vn" : "https://test.satarobo.vn");
};

// Hai dạng đầu vào THẬT của hai hành động (xem app/(admin)/admin/users/_actions.ts): tạo tài khoản (đủ email + SĐT) và reset (cùng hình dạng, mật khẩu mới).
const TAO = { email: "ketoan.cs1.uat@example.invalid", phone: "84900000001", name: "UAT Kế toán CS1", roles: ["CENTER_ACCOUNTANT"], password: MAT_KHAU };
const RESET = { email: "ketoan.cs2.uat@example.invalid", phone: null, name: "UAT Kế toán CS2", roles: ["CENTER_ACCOUNTANT"], password: MAT_KHAU };
// Địa chỉ NHẬN THẬT (không phải .invalid): chặn không được dựa vào đuôi địa chỉ.
const DIA_CHI_THAT = { ...TAO, email: "nguoi.that@gmail.com" };

let consoleCalls: unknown[][];
beforeEach(() => {
  vi.clearAllMocks();
  h.getClient.mockReturnValue({ emails: { send: h.emailSend } });
  consoleCalls = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void consoleCalls.push(a));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const chuoi = (x: unknown) => JSON.stringify(x);
const khongLoMatKhau = () => {
  expect(chuoi(h.logCreate.mock.calls)).not.toContain(MAT_KHAU);
  expect(chuoi(h.logUpdate.mock.calls)).not.toContain(MAT_KHAU);
  expect(chuoi(h.zns.mock.calls)).not.toContain(MAT_KHAU);
  expect(chuoi(consoleCalls)).not.toContain(MAT_KHAU);
};

describe("[CGA-N1] TEST: không gửi thư cấp tài khoản / reset mật khẩu, bất kể địa chỉ nhận", () => {
  it.each([
    ["tạo tài khoản (@example.invalid)", TAO],
    ["reset mật khẩu (@example.invalid)", RESET],
    ["địa chỉ THẬT — đuôi không phải lớp an toàn", DIA_CHI_THAT],
  ])("%s ⇒ nhà cung cấp 0 lần, không dựng client; EmailLog FAILED có dấu hiệu; mật khẩu không lộ ở đâu", async (_t, vao) => {
    moiTruong("test");
    await notifyStaffAccountGranted(vao);
    expect(h.getClient).not.toHaveBeenCalled();
    expect(h.emailSend).not.toHaveBeenCalled();
    expect(h.logUpdate).toHaveBeenCalledTimes(1);
    const ghi = (h.logUpdate.mock.calls[0] as unknown as [{ data: { status: string; failureReason: string; sentAt?: unknown; resendId?: unknown } }])[0].data;
    expect(ghi.status).toBe("FAILED");
    expect(ghi.failureReason.startsWith(DAU_CHAN_EMAIL_TEST)).toBe(true);
    expect(ghi.sentAt).toBeUndefined();
    expect(ghi.resendId).toBeUndefined();
    expect(h.tplUpdate).not.toHaveBeenCalled(); // không tăng sentCount của mẫu
    khongLoMatKhau();
  });

  it("lớp MỘT độc lập: mật khẩu thật không bao giờ được đưa vào sendEmail (đối số bodyText/bodyHtml/logBody* chỉ có bản mask)", async () => {
    moiTruong("test");
    await notifyStaffAccountGranted(TAO);
    expect(h.sendSpy).toHaveBeenCalledTimes(1);
    const dsVao = (h.sendSpy.mock.calls[0] as unknown as [{ bodyText: string; bodyHtml: string; logBodyText: string; logBodyHtml: string }])[0];
    for (const k of ["bodyText", "bodyHtml", "logBodyText", "logBodyHtml"] as const) expect(dsVao[k]).not.toContain(MAT_KHAU);
    expect(dsVao.bodyText).toContain("••••••••");
  });

  it("chỉ host test.* (VERCEL_ENV=production) ⇒ vẫn chặn", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "https://test.satarobo.vn");
    await notifyStaffAccountGranted(TAO);
    expect(h.emailSend).not.toHaveBeenCalled();
    khongLoMatKhau();
  });

  it("ZNS cấp tài khoản KHÔNG đổi (chỉ tài khoản + link, không mật khẩu)", async () => {
    moiTruong("test");
    await notifyStaffAccountGranted(TAO);
    expect(h.zns).toHaveBeenCalledTimes(1);
    expect(chuoi(h.zns.mock.calls[0])).not.toContain(MAT_KHAU);
  });
});

describe("[CGA-N2] [đối chứng dương] PRODUCTION: hành vi cũ nguyên vẹn", () => {
  it.each([
    ["tạo tài khoản", TAO],
    ["reset mật khẩu", RESET],
  ])("%s ⇒ gọi nhà cung cấp ĐÚNG MỘT lần, thư mang mật khẩu thật; EmailLog SENT và bản lưu đã MASK", async (_t, vao) => {
    moiTruong("prod");
    await notifyStaffAccountGranted(vao);
    expect(h.emailSend).toHaveBeenCalledTimes(1);
    const [tham] = h.emailSend.mock.calls[0] as unknown as [{ text: string; html: string; to: string }];
    expect(tham.text).toContain(MAT_KHAU);
    expect(tham.html).toContain(MAT_KHAU);
    expect(tham.to).toContain(vao.email);
    // PROD: mật khẩu thật có trong ĐỐI SỐ sendEmail (đó là việc của thư), logBody* vẫn là bản mask
    const dsVao = (h.sendSpy.mock.calls[0] as unknown as [{ bodyText: string; logBodyText: string }])[0];
    expect(dsVao.bodyText).toContain(MAT_KHAU);
    expect(dsVao.logBodyText).not.toContain(MAT_KHAU);
    expect((h.logUpdate.mock.calls[0] as unknown as [{ data: { status: string } }])[0].data.status).toBe("SENT");
    const taoLog = (h.logCreate.mock.calls[0] as unknown as [{ data: { bodyText: string } }])[0].data;
    expect(taoLog.bodyText).not.toContain(MAT_KHAU); // mask CÓ SẴN từ trước (BGĐ 31/07) — không được hỏng
    expect(taoLog.bodyText).toContain("••••••••");
    expect(chuoi(h.logUpdate.mock.calls)).not.toContain(MAT_KHAU);
    expect(chuoi(consoleCalls)).not.toContain(MAT_KHAU);
  });
});

describe("[CGA-N3] không email ⇒ không có gì để chặn", () => {
  it("email null ⇒ không gọi sendEmail; ZNS vẫn chạy", async () => {
    moiTruong("test");
    await notifyStaffAccountGranted({ ...TAO, email: null });
    expect(h.logCreate).not.toHaveBeenCalled();
    expect(h.zns).toHaveBeenCalledTimes(1);
  });
});
