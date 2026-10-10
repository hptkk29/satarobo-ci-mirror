// @vitest-environment node
//
// Ca [QHD-*] — nhánh HOÁ ĐƠN của worker hàng đợi email (`processEmailQueue`, PLAN §7), bằng mock.
// Bản chạm DB của luật đọc lại hoá đơn ở `tests/finance/hoa-don-email.test.ts`; ở đây đo DÂY NỐI:
//   · dòng `contextType = HoaDonGuiEmail` ⇒ hỏi `chuanBiGuiHoaDon` TRƯỚC khi gửi;
//   · bị chặn (hoá đơn không còn hiệu lực) ⇒ FAILED ngay, KHÔNG gửi, ghi LOI lên lượt gửi;
//   · gửi được ⇒ `sendEmail` nhận đúng đính kèm + khoá chống gửi đôi, rồi ghi DA_GUI;
//   · dòng email THƯỜNG không đi qua nhánh này;
//   · GĐ 8 — cờ hoá đơn TẮT ⇒ dòng hoá đơn bị loại NGAY TRONG CÂU LẤY LÔ (bản SQL thật ở [HDE-10]),
//     và nếu vẫn lọt vào lô thì không đụng tới: không chuanBi, không gửi, không ghi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(async () => ({})),
  send: vi.fn(),
  chuanBi: vi.fn(),
  ghiKq: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db", () => ({
  db: {
    emailQueue: { findMany: h.findMany, update: h.update },
    emailTemplate: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock("./send", () => ({ sendEmail: h.send }));
vi.mock("@/lib/finance/hoa-don/dinh-kem-email", () => ({
  NGU_CANH_EMAIL_HOA_DON: "HoaDonGuiEmail",
  chuanBiGuiHoaDon: h.chuanBi,
  ghiKetQuaGuiHoaDon: h.ghiKq,
}));

import { cauLayHangDoi, processEmailQueue } from "./queue";

const dong = (o: Record<string, unknown> = {}) => ({
  id: "q1",
  toEmail: "ph@example.com",
  toName: null,
  templateKey: null,
  subject: "Hoá đơn điện tử 1C26TSR - 127",
  bodyText: "Nội dung",
  bodyHtml: "<p>Nội dung</p>",
  payload: {},
  contextType: "HoaDonGuiEmail",
  contextId: "gui1",
  attempts: 0,
  maxAttempts: 3,
  scheduledAt: new Date("2026-09-26T00:00:00Z"),
  ...o,
});
const DINH_KEM = [{ filename: "hd.pdf", path: "https://r2.test/hoa-don/x.pdf" }];

beforeEach(() => {
  vi.clearAllMocks();
  h.send.mockResolvedValue({ ok: true, logId: "log1", resendId: "r1" });
});

describe("[QHD-01] dòng hoá đơn", () => {
  it("gửi được ⇒ sendEmail nhận đính kèm + idempotencyKey; ghi DA_GUI", async () => {
    h.findMany.mockResolvedValue([dong()]);
    h.chuanBi.mockResolvedValue({ ok: true, attachments: DINH_KEM, idempotencyKey: "hoa-don:gui1" });
    expect(await processEmailQueue(25, { guiHoaDon: true })).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(h.chuanBi).toHaveBeenCalledWith("gui1");
    expect(h.send.mock.calls[0]![0]).toMatchObject({ attachments: DINH_KEM, idempotencyKey: "hoa-don:gui1" });
    expect(h.ghiKq).toHaveBeenCalledWith("gui1", { daGui: true });
  });

  it("hoá đơn không còn hiệu lực (chặn) ⇒ FAILED ngay, KHÔNG gửi, lượt gửi LOI cuối cùng", async () => {
    h.findMany.mockResolvedValue([dong()]);
    h.chuanBi.mockResolvedValue({ ok: false, chan: true, loi: "Hoá đơn không còn hiệu lực" });
    expect(await processEmailQueue(25, { guiHoaDon: true })).toEqual({ processed: 1, sent: 0, failed: 1 });
    expect(h.send).not.toHaveBeenCalled();
    expect((h.update.mock.calls[0] as unknown as [{ data: { status: string } }])[0].data.status).toBe("FAILED");
    expect(h.ghiKq).toHaveBeenCalledWith("gui1", { daGui: false, loi: "Hoá đơn không còn hiệu lực", cuoiCung: true });
  });

  it("lỗi tạm (ký URL hỏng) ⇒ giữ PENDING để thử lại, lượt gửi CHƯA LOI", async () => {
    h.findMany.mockResolvedValue([dong()]);
    h.chuanBi.mockResolvedValue({ ok: false, chan: false, loi: "Kho chưa cấu hình" });
    await processEmailQueue(25, { guiHoaDon: true });
    expect(h.send).not.toHaveBeenCalled();
    expect((h.update.mock.calls[0] as unknown as [{ data: { status: string } }])[0].data.status).toBe("PENDING");
    expect(h.ghiKq).toHaveBeenCalledWith("gui1", { daGui: false, loi: "Kho chưa cấu hình", cuoiCung: false });
  });

  it("Resend lỗi ở lần cuối ⇒ lượt gửi LOI cuối cùng", async () => {
    h.findMany.mockResolvedValue([dong({ attempts: 2 })]);
    h.chuanBi.mockResolvedValue({ ok: true, attachments: DINH_KEM, idempotencyKey: "hoa-don:gui1" });
    h.send.mockResolvedValue({ ok: false, logId: "log1", error: "rate limited" });
    await processEmailQueue(25, { guiHoaDon: true });
    expect(h.ghiKq).toHaveBeenCalledWith("gui1", { daGui: false, loi: "rate limited", cuoiCung: true });
  });
});

describe("[QHD-04] dòng hoá đơn THIẾU nội dung ⇒ lượt gửi về LOI cuối cùng (không kẹt 'Đang gửi')", () => {
  it("subject/body rỗng ⇒ FAILED ở hàng đợi VÀ ghi kết quả hoá đơn cuoiCung = true", async () => {
    h.findMany.mockResolvedValue([dong({ subject: null, bodyText: null, bodyHtml: null })]);
    h.chuanBi.mockResolvedValue({ ok: true, attachments: DINH_KEM, idempotencyKey: "hoa-don:gui1" });
    expect(await processEmailQueue(25, { guiHoaDon: true })).toEqual({ processed: 1, sent: 0, failed: 1 });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.ghiKq).toHaveBeenCalledWith("gui1", { daGui: false, loi: "Thiếu nội dung email", cuoiCung: true });
  });

  it("đối chứng: dòng THƯỜNG thiếu nội dung ⇒ không đụng tới lượt gửi hoá đơn", async () => {
    h.findMany.mockResolvedValue([dong({ contextType: "Lead", contextId: "l1", subject: null, bodyText: null })]);
    await processEmailQueue(25, { guiHoaDon: true });
    expect(h.ghiKq).not.toHaveBeenCalled();
  });
});

