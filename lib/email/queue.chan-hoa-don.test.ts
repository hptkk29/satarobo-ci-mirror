// @vitest-environment node
//
// Ca [CGH-Q*] — ĐƯỜNG THẬT của email hoá đơn: worker `processEmailQueue` → (real) `sendEmail` → nhà cung cấp. Mock CHỈ ở hai đầu:
// DB và nhà cung cấp (spy). Mọi đường gửi hoá đơn — xác nhận, gửi lại, retry, cron — đều dồn về dòng `EmailQueue` mà worker này lấy, nên đo ở
// đây là đo cả bốn. Khoá: TEST ⇒ nhà cung cấp 0 lần, hàng đợi FAILED dứt điểm, lượt hoá đơn LOI (không bao giờ DA_GUI); PROD ⇒ nguyên cũ.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  emailSend: vi.fn(async () => ({ data: { id: "re_1" }, error: null })),
  findMany: vi.fn(),
  qUpdate: vi.fn(async () => ({})),
  logCreate: vi.fn(async () => ({ id: "log1" })),
  logUpdate: vi.fn(async () => ({})),
  chuanBi: vi.fn(),
  ghiKq: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db", () => ({
  db: {
    emailQueue: { findMany: h.findMany, update: h.qUpdate },
    emailTemplate: { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})) },
    emailLog: { create: h.logCreate, update: h.logUpdate },
  },
}));
vi.mock("./resend", () => ({
  getResendClient: () => ({ emails: { send: h.emailSend } }),
  getFromEmail: () => "Sata Robo <x@example.invalid>",
  getReplyTo: () => undefined,
}));
vi.mock("@/lib/finance/hoa-don/dinh-kem-email", () => ({
  NGU_CANH_EMAIL_HOA_DON: "HoaDonGuiEmail",
  chuanBiGuiHoaDon: h.chuanBi,
  ghiKetQuaGuiHoaDon: h.ghiKq,
}));

import { processEmailQueue } from "./queue";
import { DAU_CHAN_EMAIL_TEST } from "./chan-gui-hoa-don";

const dong = (o: Record<string, unknown> = {}) => ({
  id: "q1",
  toEmail: "khach@example.invalid",
  toName: null,
  templateKey: null,
  subject: "Hoá đơn điện tử 1C26UAT - 1",
  bodyText: "Nội dung",
  bodyHtml: "<p>Nội dung</p>",
  payload: {},
  contextType: "HoaDonGuiEmail",
  contextId: "gui1",
  attempts: 0,
  maxAttempts: 3,
  scheduledAt: new Date("2026-10-25T00:00:00Z"),
  ...o,
});
const DINH_KEM = [{ filename: "hd.pdf", path: "https://r2.example.invalid/hoa-don/x.pdf" }];

const moiTruong = (kieu: "test" | "prod") => {
  vi.stubEnv("VERCEL_ENV", kieu === "prod" ? "production" : "preview");
  for (const k of ["NEXTAUTH_URL", "AUTH_URL", "NEXT_PUBLIC_APP_URL"]) vi.stubEnv(k, kieu === "prod" ? "https://satarobo.vn" : "https://test.satarobo.vn");
};

beforeEach(() => {
  vi.clearAllMocks();
  h.chuanBi.mockResolvedValue({ ok: true, attachments: DINH_KEM, idempotencyKey: "hoa-don:gui1" });
});
afterEach(() => vi.unstubAllEnvs());

const capNhatHangDoi = () => h.qUpdate.mock.calls.map((c) => (c as unknown as [{ data: Record<string, unknown> }])[0].data);

