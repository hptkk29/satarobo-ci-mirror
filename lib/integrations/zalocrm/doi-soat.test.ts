// @vitest-environment node
/**
 * GĐ3 — lưới an toàn đối soát webhook.
 *
 * ⚠️ VÌ SAO BỘ NÀY TỒN TẠI. Đây là thứ chạy 288 lượt một ngày mà không ai nhìn. Hai
 * kiểu hỏng của nó đều IM LẶNG và ngược nhau:
 *  · quét thiếu ⇒ tin rơi vẫn rơi, và lưới chỉ tạo cảm giác đã có lưới;
 *  · quét mà ghi đè ⇒ mỗi 5 phút đẻ thêm một bản sao của cùng một tin.
 * Ca [ZC-DS-03] canh đúng vế thứ hai và là ca đắt nhất ở đây.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TinGia = { id: string; senderType?: string; content?: string; sentAt?: string };
type HoiGia = {
  id: string;
  threadType?: string;
  externalThreadId?: string;
  zaloAccountId?: string;
  contact?: { id: string; phone?: string | null; fullName?: string | null } | null;
};

const BAY_GIO = new Date("2026-09-13T10:00:00.000Z");
const MOI = "2026-09-13T09:55:00.000Z"; // trong cửa sổ 30 phút
const CU = "2026-09-13T08:00:00.000Z"; // ngoài cửa sổ

const state = {
  anhXa: { CS1: "cs1", CS2: "cs2" } as Record<string, string>,
  coKhoa: new Set<string>(["cs1", "cs2"]),
  hoiThoai: {} as Record<string, HoiGia[]>,
  tin: {} as Record<string, TinGia[]>,
  hoiThoaiLoi: new Set<string>(),
  /** Kho tin "đã nạp" — mô phỏng UNIQUE `channelMessageId`. */
  daNap: new Set<string>(),
  goiLayHoi: [] as Array<{ orgCode: string; since?: unknown }>,
  nhatKy: [] as Array<{ orgCode: string; status: string }>,
};

vi.mock("@/lib/settings/service", () => ({
  getSetting: vi.fn(async (key: string) => {
    if (key === "zalocrm.orgCodes") return state.anhXa;
    throw new Error(`Unknown setting key: ${key}`);
  }),
}));

vi.mock("@/lib/integrations/zalocrm/config", () => ({
  traCauHinhOrg: vi.fn(async (orgCode: string) => ({
    ok: true,
    cauHinh: { orgCode, secret: "s", centerId: `c-${orgCode}`, orgUnitId: `ou-${orgCode}` },
  })),
}));

vi.mock("@/lib/integrations/zalocrm/client", () => ({
  docKhoaApi: vi.fn((orgCode: string) => (state.coKhoa.has(orgCode) ? "k" : null)),
  layHoiThoaiZalocrm: vi.fn(async (orgCode: string, tuyChon: { since?: unknown }) => {
    state.goiLayHoi.push({ orgCode, since: tuyChon?.since });
    if (state.hoiThoaiLoi.has(orgCode)) return { ok: false, ma: "HET_GIO" };
    return { ok: true, data: { conversations: state.hoiThoai[orgCode] ?? [] } };
  }),
  layTinZalocrm: vi.fn(async (orgCode: string, convId: string) => ({
    ok: true,
    data: { messages: state.tin[`${orgCode}:${convId}`] ?? [] },
  })),
}));

vi.mock("@/lib/integrations/zalocrm/log", () => ({
  ghiNhatKyZalocrm: vi.fn(async (input: { orgCode: string; status: string }) => {
    state.nhatKy.push({ orgCode: input.orgCode, status: input.status });
    return "log-1";
  }),
}));

// `dichPayloadZalocrm` KHÔNG mock — đây chính là bộ luật phải dùng chung với webhook.
// `napSuKienZalocrm` mock để mô phỏng khoá UNIQUE `channelMessageId`.
vi.mock("@/lib/integrations/zalocrm/nap-su-kien", () => ({
  napSuKienZalocrm: vi.fn(async ({ viec }: { viec: { tin?: { channelMessageId?: string } } }) => {
    const khoa = viec?.tin?.channelMessageId ?? "";
    if (state.daNap.has(khoa)) return { ok: true, trung: true };
    state.daNap.add(khoa);
    return { ok: true, trung: false };
  }),
}));

// Tra trước theo lô (`traTinDaCo`) đọc CÙNG kho `daNap` với khoá UNIQUE giả ở trên.
vi.mock("@/lib/integrations/zalocrm/tin-da-co", () => ({
  traTinDaCo: vi.fn(async (_kenh: string, khoa: string[]) => new Set(khoa.filter((k) => state.daNap.has(k)))),
}));