describe("[QHD-02] dòng email THƯỜNG không đi qua nhánh hoá đơn", () => {
  it("contextType khác ⇒ không hỏi chuanBi, không đính kèm, không ghi lượt gửi hoá đơn", async () => {
    h.findMany.mockResolvedValue([dong({ contextType: "Lead", contextId: "l1" })]);
    await processEmailQueue(25, { guiHoaDon: true });
    expect(h.chuanBi).not.toHaveBeenCalled();
    expect(h.ghiKq).not.toHaveBeenCalled();
    expect(h.send.mock.calls[0]![0]).toMatchObject({ attachments: undefined, idempotencyKey: undefined });
  });
});

describe("[QHD-03] cờ hoá đơn TẮT ⇒ dòng hoá đơn nằm nguyên PENDING, email thường vẫn đi", () => {
  const NOW = new Date("2026-09-27T03:00:00Z");
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("câu lấy lô LOẠI dòng hoá đơn (giữ cả dòng không ngữ cảnh — NULL <> 'x' không phải true)", async () => {
    h.findMany.mockResolvedValue([]);
    await processEmailQueue(25, { guiHoaDon: false });
    expect(h.findMany).toHaveBeenCalledWith(cauLayHangDoi(NOW, 25, { guiHoaDon: false }));
    expect((h.findMany.mock.calls[0] as unknown as [{ where: unknown; take: number }])[0]).toMatchObject({
      where: {
        status: "PENDING",
        scheduledAt: { lte: NOW },
        OR: [{ contextType: null }, { contextType: { not: "HoaDonGuiEmail" } }],
      },
      take: 25,
    });
  });

  it("dòng hoá đơn vẫn lọt vào lô ⇒ KHÔNG chuanBi, KHÔNG gửi, KHÔNG ghi; dòng thường cùng lô vẫn gửi", async () => {
    h.findMany.mockResolvedValue([dong(), dong({ id: "q2", contextType: "Lead", contextId: "l1" })]);
    expect(await processEmailQueue(25, { guiHoaDon: false })).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(h.chuanBi).not.toHaveBeenCalled();
    expect(h.ghiKq).not.toHaveBeenCalled();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0]![0]).toMatchObject({ contextType: "Lead" });
    expect(h.update.mock.calls.map((c) => (c as unknown as [{ where: { id: string } }])[0].where.id)).toEqual(["q2"]);
  });
});

describe("[QHD-05] đối chứng: cờ BẬT ⇒ câu lấy lô không lọc ngữ cảnh, dòng hoá đơn được gửi", () => {
  it("không có nhánh OR; dòng hoá đơn đi qua chuanBi + gửi", async () => {
    h.findMany.mockResolvedValue([dong()]);
    h.chuanBi.mockResolvedValue({ ok: true, attachments: DINH_KEM, idempotencyKey: "hoa-don:gui1" });
    expect(await processEmailQueue(25, { guiHoaDon: true })).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect((h.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where).not.toHaveProperty("OR");
    expect(h.chuanBi).toHaveBeenCalledWith("gui1");
  });
});
