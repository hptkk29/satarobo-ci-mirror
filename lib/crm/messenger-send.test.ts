// @vitest-environment node
/**
 * S-2b — DÀN XẾP GỬI TIN MESSENGER (cửa sổ 24h → giành chỗ PENDING → gửi → chốt sổ).
 *
 * Test GỌI THẬT `guiTraLoiMessenger()` và soi (a) provider có được gọi không + gọi với
 * gì, (b) THỨ TỰ ghi/gửi, (c) đúng cột nào được ghi. Không so chuỗi mã nguồn (quy ước 21).
 *
 * Điểm sống-còn được ghim ở đây: `MessengerConversation.respondedAt` CHỈ được set khi
 * tin đi THẬT. `lib/crm/sla.ts:71` đọc đúng cột đó để bật cảnh báo SLA-0 "chậm phản
 * hồi" — set nó cho một tin mô phỏng/thất bại là tự tay tắt cảnh báo của khách chưa ai
 * trả lời, tức báo cáo SLA đẹp lên bằng số liệu bịa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  nhatKy: [] as string[],
  convFindUnique: vi.fn(),
  convUpdate: vi.fn(),
  msgFindFirst: vi.fn(),
  msgCreate: vi.fn(),
  msgUpdate: vi.fn(),
  guiTinRaMeta: vi.fn(),
  messengerSendDaCauHinh: vi.fn(),
  getSetting: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    messengerConversation: { findUnique: h.convFindUnique, update: h.convUpdate },
    messengerMessage: { findFirst: h.msgFindFirst, create: h.msgCreate, update: h.msgUpdate },
  },
}));
vi.mock("@/lib/crm/meta-messenger-provider", () => ({
  guiTinRaMeta: h.guiTinRaMeta,
  messengerSendDaCauHinh: h.messengerSendDaCauHinh,
}));
vi.mock("@/lib/settings/service", () => ({ getSetting: h.getSetting }));

import { guiTraLoiMessenger } from "./messenger-send";

const BAY_GIO = new Date("2026-08-27T10:00:00Z");
const MOT_GIO_TRUOC = new Date("2026-08-27T09:00:00Z");
const HAI_NGAY_TRUOC = new Date("2026-08-25T10:00:00Z");

function goi(text = "Dạ em chào chị ạ") {
  return guiTraLoiMessenger({
    conversationId: "conv-1",
    text,
    sentByUserId: "u-sale",
    now: BAY_GIO,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.nhatKy.length = 0;

  h.convFindUnique.mockResolvedValue({
    id: "conv-1",
    pageId: "PAGE-1",
    psid: "PSID-9",
    respondedAt: null,
  });
  h.msgFindFirst.mockResolvedValue({ id: "msg-in", sentAt: MOT_GIO_TRUOC });
  h.msgCreate.mockImplementation(async () => {
    h.nhatKy.push("tao-dong-OUT");
    return { id: "msg-out" };
  });
  h.msgUpdate.mockImplementation(async () => {
    h.nhatKy.push("chot-so");
    return { id: "msg-out" };
  });
  h.convUpdate.mockImplementation(async () => {
    h.nhatKy.push("set-respondedAt");
    return {};
  });
  h.guiTinRaMeta.mockImplementation(async () => {
    h.nhatKy.push("goi-meta");
    return { ok: true, providerMessageId: "mid.abc" };
  });
  h.messengerSendDaCauHinh.mockReturnValue(true);
  h.getSetting.mockResolvedValue(true);
});

describe("[S-2b] đường thành công — tin đi thật", () => {
  it("gọi provider đúng Page/PSID/nội dung", async () => {
    await goi("Dạ bên em có lớp thử ạ");
    expect(h.guiTinRaMeta).toHaveBeenCalledTimes(1);
    expect(h.guiTinRaMeta).toHaveBeenCalledWith({
      pageId: "PAGE-1",
      psid: "PSID-9",
      text: "Dạ bên em có lớp thử ạ",
    });
  });

  it("GIÀNH CHỖ trước rồi mới gửi (MS-2): dòng OUT ghi TRƯỚC lời gọi Meta", async () => {
    await goi();
    expect(h.nhatKy.indexOf("tao-dong-OUT")).toBeGreaterThanOrEqual(0);
    expect(h.nhatKy.indexOf("tao-dong-OUT")).toBeLessThan(h.nhatKy.indexOf("goi-meta"));
  });

  it("dòng giành chỗ mang trạng thái PENDING + ghi người bấm gửi (attribution)", async () => {
    await goi();
    const data = h.msgCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.direction).toBe("OUT");
    expect(data.sendStatus).toBe("PENDING");
    expect(data.sentByUserId).toBe("u-sale");
  });

  it("gửi xong chốt sổ SENT + giữ `mid` của Meta để sau đối soát", async () => {
    const kq = await goi();
    const data = h.msgUpdate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.sendStatus).toBe("SENT");
    expect(data.providerMessageId).toBe("mid.abc");
    // MS-3: `mid` cũng vào externalEventId để echo của chính mình không đẻ tin trùng.
    expect(data.externalEventId).toBe("mid.abc");
    expect(kq).toEqual({
      ok: true,
      daGuiThat: true,
      messageId: "msg-out",
      providerMessageId: "mid.abc",
    });
  });

  it("CHỈ khi đi thật mới set respondedAt (nguồn của cảnh báo SLA-0)", async () => {
    await goi();
    expect(h.convUpdate).toHaveBeenCalledTimes(1);
    const arg = h.convUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.respondedAt).toEqual(BAY_GIO);
  });

  it("hội thoại đã có respondedAt ⇒ không ghi đè (giữ mốc phản hồi ĐẦU TIÊN)", async () => {
    h.convFindUnique.mockResolvedValue({
      id: "conv-1",
      pageId: "PAGE-1",
      psid: "PSID-9",
      respondedAt: MOT_GIO_TRUOC,
    });
    await goi();
    expect(h.convUpdate).not.toHaveBeenCalled();
  });

  it("`mid` trùng bản ghi cũ (echo về trước) ⇒ vẫn SENT, không ném", async () => {
    h.msgUpdate.mockRejectedValueOnce(Object.assign(new Error("Unique"), { code: "P2002" }));
    h.msgUpdate.mockImplementationOnce(async () => ({ id: "msg-out" }));
    const kq = await goi();
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.daGuiThat).toBe(true);
  });
});

describe("[S-2b] cửa sổ 24h của Meta — chặn TRƯỚC khi tốn một lời gọi", () => {
  it("tin đến cuối đã quá 24h ⇒ KHÔNG gọi Meta, KHÔNG ghi dòng OUT", async () => {
    h.msgFindFirst.mockResolvedValue({ id: "msg-in", sentAt: HAI_NGAY_TRUOC });
    const kq = await goi();
    expect(h.guiTinRaMeta).not.toHaveBeenCalled();
    expect(h.msgCreate).not.toHaveBeenCalled();
    expect(h.convUpdate).not.toHaveBeenCalled();
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.ma).toBe("NGOAI_CUA_SO_24H");
  });

  it("lời báo là câu người đọc hiểu (tiếng Việt, nói cách xử lý), không phải mã máy", async () => {
    h.msgFindFirst.mockResolvedValue({ id: "msg-in", sentAt: HAI_NGAY_TRUOC });
    const kq = await goi();
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.loi).toMatch(/24 giờ/);
    expect(kq.loi.length).toBeGreaterThan(30);
    expect(kq.loi).not.toMatch(/NGOAI_CUA_SO_24H/);
  });

  it("hội thoại chưa hề có tin đến ⇒ cũng chặn (Meta chỉ cho trả lời)", async () => {
    h.msgFindFirst.mockResolvedValue(null);
    const kq = await goi();
    expect(h.guiTinRaMeta).not.toHaveBeenCalled();
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.ma).toBe("CHUA_CO_TIN_DEN");
  });

  it("đúng mốc 24h ⇒ vẫn còn trong cửa sổ (biên tính bằng '>' chứ không '>=')", async () => {
    h.msgFindFirst.mockResolvedValue({
      id: "msg-in",
      sentAt: new Date(BAY_GIO.getTime() - 24 * 60 * 60 * 1000),
    });
    const kq = await goi();
    expect(kq.ok).toBe(true);
  });

  it("Meta VẪN từ chối vì cửa sổ (đua thời gian) ⇒ FAILED có mã, không phải lỗi 500 câm", async () => {
    h.guiTinRaMeta.mockResolvedValue({
      ok: false,
      ma: "NGOAI_CUA_SO_24H",
      maLoiMeta: "10/2018278",
      loiGoc: "outside of allowed window",
    });
    const kq = await goi();
    const data = h.msgUpdate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.sendStatus).toBe("FAILED");
    expect(data.errorCode).toBe("10/2018278");
    expect(h.convUpdate).not.toHaveBeenCalled();
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.loi).toMatch(/24 giờ/);
  });
});

describe("[S-2b] chế độ MÔ PHỎNG — phải NÓI THẬT là khách không nhận gì", () => {
  it("thiếu khoá Meta ⇒ không gọi API, ghi SIMULATED, KHÔNG set respondedAt", async () => {
    h.messengerSendDaCauHinh.mockReturnValue(false);
    const kq = await goi();
    expect(h.guiTinRaMeta).not.toHaveBeenCalled();
    const data = h.msgUpdate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.sendStatus).toBe("SIMULATED");
    expect(h.convUpdate).not.toHaveBeenCalled();
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.daGuiThat).toBe(false);
  });

  it("lời cảnh báo nói thẳng KHÁCH KHÔNG NHẬN (tiền lệ ZNS `SIMULATED`)", async () => {
    h.messengerSendDaCauHinh.mockReturnValue(false);
    const kq = await goi();
    expect(kq.ok).toBe(true);
    if (!kq.ok || kq.daGuiThat) return;
    expect(kq.canhBao).toMatch(/KHÔNG/);
    expect(kq.canhBao.toLowerCase()).toMatch(/khách|mô phỏng/);
  });

  it("có khoá nhưng công tắc `messenger.sendLive` TẮT ⇒ vẫn mô phỏng", async () => {
    h.getSetting.mockResolvedValue(false);
    const kq = await goi();
    expect(h.guiTinRaMeta).not.toHaveBeenCalled();
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.daGuiThat).toBe(false);
  });

  it("ĐỌC công tắc lỗi (DB sập) ⇒ coi như KHÔNG live — fail-closed (AD-2)", async () => {
    h.getSetting.mockRejectedValue(new Error("DB down"));
    const kq = await goi();
    expect(h.guiTinRaMeta).not.toHaveBeenCalled();
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    expect(kq.daGuiThat).toBe(false);
  });
});

describe("[S-2b] nhà cung cấp hỏng — không được kéo sập luồng trong nước", () => {
  it("provider trả lỗi ⇒ ghi FAILED + mã lỗi Meta, hàm KHÔNG ném", async () => {
    h.guiTinRaMeta.mockResolvedValue({
      ok: false,
      ma: "META_TU_CHOI",
      maLoiMeta: "190",
      loiGoc: "Invalid OAuth access token",
    });
    const kq = await goi();
    const data = h.msgUpdate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.sendStatus).toBe("FAILED");
    expect(data.errorCode).toBe("190");
    expect(String(data.errorMessage)).toContain("Invalid OAuth");
    expect(kq.ok).toBe(false);
  });

  it("provider NÉM ⇒ vẫn chốt sổ FAILED và trả kết quả, không vỡ ra 500 câm", async () => {
    h.guiTinRaMeta.mockRejectedValue(new Error("boom"));
    const kq = await goi();
    expect(h.msgUpdate).toHaveBeenCalled();
    const data = h.msgUpdate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.sendStatus).toBe("FAILED");
    expect(kq.ok).toBe(false);
  });

  it("hội thoại không tồn tại ⇒ lỗi có mã, không ghi gì", async () => {
    h.convFindUnique.mockResolvedValue(null);
    const kq = await goi();
    expect(h.msgCreate).not.toHaveBeenCalled();
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.ma).toBe("KHONG_CO_HOI_THOAI");
  });

  it("nội dung rỗng ⇒ chặn trước mọi thứ", async () => {
    const kq = await goi("   ");
    expect(h.msgCreate).not.toHaveBeenCalled();
    expect(h.guiTinRaMeta).not.toHaveBeenCalled();
    expect(kq.ok).toBe(false);
  });
});
