// @vitest-environment node
//
// Ca [CGA-S*] — chốt chặn THỨ HAI nằm trong `sendEmail` cho ngữ cảnh cấp tài khoản: dù một đường khác gọi thẳng `sendEmail` với mật khẩu THẬT trong
// thân thư, môi trường không-phải-production ⇒ KHÔNG chạm nhà cung cấp (kể cả không dựng client), log FAILED, trả ok:false. Nhà cung cấp là SPY.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  emailSend: vi.fn(async () => ({ data: { id: "re_1" }, error: null })),
  getClient: vi.fn(),
  logCreate: vi.fn(async () => ({ id: "log1" })),
  logUpdate: vi.fn(async () => ({})),
  tplUpdate: vi.fn(async () => ({})),
}));
vi.mock("@/lib/db", () => ({
  db: { emailLog: { create: h.logCreate, update: h.logUpdate }, emailTemplate: { update: h.tplUpdate } },
}));
vi.mock("./resend", () => ({
  getResendClient: h.getClient,
  getFromEmail: () => "Sata Robo <x@example.invalid>",
  getReplyTo: () => undefined,
}));

import { sendEmail } from "./send";
import { DAU_CHAN_EMAIL_TEST } from "./chan-gui-hoa-don";

const THU = { to: "nguoi.that@gmail.com", subject: "Cấp tài khoản", bodyText: "Mật khẩu: Mk!Thu-9xQ7", bodyHtml: "<p>Mật khẩu: Mk!Thu-9xQ7</p>" };
const CAP_TAI_KHOAN = { ...THU, contextType: "STAFF_ACCOUNT_GRANTED", contextId: "0900000001" };

const moiTruong = (kieu: "test" | "prod") => {
  vi.stubEnv("VERCEL_ENV", kieu === "prod" ? "production" : "preview");
  for (const k of ["NEXTAUTH_URL", "AUTH_URL", "NEXT_PUBLIC_APP_URL"]) vi.stubEnv(k, kieu === "prod" ? "https://admin.satarobo.vn" : "https://test.satarobo.vn");
};

beforeEach(() => {
  vi.clearAllMocks();
  h.getClient.mockReturnValue({ emails: { send: h.emailSend } });
});
afterEach(() => vi.unstubAllEnvs());

describe("[CGA-S1] sendEmail với ngữ cảnh cấp tài khoản", () => {
  it("TEST + địa chỉ THẬT ⇒ KHÔNG dựng client, KHÔNG gọi nhà cung cấp, log FAILED có dấu hiệu, trả ok:false", async () => {
    moiTruong("test");
    const r = await sendEmail(CAP_TAI_KHOAN);
    expect(r.ok).toBe(false);
    expect(h.getClient).not.toHaveBeenCalled();
    expect(h.emailSend).not.toHaveBeenCalled();
    const ghi = (h.logUpdate.mock.calls[0] as unknown as [{ data: { status: string; failureReason: string; sentAt?: unknown } }])[0].data;
    expect(ghi.status).toBe("FAILED");
    expect(ghi.failureReason.startsWith(DAU_CHAN_EMAIL_TEST)).toBe(true);
    expect(ghi.sentAt).toBeUndefined();
    expect(h.tplUpdate).not.toHaveBeenCalled();
    if (r.ok) throw new Error("không được ok");
    expect(r.error.startsWith(DAU_CHAN_EMAIL_TEST)).toBe(true);
  });

  it("[đối chứng dương] PRODUCTION ⇒ gọi nhà cung cấp ĐÚNG MỘT lần; SENT", async () => {
    moiTruong("prod");
    const r = await sendEmail(CAP_TAI_KHOAN);
    expect(r.ok).toBe(true);
    expect(h.emailSend).toHaveBeenCalledTimes(1);
    expect((h.logUpdate.mock.calls[0] as unknown as [{ data: { status: string } }])[0].data.status).toBe("SENT");
  });
});

describe("[CGA-S2] phạm vi CHỈ là thư cấp tài khoản", () => {
  it.each([
    ["ngữ cảnh khác (Order)", { ...THU, contextType: "Order", contextId: "o1" }],
    ["không ngữ cảnh (OTP / thông báo)", THU],
    ["ACCOUNT_ACTIVATED (thư kích hoạt của phụ huynh — không mang mật khẩu)", { ...THU, contextType: "ACCOUNT_ACTIVATED" }],
  ])("TEST + %s ⇒ KHÔNG bị chặn (hành vi cũ không đổi)", async (_t, tham) => {
    moiTruong("test");
    const r = await sendEmail(tham);
    expect(r.ok).toBe(true);
    expect(h.emailSend).toHaveBeenCalledTimes(1);
  });
});