import { doiSoatZalocrm, dungPayloadTuTin } from "@/lib/integrations/zalocrm/doi-soat";
import { napSuKienZalocrm } from "@/lib/integrations/zalocrm/nap-su-kien";

function dungBan() {
  state.anhXa = { CS1: "cs1" };
  state.coKhoa = new Set(["cs1"]);
  state.hoiThoai = {
    cs1: [
      {
        id: "conv-1",
        threadType: "user",
        externalThreadId: "uid-khach",
        zaloAccountId: "acc-1",
        contact: { id: "ct-1", phone: "0912345678", fullName: "Chị Lan" },
      },
    ],
  };
  state.tin = {
    "cs1:conv-1": [
      { id: "m-1", senderType: "contact", content: "Chào shop", sentAt: MOI },
      { id: "m-2", senderType: "self", content: "Dạ em đây", sentAt: MOI },
    ],
  };
  state.hoiThoaiLoi = new Set();
  state.daNap = new Set();
  state.goiLayHoi = [];
  state.nhatKy = [];
}

beforeEach(dungBan);
afterEach(() => vi.clearAllMocks());

describe("doiSoatZalocrm", () => {
  it("[ZC-DS-01] cơ sở chưa khai khoá API ⇒ BỎ QUA LẶNG LẼ, không gọi mạng, không ghi nhật ký", async () => {
    // Trước GĐ3 không cơ sở nào có khoá. Một cron kêu sai mỗi 5 phút là cách nhanh nhất
    // khiến người vận hành ngừng đọc nhật ký — rồi bỏ lỡ đúng dòng đáng đọc.
    state.coKhoa = new Set();
    const kq = await doiSoatZalocrm({ now: BAY_GIO });
    expect(kq.tong).toEqual({ napBu: 0, daCo: 0, loi: 0 });
    expect(state.goiLayHoi, "chưa có khoá mà vẫn gọi mạng").toHaveLength(0);
    expect(state.nhatKy).toHaveLength(0);
    expect(kq.theoOrg[0]).toMatchObject({ ok: false, ma: "CHUA_KHAI_KHOA_API" });
  });

  it("[ZC-DS-02] nạp bù tin webhook đã làm rơi, đếm đúng cả hai chiều", async () => {
    const kq = await doiSoatZalocrm({ now: BAY_GIO });
    expect(kq.tong.napBu, "hai tin: một đến, một đi").toBe(2);
    expect(kq.tong.daCo).toBe(0);
    expect(kq.tong.loi).toBe(0);
    expect(state.nhatKy, "có nạp bù thì PHẢI để lại vết").toHaveLength(1);
  });

  it("[ZC-DS-03] chạy lượt hai KHÔNG nạp thêm gì — và im lặng (ZC-07)", async () => {
    await doiSoatZalocrm({ now: BAY_GIO });
    state.nhatKy = [];
    const lai = await doiSoatZalocrm({ now: BAY_GIO });
    expect(lai.tong.napBu, "chạy lại mà đẻ thêm tin là mỗi 5 phút một bản sao").toBe(0);
    expect(lai.tong.daCo).toBe(2);
    expect(state.nhatKy, "lượt sạch phải im lặng, không rác nhật ký").toHaveLength(0);
  });

  it("[ZC-DS-12] tin đã có bị bỏ qua TRƯỚC khi nạp — không dựa vào P2002 (hết tiếng ồn prisma:error)", async () => {
    await doiSoatZalocrm({ now: BAY_GIO });
    vi.mocked(napSuKienZalocrm).mockClear();
    const lai = await doiSoatZalocrm({ now: BAY_GIO });
    expect(lai.tong.daCo).toBe(2);
    expect(napSuKienZalocrm, "tin đã nạp mà vẫn gọi nạp là vẫn ăn P2002 mỗi 5 phút").not.toHaveBeenCalled();
  });

  it("[ZC-DS-13] lô lẫn tin cũ và tin mới ⇒ chỉ nạp tin mới", async () => {
    state.daNap.add("cs1:m-1");
    const kq = await doiSoatZalocrm({ now: BAY_GIO });
    expect(kq.tong.daCo).toBe(1);
    expect(kq.tong.napBu).toBe(1);
    expect(napSuKienZalocrm).toHaveBeenCalledTimes(1);
  });

  it("[ZC-DS-04] hội thoại NHÓM bị bỏ qua (chốt 9.6), không tốn lượt lấy tin", async () => {
    state.hoiThoai.cs1 = [{ ...state.hoiThoai.cs1![0]!, threadType: "group" }];
    const kq = await doiSoatZalocrm({ now: BAY_GIO });
    expect(kq.tong.napBu).toBe(0);
    expect(kq.theoOrg[0]?.soTinXet).toBe(0);
  });

  it("[ZC-DS-05] tin cũ hơn cửa sổ bị bỏ qua — không quét lại cả lịch sử mỗi 5 phút", async () => {
    state.tin["cs1:conv-1"] = [
      { id: "m-cu", senderType: "contact", content: "tin cũ", sentAt: CU },
      { id: "m-moi", senderType: "contact", content: "tin mới", sentAt: MOI },
    ];
    const kq = await doiSoatZalocrm({ now: BAY_GIO });
    expect(kq.theoOrg[0]?.soTinXet).toBe(1);
    expect(kq.tong.napBu).toBe(1);
  });

  it("[ZC-DS-06] một cơ sở hỏng KHÔNG chặn cơ sở kia", async () => {
    state.anhXa = { CS1: "cs1", CS2: "cs2" };
    state.coKhoa = new Set(["cs1", "cs2"]);
    state.hoiThoaiLoi = new Set(["cs1"]);
    state.hoiThoai.cs2 = [
      {
        id: "conv-2",
        threadType: "user",
        externalThreadId: "uid-2",
        zaloAccountId: "acc-2",
        contact: { id: "ct-2", phone: "0987654321" },
      },
    ];
    state.tin["cs2:conv-2"] = [{ id: "m-9", senderType: "contact", content: "hi", sentAt: MOI }];

    const kq = await doiSoatZalocrm({ now: BAY_GIO });
    expect(kq.theoOrg.find((o) => o.orgCode === "cs1")).toMatchObject({ ok: false, ma: "HET_GIO" });
    expect(kq.theoOrg.find((o) => o.orgCode === "cs2")).toMatchObject({ ok: true, napBu: 1 });
  });

  it("[ZC-DS-07] hai cơ sở khai TRÙNG orgCode ⇒ chỉ quét một lượt", async () => {
    state.anhXa = { CS1: "cs1", CS2: "cs1" };
    await doiSoatZalocrm({ now: BAY_GIO });
    expect(state.goiLayHoi).toHaveLength(1);
  });

  it("[ZC-DS-08] mốc `since` gửi đi đúng bằng cửa sổ nhìn lại", async () => {
    await doiSoatZalocrm({ now: BAY_GIO, lookbackPhut: 10 });
    expect((state.goiLayHoi[0]?.since as Date)?.toISOString()).toBe("2026-09-13T09:50:00.000Z");
  });
});

