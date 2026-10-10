// @vitest-environment node
/**
 * GĐ3 — adapter gửi tin qua nick Zalo cá nhân.
 *
 * ⚠️ VÌ SAO BỘ NÀY TỒN TẠI. `ChannelSendOutcome` có bốn nhánh và ba trong số đó nghĩa
 * là **khách KHÔNG nhận được gì**. Cả bốn đều đi ra cùng một chỗ trên giao diện, nên
 * chọn nhầm nhánh là nói dối người trực — và đó đúng là lỗi đã từng để cả đội tin là
 * mình đã trả lời khách trong nhiều tháng (`lib/crm/messenger-send-gate.ts`).
 *
 * Hai ca đắt nhất ở đây:
 *  · fork nhận nhưng KHÔNG trả `msgId` ⇒ phải `FAILED`, không được `SENT` và tuyệt đối
 *    không bịa id — `providerMessageId` là thứ khớp bản echo về sau, bịa là mỗi tin
 *    hiện hai lần trong hội thoại;
 *  · khoá chống trùng phải được CHUYỂN TIẾP xuống fork. Thiếu nó, một lần mất phản hồi
 *    là khách nhận hai tin giống nhau — và tin đã đi thì không thu hồi được.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Bàn dựng ────────────────────────────────────────────────────────────────
type NickRow = { orgCode: string; status: string } | null;

const state = {
  nick: null as NickRow,
  whereNick: [] as unknown[],
  live: true as boolean | null,
  coKhoaApi: true,
  goi: [] as Array<{ orgCode: string; than: Record<string, unknown> }>,
  traLoi: { ok: true, data: { success: true, msgId: "m-1" } } as Record<string, unknown>,
};

vi.mock("@/lib/db", () => ({
  db: {
    zaloCrmNick: {
      findFirst: vi.fn(async (args: { where?: unknown }) => {
        state.whereNick.push(args?.where);
        return state.nick;
      }),
    },
  },
}));

vi.mock("@/lib/settings/service", () => ({
  getSetting: vi.fn(async (key: string) => {
    if (key === "inbox.zaloCaNhanLive") return state.live;
    throw new Error(`Unknown setting key: ${key}`);
  }),
}));

vi.mock("@/lib/integrations/zalocrm/client", () => ({
  docKhoaApi: vi.fn((orgCode: string) => (state.coKhoaApi ? `khoa-${orgCode}` : null)),
  guiTinZalocrm: vi.fn(async (orgCode: string, than: Record<string, unknown>) => {
    state.goi.push({ orgCode, than });
    return state.traLoi;
  }),
}));

import { zalocrmProvider } from "@/lib/integrations/zalocrm/provider";

const GUI = {
  accountId: "acc-1",
  externalUserId: "uid-khach",
  body: "Dạ vâng ạ",
  outboundKey: "ob-123",
};

beforeEach(() => {
  process.env.ZALOCRM_BASE_URL = "https://zalo.example.com";
  process.env.ZALOCRM_API_KEYS = '{"cs1":"k"}';
  state.nick = { orgCode: "cs1", status: "CONNECTED" };
  state.whereNick = [];
  state.live = true;
  state.coKhoaApi = true;
  state.goi = [];
  state.traLoi = { ok: true, data: { success: true, msgId: "m-1" } };
});

afterEach(() => {
  delete process.env.ZALOCRM_BASE_URL;
  delete process.env.ZALOCRM_API_KEYS;
  vi.clearAllMocks();
});

// ── Cấu hình ────────────────────────────────────────────────────────────────
describe("isConfigured — THUẦN, chỉ hỏi sự tồn tại của biến", () => {
  it("[ZC-PV-01] thiếu một trong hai biến ⇒ chưa cấu hình", () => {
    expect(zalocrmProvider.isConfigured()).toBe(true);
    delete process.env.ZALOCRM_API_KEYS;
    expect(zalocrmProvider.isConfigured()).toBe(false);
    process.env.ZALOCRM_API_KEYS = '{"cs1":"k"}';
    delete process.env.ZALOCRM_BASE_URL;
    expect(zalocrmProvider.isConfigured()).toBe(false);
  });

  it("[ZC-PV-02] khai kênh đúng — sổ đăng ký tra theo trường này", () => {
    expect(zalocrmProvider.channel).toBe("ZALO_CA_NHAN");
  });
});

// ── Công tắc ────────────────────────────────────────────────────────────────
describe("công tắc gửi thật", () => {
  it("[ZC-PV-03] công tắc TẮT ⇒ SIMULATED và KHÔNG gọi fork", async () => {
    state.live = false;
    const kq = await zalocrmProvider.send(GUI);
    expect(kq.status).toBe("SIMULATED");
    expect(state.goi, "tắt mà vẫn gọi API là đã gửi tin thật").toHaveLength(0);
  });

  it("[ZC-PV-04] chưa khai khoá kết nối ⇒ SIMULATED NOT_CONFIGURED, không gọi fork", async () => {
    delete process.env.ZALOCRM_API_KEYS;
    const kq = await zalocrmProvider.send(GUI);
    expect(kq).toMatchObject({ status: "SIMULATED", reason: "NOT_CONFIGURED" });
    expect(state.goi).toHaveLength(0);
  });
});

// ── Tra nick ────────────────────────────────────────────────────────────────
describe("tra nick để biết gửi bằng tổ chức nào", () => {
  it("[ZC-PV-05] không tìm thấy nick ⇒ FAILED có mã, KHÔNG gọi fork", async () => {
    state.nick = null;
    const kq = await zalocrmProvider.send(GUI);
    expect(kq).toMatchObject({ status: "FAILED", errorCode: "KHONG_BIET_NICK_NAO_GUI" });
    expect(state.goi).toHaveLength(0);
  });

  it("[ZC-PV-06] nick ĐÃ XOÁ MỀM không gửi được — `deletedAt: null` phải nằm trong where", async () => {
    // `ZaloCrmNick` KHÔNG ở `SOFT_DELETE_MODELS` nên không ai lọc hộ (nợ #4). Quên dòng
    // này là gửi từ một nick đã gỡ — tài khoản không còn ai trông.
    await zalocrmProvider.send(GUI);
    expect(state.whereNick[0]).toMatchObject({ zcrmAccountId: "acc-1", deletedAt: null });
  });

  it("[ZC-PV-07] cơ sở chưa khai khoá API ⇒ FAILED, mã NÊU TÊN cơ sở", async () => {
    state.coKhoaApi = false;
    const kq = await zalocrmProvider.send(GUI);
    expect(kq).toMatchObject({ status: "FAILED", errorCode: "CHUA_KHAI_KHOA_API_cs1" });
    expect(state.goi, "thiếu khoá mà vẫn gọi là chắc chắn 401").toHaveLength(0);
  });
});

// ── Gửi ─────────────────────────────────────────────────────────────────────
describe("gửi", () => {
  it("[ZC-PV-08] gửi được ⇒ SENT kèm ĐÚNG msgId của fork", async () => {
    const kq = await zalocrmProvider.send(GUI);
    expect(kq).toEqual({ status: "SENT", providerMessageId: "m-1" });
  });

  it("[ZC-PV-09] chuyển tiếp khoá chống trùng + gửi 1-1, không phải nhóm", async () => {
    await zalocrmProvider.send(GUI);
    expect(state.goi[0]?.orgCode).toBe("cs1");
    expect(state.goi[0]?.than).toMatchObject({
      zaloAccountId: "acc-1",
      threadId: "uid-khach",
      content: "Dạ vâng ạ",
      threadType: "user",
      idempotencyKey: "ob-123",
    });
  });

  it("[ZC-PV-10] fork nhận nhưng KHÔNG trả msgId ⇒ FAILED, tuyệt đối không bịa id", async () => {
    for (const than of [{ success: true }, { success: true, msgId: null }, { success: true, msgId: "  " }]) {
      state.traLoi = { ok: true, data: than };
      const kq = await zalocrmProvider.send(GUI);
      expect(kq, JSON.stringify(than)).toEqual({ status: "FAILED", errorCode: "THIEU_MSG_ID" });
    }
  });

  it("[ZC-PV-11] fork trả 429 (trần chống khoá nick) ⇒ FAILED có mã đọc được", async () => {
    state.traLoi = { ok: false, ma: "LOI_HTTP", httpStatus: 429 };
    const kq = await zalocrmProvider.send(GUI);
    expect(kq).toEqual({ status: "FAILED", errorCode: "LOI_HTTP_429" });
  });

  it("[ZC-PV-12] mất kết nối / hết giờ ⇒ FAILED giữ nguyên mã của lớp gọi", async () => {
    state.traLoi = { ok: false, ma: "HET_GIO" };
    expect(await zalocrmProvider.send(GUI)).toEqual({ status: "FAILED", errorCode: "HET_GIO" });
    state.traLoi = { ok: false, ma: "KHONG_KET_NOI" };
    expect(await zalocrmProvider.send(GUI)).toEqual({ status: "FAILED", errorCode: "KHONG_KET_NOI" });
  });

  it("[ZC-PV-13] KHÔNG có nhánh nào trả SENT khi chưa chắc tin đã đi", async () => {
    // Gom lại một chỗ: mọi lối hỏng phải ra SIMULATED/FAILED. `SENT` khoá mất cảnh báo
    // chậm phản hồi của phiếu, nên nói `SENT` sai là giấu luôn việc khách chưa được trả lời.
    const loi: Array<() => void> = [
      () => { state.live = false; },
      () => { state.nick = null; },
      () => { state.coKhoaApi = false; },
      () => { state.traLoi = { ok: false, ma: "HET_GIO" }; },
      () => { state.traLoi = { ok: true, data: { success: true } }; },
    ];
    for (const dung of loi) {
      state.live = true;
      state.nick = { orgCode: "cs1", status: "CONNECTED" };
      state.coKhoaApi = true;
      state.traLoi = { ok: true, data: { success: true, msgId: "m-1" } };
      dung();
      expect((await zalocrmProvider.send(GUI)).status).not.toBe("SENT");
    }
  });
});