describe("[CGH-Q1] TEST: email hoá đơn KHÔNG đi", () => {
  it.each([
    ["lượt mới (xác nhận / gửi lại)", { attempts: 0 }],
    ["lượt retry (đã thử 2/3 — lẽ ra còn một lần)", { attempts: 2 }],
    ["lượt retry sau 'Gửi lại' thủ công (attempts reset, status PENDING)", { attempts: 0, scheduledAt: new Date("2026-10-24T00:00:00Z") }],
  ])("%s ⇒ nhà cung cấp 0 lần; không ký URL tệp; hàng đợi FAILED dứt điểm; lượt hoá đơn LOI cuối cùng", async (_t, ghiDe) => {
    moiTruong("test");
    h.findMany.mockResolvedValue([dong(ghiDe)]);
    const kq = await processEmailQueue(25, { guiHoaDon: true });
    expect(kq).toEqual({ processed: 1, sent: 0, failed: 1 });
    expect(h.emailSend).not.toHaveBeenCalled();
    expect(h.logCreate).not.toHaveBeenCalled(); // không đi tới sendEmail ⇒ không có cả dòng EmailLog
    expect(h.chuanBi).not.toHaveBeenCalled(); // chưa ký URL tệp hoá đơn
    const caps = capNhatHangDoi();
    expect(caps).toHaveLength(1);
    expect(caps[0]).toMatchObject({ status: "FAILED" }); // KHÔNG PENDING: không vòng retry
    expect(String(caps[0]!.error).startsWith(DAU_CHAN_EMAIL_TEST)).toBe(true);
    expect(caps[0]!.status).not.toBe("SENT");
    expect(h.ghiKq).toHaveBeenCalledTimes(1);
    const [guiId, ketQua] = h.ghiKq.mock.calls[0] as unknown as [string, { daGui: boolean; loi: string; cuoiCung: boolean }];
    expect(guiId).toBe("gui1");
    expect(ketQua.daGui).toBe(false); // không bao giờ "đã gửi"
    expect(ketQua.cuoiCung).toBe(true);
    expect(ketQua.loi.startsWith(DAU_CHAN_EMAIL_TEST)).toBe(true);
  });

  it("nhiều dòng một lô (hoá đơn + OTP) ⇒ chỉ dòng hoá đơn bị chặn; dòng thường vẫn đi", async () => {
    moiTruong("test");
    h.findMany.mockResolvedValue([dong(), dong({ id: "q2", contextType: null, contextId: null, toEmail: "otp@example.invalid", subject: "Mã OTP" })]);
    const kq = await processEmailQueue(25, { guiHoaDon: true });
    expect(kq).toEqual({ processed: 2, sent: 1, failed: 1 });
    expect(h.emailSend).toHaveBeenCalledTimes(1);
    expect((h.emailSend.mock.calls[0] as unknown as [{ to: string }])[0].to).toBe("otp@example.invalid");
  });

  it("cờ hoá đơn TẮT ⇒ dòng hoá đơn vẫn nằm nguyên (không ghi gì), nhà cung cấp 0 lần", async () => {
    moiTruong("test");
    h.findMany.mockResolvedValue([dong()]);
    await processEmailQueue(25, { guiHoaDon: false });
    expect(h.emailSend).not.toHaveBeenCalled();
    expect(h.qUpdate).not.toHaveBeenCalled();
    expect(h.ghiKq).not.toHaveBeenCalled();
  });
});

describe("[CGH-Q2] PRODUCTION: hành vi cũ NGUYÊN VẸN (đối chứng dương)", () => {
  it("dòng hoá đơn ⇒ ký URL tệp, gọi nhà cung cấp ĐÚNG MỘT lần kèm đính kèm + khoá chống gửi đôi, SENT, lượt hoá đơn DA_GUI", async () => {
    moiTruong("prod");
    h.findMany.mockResolvedValue([dong()]);
    const kq = await processEmailQueue(25, { guiHoaDon: true });
    expect(kq).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(h.chuanBi).toHaveBeenCalledTimes(1);
    expect(h.emailSend).toHaveBeenCalledTimes(1);
    const [tham, opt] = h.emailSend.mock.calls[0] as unknown as [{ attachments: unknown[]; to: string }, { idempotencyKey: string }];
    expect(tham.attachments).toEqual(DINH_KEM);
    expect(tham.to).toBe("khach@example.invalid");
    expect(opt.idempotencyKey).toBe("hoa-don:gui1");
    expect(capNhatHangDoi()[0]).toMatchObject({ status: "SENT" });
    expect(h.ghiKq).toHaveBeenCalledWith("gui1", { daGui: true });
  });
});