describe("dungPayloadTuTin — hình dạng gửi vào bộ luật của webhook", () => {
  const HOI: HoiGia = {
    id: "conv-1",
    threadType: "user",
    externalThreadId: "uid-khach",
    zaloAccountId: "acc-1",
    contact: { id: "ct-1", phone: "0912345678", fullName: "Chị Lan" },
  };

  it("[ZC-DS-09] `senderType=self` ⇒ message.sent, còn lại ⇒ message.received", () => {
    // Suy sai chiều là `dichPayloadZalocrm` lấy nhầm "khách là ai": chiều ĐI khách nằm
    // ở `threadId`, chiều ĐẾN khách là người gửi. Nhầm ⇒ hội thoại tách đôi và danh
    // tính khách mang tên nhân viên.
    expect(dungPayloadTuTin(HOI, { id: "m", senderType: "self" }).event).toBe("message.sent");
    expect(dungPayloadTuTin(HOI, { id: "m", senderType: "contact" }).event).toBe(
      "message.received",
    );
    expect(dungPayloadTuTin(HOI, { id: "m" }).event, "thiếu thì coi là tin đến").toBe(
      "message.received",
    );
  });

  it("[ZC-DS-10] `sentByExternalId` LUÔN null — không đoán ai bấm Gửi", () => {
    // Public API không nói ai gửi. Đoán bừa một người là làm mới nhầm đồng hồ chăm sóc
    // của một Sale không hề nhắn, và ghi sai mốc "đã liên hệ" của phiếu.
    const d = dungPayloadTuTin(HOI, { id: "m", senderType: "self" }).data as Record<string, unknown>;
    expect(d.sentByExternalId).toBeNull();
  });

  it("[ZC-DS-11] mang đủ khoá mà bộ luật webhook đòi", () => {
    const d = dungPayloadTuTin(HOI, { id: "m-1", senderType: "contact", sentAt: MOI })
      .data as Record<string, unknown>;
    expect(d).toMatchObject({
      messageId: "m-1",
      zaloAccountId: "acc-1",
      conversationId: "conv-1",
      threadId: "uid-khach",
      senderUid: "uid-khach",
      sentAt: MOI,
    });
  });
});
