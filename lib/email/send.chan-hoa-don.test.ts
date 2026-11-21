// @vitest-environment node
//
// Ca [CGH-S*] — chốt chặn THỨ HAI nằm trong `sendEmail`: ngữ cảnh hoá đơn + môi trường không-phải-production ⇒ KHÔNG chạm nhà cung cấp
// (kể cả không dựng client Resend), log FAILED, trả ok:false. Nhà cung cấp là SPY: đo "có gọi hay không", không phải "trả gì".
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

const THU = { to: "khach@example.invalid", subject: "Hoá đơn", bodyText: "x", bodyHtml: "<p>x</p>" };
const HOA_DON = { ...THU, contextType: "HoaDonGuiEmail", contextId: "gui1", attachments: [{ filename: "hd.pdf", path: "https://r2.example.invalid/hd.pdf" }] };

const moiTruong = (kieu: "test" | "prod") => {
  vi.stubEnv("VERCEL_ENV", kieu === "prod" ? "production" : "preview");
  for (const k of ["NEXTAUTH_URL", "AUTH_URL", "NEXT_PUBLIC_APP_URL"]) vi.stubEnv(k, kieu === "prod" ? "https://satarobo.vn" : "https://test.satarobo.vn");
};

beforeEach(() => {
  vi.clearAllMocks();
  h.getClient.mockReturnValue({ emails: { send: h.emailSend } });
});
afterEach(() => vi.unstubAllEnvs());

describe("[CGH-S1] sendEmail với ngữ cảnh hoá đơn", () => {
  it("TEST ⇒ KHÔNG dựng client, KHÔNG gọi nhà cung cấp, log FAILED có dấu hiệu, trả ok:false (không bao giờ SENT)", async () => {
    moiTruong("test");
    const r = await sendEmail(HOA_DON);
    expect(r.ok).toBe(false);
    expect(h.getClient).not.toHaveBeenCalled();
    expect(h.emailSend).not.toHaveBeenCalled();
    expect(h.logUpdate).toHaveBeenCalledTimes(1);
    const ghi = (h.logUpdate.mock.calls[0] as unknown as [{ data: { status: string; failureReason: string; sentAt?: unknown; resendId?: unknown } }])[0].data;
    expect(ghi.status).toBe("FAILED");
    expect(ghi.failureReason.startsWith(DAU_CHAN_EMAIL_TEST)).toBe(true);
    expect(ghi.sentAt).toBeUndefined();
    expect(ghi.resendId).toBeUndefined();
    expect(h.tplUpdate).not.toHaveBeenCalled(); // không tăng sentCount của mẫu
    if (r.ok) throw new Error("không được ok");
    expect(r.error.startsWith(DAU_CHAN_EMAIL_TEST)).toBe(true);
  });

  it("TEST, chỉ host test.* (VERCEL_ENV=production) ⇒ vẫn chặn", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "https://test.satarobo.vn");
    const r = await sendEmail(HOA_DON);
    expect(r.ok).toBe(false);
    expect(h.emailSend).not.toHaveBeenCalled();
  });

  it("[đối chứng dương] PRODUCTION ⇒ gọi nhà cung cấp ĐÚNG MỘT lần, kèm đính kèm; SENT", async () => {
    moiTruong("prod");
    const r = await sendEmail({ ...HOA_DON, idempotencyKey: "hoa-don:gui1" });
    expect(r.ok).toBe(true);
    expect(h.emailSend).toHaveBeenCalledTimes(1);
    const [tham, opt] = h.emailSend.mock.calls[0] as unknown as [{ attachments: unknown[] }, { idempotencyKey: string }];
    expect(tham.attachments).toHaveLength(1);
    expect(opt.idempotencyKey).toBe("hoa-don:gui1");
    expect((h.logUpdate.mock.calls[0] as unknown as [{ data: { status: string } }])[0].data.status).toBe("SENT");
  });
});

describe("[CGH-S2] phạm vi CHỈ là email hoá đơn", () => {
  it.each([
    ["ngữ cảnh khác (Order)", { ...THU, contextType: "Order", contextId: "o1" }],
    ["không ngữ cảnh (OTP / thông báo)", THU],
  ])("TEST + %s ⇒ KHÔNG bị chặn (OTP, nhắc lịch… không đổi)", async (_t, tham) => {
    moiTruong("test");
    const r = await sendEmail(tham);
    expect(r.ok).toBe(true);
    expect(h.emailSend).toHaveBeenCalledTimes(1);
  });
});
