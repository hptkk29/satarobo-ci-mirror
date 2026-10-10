// @vitest-environment node
/**
 * MÀN TÍCH HỢP — bảng nick ZaloCRM, cảnh báo im lặng, đồng bộ nick.
 *
 * ⚠️ VÌ SAO BỘ TEST NÀY TỒN TẠI, nói thẳng: `ZaloCrmNick` nằm trong `SCOPE_EXEMPT`
 * (`lib/db-scope.ts`) ⇒ `injectScope` THOÁT NGAY ở dòng đầu và `passesScope` trả
 * `true` cho mọi dòng. Nghĩa là ở bảng này **không có một lưới nào ở tầng truy vấn**:
 * `scopedDb(actor).zaloCrmNick.findMany({})` trả nick của MỌI cơ sở, và không có gì
 * báo lỗi. Toàn bộ cách ly nằm trong `nick-admin.ts` — nên nếu bộ test này chết thì
 * cách ly cơ sở của trục Zalo chết theo, im lặng.
 *
 * Đọc "`ZaloCrmNick` đã khai vào db-scope" thành "đã được cách ly" là đúng cái bẫy
 * mấy ca dưới đây canh.
 *
 * Bộ này KHÔNG chạm DB: `@/lib/db` bị mock. Cái được kiểm là **mảnh `where` gửi đi**
 * và **quyết định ghi/không ghi**, tức chính hai thứ quyết định ai thấy gì.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Bàn dựng ────────────────────────────────────────────────────────────────
type NickRowDb = {
  id: string;
  zcrmAccountId: string;
  orgCode: string;
  sataUserId: string | null;
  displayName: string | null;
  status: string;
  lastEventAt: Date | null;
  centerId: string | null;
  orgUnitId: string | null;
  deletedAt: Date | null;
};

const state: {
  nicks: NickRowDb[];
  centers: { id: string; code: string; name: string }[];
  users: { id: string; name: string | null }[];
  /** Lượt gọi `findMany` trên bảng nick — để soi mảnh `where` thật sự gửi đi. */
  timKiem: unknown[];
  capNhat: { where: unknown; data: Record<string, unknown> }[];
  tao: Record<string, unknown>[];
  /** Phản hồi giả của máy chủ ZaloCRM, theo orgCode. */
  traLoi: Record<string, unknown>;
  /** Org nào cho lỗi mạng. */
  loiMang: Set<string>;
  nhatKy: { orgCode: string; action: string; status: string }[];
} = {
  nicks: [],
  centers: [],
  users: [],
  timKiem: [],
  capNhat: [],
  tao: [],
  traLoi: {},
  loiMang: new Set(),
  nhatKy: [],
};

vi.mock("@/lib/db", () => ({
  db: {
    zaloCrmNick: {
      findMany: vi.fn(async (args: { where?: unknown }) => {
        state.timKiem.push(args?.where);
        return state.nicks;
      }),
      update: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
        state.capNhat.push({ where: args.where, data: args.data });
        return { id: "x" };
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        state.tao.push(args.data);
        return { id: `new-${state.tao.length}` };
      }),
    },
    center: { findMany: vi.fn(async () => state.centers) },
    user: { findMany: vi.fn(async () => state.users) },
  },
}));

vi.mock("@/lib/settings/service", () => ({
  getSetting: vi.fn(async (key: string) => {
    if (key === "zalocrm.orgCodes") return { CS1: "cs1", CS2: "cs2" };
    if (key === "zalocrm.idleAlertHours") return 2;
    throw new Error(`Unknown setting key: ${key}`);
  }),
}));

vi.mock("@/lib/org/org-service", () => ({
  orgUnitIdForCenter: vi.fn(async (centerId: string) => `ou-${centerId}`),
}));

vi.mock("./client", () => ({
  goiZalocrm: vi.fn(async ({ orgCode }: { orgCode: string }) => {
    if (state.loiMang.has(orgCode)) {
      return { ok: false, ma: "HET_GIO", thongDiep: "Quá 10000ms không phản hồi." };
    }
    return { ok: true, data: state.traLoi[orgCode] ?? { data: [] } };
  }),
}));

vi.mock("./log", () => ({
  providerLogKey: (org: string) => `ZALOCRM:${org}`,
  ghiNhatKyZalocrm: vi.fn(async (input: { orgCode: string; action: string; status: string }) => {
    state.nhatKy.push({ orgCode: input.orgCode, action: input.action, status: input.status });
    return "log-1";
  }),
}));

import {
  dongBoNick,
  docDanhSachNickTraVe,
  docTongQuanNick,
  locNickImLang,
  nickCoTheGhi,
  whereNhatKyZalocrm,
  whereNickTheoActor,
} from "./nick-admin";

const HO = { isSuperAdmin: false, isHoLevel: true, visibleCenterIds: ["cs1", "cs2"] };
const SUPER = { isSuperAdmin: true, isHoLevel: false, visibleCenterIds: [] };
const QLCS1 = { isSuperAdmin: false, isHoLevel: false, visibleCenterIds: ["cs1"] };
const KHONG_CO_SO = { isSuperAdmin: false, isHoLevel: false, visibleCenterIds: [] };

/**
 * Diễn giải mảnh `where` mà `whereNickTheoActor` sinh ra, trên MỘT dòng nick.
 *
 * Viết tay ở đây thay vì tin vào con mắt: assert "where trông giống thế này" không
 * trả lời được câu hỏi thật sự cần trả lời — "nick CS2 có lọt qua không".
 */
function khop(where: Record<string, unknown>, nick: { centerId: string | null }): boolean {
  const or = where.OR as { centerId: unknown }[] | undefined;
  if (!or) return true; // không có điều kiện cơ sở ⇒ thấy hết
  return or.some((v) => {
    if (v.centerId === null) return nick.centerId === null;
    const ds = (v.centerId as { in: string[] }).in;
    return nick.centerId !== null && ds.includes(nick.centerId);
  });
}

beforeEach(() => {
  state.nicks = [];
  state.centers = [
    { id: "cs1", code: "CS1", name: "Cơ sở 1" },
    { id: "cs2", code: "CS2", name: "Cơ sở 2" },
  ];
  state.users = [];
  state.timKiem = [];
  state.capNhat = [];
  state.tao = [];
  state.traLoi = {};
  state.loiMang = new Set();
  state.nhatKy = [];
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ── Tầm nhìn ────────────────────────────────────────────────────────────────
describe("whereNickTheoActor", () => {
  it("[ZC-NA-01] danh sách nick lọc theo actor.visibleCenterIds — scopedDb KHÔNG giúp", async () => {
    // Quản lý cơ sở: mảnh `where` phải MANG điều kiện cơ sở. Nếu nó rỗng thì câu tra
    // trả nick của mọi cơ sở, và vì bảng nằm trong SCOPE_EXEMPT nên không ai chặn lại.
    const w = whereNickTheoActor(QLCS1) as Record<string, unknown>;
    expect(w.deletedAt).toBeNull(); // không ở SOFT_DELETE_MODELS ⇒ phải tự lọc
    expect(w.OR).toBeTruthy();

    // …và mảnh đó phải THẬT SỰ tới `findMany`, không phải chỉ tồn tại trong lib.
    await docTongQuanNick(QLCS1);
    expect(state.timKiem.length).toBeGreaterThan(0);
    const guiDi = state.timKiem[0] as Record<string, unknown>;
    expect(guiDi.OR).toBeTruthy();
    expect(guiDi.deletedAt).toBeNull();
  });

  it("[ZC-NA-02] QLCS CS1 không thấy nick CS2 (nick chưa ánh xạ cơ sở thì VẪN thấy)", () => {
    const w = whereNickTheoActor(QLCS1) as Record<string, unknown>;
    expect(khop(w, { centerId: "cs1" })).toBe(true);
    expect(khop(w, { centerId: "cs2" })).toBe(false);
    // `centerId = null` = orgCode chưa ánh xạ cơ sở. Giấu nhóm này đi là giấu đúng
    // thứ cần người xử lý khỏi người phải xử lý nó (xem chú thích SCOPE_EXEMPT).
    expect(khop(w, { centerId: null })).toBe(true);
  });

  it("hội sở và quản trị thấy mọi nick — không có nhánh nào rơi về 'thấy hết' cho cấp cơ sở", () => {
    for (const a of [HO, SUPER]) {
      const w = whereNickTheoActor(a) as Record<string, unknown>;
      expect(w.OR).toBeUndefined();
      expect(khop(w, { centerId: "cs2" })).toBe(true);
    }
    // Người chưa được gán cơ sở nào: KHÔNG được rơi về "thấy hết".
    const w = whereNickTheoActor(KHONG_CO_SO) as Record<string, unknown>;
    expect(w.OR).toBeTruthy();
    expect(khop(w, { centerId: "cs1" })).toBe(false);
  });
});

// ── Cổng GHI ────────────────────────────────────────────────────────────────
describe("nickCoTheGhi", () => {
  it("[ZC-NA-03] QLCS CS1 không sửa được nick CS2 — scopedDb chỉ chặn 7 method ĐỌC", () => {
    expect(nickCoTheGhi(QLCS1, { centerId: "cs1" })).toBe(true);
    expect(nickCoTheGhi(QLCS1, { centerId: "cs2" })).toBe(false);
    // Nick chưa ánh xạ cơ sở: ĐỌC được (ở trên) nhưng KHÔNG ghi được. Ánh xạ
    // org→cơ sở là setting TOÀN CỤC (`zalocrm.orgCodes`, centerOverridable: false),
    // nên nhận một nick vô chủ về cơ sở mình là việc của hội sở, không của cơ sở.
    expect(nickCoTheGhi(QLCS1, { centerId: null })).toBe(false);
    expect(nickCoTheGhi(HO, { centerId: "cs2" })).toBe(true);
    expect(nickCoTheGhi(SUPER, { centerId: null })).toBe(true);
  });

  it("[ZC-NA-03b] đồng bộ KHÔNG ghi nick của org ngoài tầm — dừng ở tầng lib, không chỉ ở giao diện", async () => {
    state.traLoi = { cs2: { data: [{ id: "acc-cs2", displayName: "Nick CS2" }] } };
    const kq = await dongBoNick(QLCS1, { orgCode: "cs2" });
    expect(state.tao).toEqual([]);
    expect(state.capNhat).toEqual([]);
    expect(kq.some((r) => r.ma === "NGOAI_TAM")).toBe(true);
  });
});

// ── Nhật ký ─────────────────────────────────────────────────────────────────
describe("whereNhatKyZalocrm", () => {
  it("[ZC-NA-05] luôn có where.provider (ăn index [provider, status, createdAt])", () => {
    expect(whereNhatKyZalocrm(HO, ["cs1", "cs2"])).toEqual({
      provider: { startsWith: "ZALOCRM" },
    });
    expect(whereNhatKyZalocrm(QLCS1, ["cs1"])).toEqual({
      provider: { in: ["ZALOCRM:cs1"] },
    });
  });

  it("[ZC-NA-05b] cấp cơ sở không có org nào ⇒ `{ in: [] }` (RỖNG), KHÔNG phải bỏ điều kiện", () => {
    // Bỏ điều kiện khi mảng rỗng là "tối ưu" hay gặp — và nó lật cách ly thành
    // xem-tất-cả đúng lúc actor không được xem gì.
    expect(whereNhatKyZalocrm(QLCS1, [])).toEqual({ provider: { in: [] } });
  });
});

// ── Cảnh báo im lặng ────────────────────────────────────────────────────────
describe("locNickImLang", () => {
  const BAY_GIO = new Date("2026-09-06T12:00:00.000Z");
  const nick = (p: Partial<{ status: string; lastEventAt: Date | null }>) => ({
    zcrmAccountId: "acc-1",
    orgCode: "cs1",
    displayName: "Nick CS1",
    status: "CONNECTED",
    lastEventAt: new Date("2026-09-06T11:30:00.000Z"),
    ...p,
  });

  it("[ZC-NA-04] báo CONNECTED mà im quá ngưỡng ⇒ cảnh báo", () => {
    const cb = locNickImLang([nick({ lastEventAt: new Date("2026-09-06T09:00:00.000Z") })], 2, BAY_GIO);
    expect(cb.length).toBe(1);
    expect(cb[0]?.gioImLang).toBe(3);
  });

  it("[ZC-NA-04b] im chưa tới ngưỡng ⇒ KHÔNG kêu (chuông kêu oan là chuông bị tắt mắt)", () => {
    expect(locNickImLang([nick({})], 2, BAY_GIO)).toEqual([]);
  });

  it("[ZC-NA-04c] CONNECTED mà CHƯA TỪNG có sự kiện ⇒ vẫn cảnh báo (webhook chưa nối)", () => {
    const cb = locNickImLang([nick({ lastEventAt: null })], 2, BAY_GIO);
    expect(cb.length).toBe(1);
    expect(cb[0]?.gioImLang).toBeNull();
  });

  it("[ZC-NA-04d] DISCONNECTED/UNKNOWN không vào cảnh báo — chúng đã hiện rõ ở cột trạng thái", () => {
    const im = new Date("2026-01-01T00:00:00.000Z");
    expect(locNickImLang([nick({ status: "DISCONNECTED", lastEventAt: im })], 2, BAY_GIO)).toEqual([]);
    expect(locNickImLang([nick({ status: "UNKNOWN", lastEventAt: im })], 2, BAY_GIO)).toEqual([]);
  });
});

// ── Đọc phản hồi của fork ───────────────────────────────────────────────────
describe("docDanhSachNickTraVe", () => {
  it("[ZC-NA-06] nhận cả `{data:[…]}` lẫn mảng trần — bên kia đổi hình dạng vẫn đọc được", () => {
    const a = docDanhSachNickTraVe({ data: [{ id: "acc-1" }] });
    const b = docDanhSachNickTraVe([{ accountId: "acc-1" }]);
    expect(a.map((n) => n.zcrmAccountId)).toEqual(["acc-1"]);
    expect(b.map((n) => n.zcrmAccountId)).toEqual(["acc-1"]);
  });

  it("[ZC-NA-06b] thiếu id ⇒ BỎ dòng, KHÔNG bịa khoá và KHÔNG ném", () => {
    expect(docDanhSachNickTraVe({ data: [{ displayName: "x" }, null, 7] })).toEqual([]);
    expect(docDanhSachNickTraVe("rác")).toEqual([]);
    expect(docDanhSachNickTraVe(null)).toEqual([]);
  });

  it("[ZC-NA-06d] HÌNH DẠNG THẬT của fork — chủ nick lấy từ `owner.externalId`", () => {
    // Chép đúng phản hồi của `GET /api/v1/zalo-accounts` (đối chiếu mã fork 13/09/2026):
    // mảng TRẦN, và `ownerUserId` ở gốc là id NỘI BỘ của fork — KHÔNG được nhận nhầm nó
    // làm người dùng Sata, nếu không cột "người sở hữu" rỗng vĩnh viễn mà không báo lỗi.
    const that = [
      {
        id: "acc-1",
        zaloUid: "79xxxx",
        displayName: "Nick CS1",
        avatarUrl: null,
        phone: "0912345678",
        status: "connected",
        ownerUserId: "USER-CUA-FORK",
        proxyUrl: null,
        privacyMode: "sub",
        lastConnectedAt: "2026-09-13T02:00:00.000Z",
        archivedAt: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        owner: {
          id: "USER-CUA-FORK",
          fullName: "Sale CS1",
          email: "sale.cs1@satarobo.vn",
          externalId: "USER-CUA-SATA",
        },
        hasProxy: false,
        liveStatus: "connected",
        canManage: true,
        isOwnedByMe: false,
      },
    ];
    const [n] = docDanhSachNickTraVe(that);
    expect(n?.zcrmAccountId).toBe("acc-1");
    expect(n?.displayName).toBe("Nick CS1");
    expect(n?.status).toBe("CONNECTED");
    expect(n?.ownerUserId, "phải là id bên SATA, không phải id nội bộ của fork").toBe(
      "USER-CUA-SATA",
    );
  });

  it("[ZC-NA-06e] chưa có chủ / chủ chưa từng đăng nhập SSO ⇒ null, không mượn id fork", () => {
    const [a] = docDanhSachNickTraVe([
      { id: "acc-2", ownerUserId: "USER-CUA-FORK", owner: { id: "USER-CUA-FORK", externalId: null } },
    ]);
    expect(a?.ownerUserId).toBeNull();

    const [b] = docDanhSachNickTraVe([{ id: "acc-3", ownerUserId: "USER-CUA-FORK" }]);
    expect(b?.ownerUserId, "không có khối owner ⇒ vẫn null").toBeNull();
  });

  it("[ZC-NA-06c] trạng thái lạ ⇒ UNKNOWN, không ép bừa thành CONNECTED", () => {
    const [n] = docDanhSachNickTraVe({ data: [{ id: "a", status: "đang-nghĩ" }] });
    expect(n?.status).toBe("UNKNOWN");
    const [c] = docDanhSachNickTraVe({ data: [{ id: "a", status: "connected" }] });
    expect(c?.status).toBe("CONNECTED");
    // `qr_pending` là giá trị THẬT thứ ba của fork (nick chưa quét mã) — phải ra UNKNOWN
    // chứ không rơi về DISCONNECTED: "chưa quét" khác "đã rớt", và cảnh báo đọc cột này.
    const [q] = docDanhSachNickTraVe({ data: [{ id: "a", status: "qr_pending" }] });
    expect(q?.status).toBe("UNKNOWN");
    const [d] = docDanhSachNickTraVe({ data: [{ id: "a", isConnected: false }] });
    expect(d?.status).toBe("DISCONNECTED");
  });
});

// ── Đồng bộ ─────────────────────────────────────────────────────────────────
describe("dongBoNick", () => {
  it("[ZC-NA-07] nick mới ⇒ tạo dòng, gắn cơ sở theo ánh xạ org", async () => {
    state.traLoi = { cs1: { data: [{ id: "acc-1", displayName: "Nick CS1" }] } };
    const kq = await dongBoNick(QLCS1, { orgCode: "cs1" });
    expect(kq[0]?.ok).toBe(true);
    expect(kq[0]?.soTao).toBe(1);
    expect(state.tao[0]).toMatchObject({
      zcrmAccountId: "acc-1",
      orgCode: "cs1",
      centerId: "cs1",
      orgUnitId: "ou-cs1",
    });
  });

  it("[ZC-NA-08] đồng bộ KHÔNG chạm `lastEventAt` — bấm nút không được làm câm cảnh báo", async () => {
    // Đây là ca nguy hiểm nhất của lô này. `lastEventAt` là đầu vào DUY NHẤT của
    // cảnh báo "connected mà im lặng". Nếu nút Đồng bộ ghi mốc đó thì mỗi lần người
    // vận hành bấm cho yên tâm, họ vừa xoá đúng bằng chứng nói rằng nick đã chết.
    state.nicks = [
      {
        id: "n1",
        zcrmAccountId: "acc-1",
        orgCode: "cs1",
        sataUserId: null,
        displayName: "cũ",
        status: "UNKNOWN",
        lastEventAt: new Date("2026-09-01T00:00:00.000Z"),
        centerId: "cs1",
        orgUnitId: "ou-cs1",
        deletedAt: null,
      },
    ];
    state.traLoi = { cs1: { data: [{ id: "acc-1", displayName: "mới", status: "connected" }] } };
    await dongBoNick(QLCS1, { orgCode: "cs1" });
    expect(state.capNhat.length).toBe(1);
    expect(state.capNhat[0]?.data).not.toHaveProperty("lastEventAt");
    expect(state.capNhat[0]?.data).toMatchObject({ status: "CONNECTED" });
  });

  it("[ZC-NA-09] ownerUserId không khớp tài khoản Sata ⇒ sataUserId = null (BÌNH THƯỜNG, không lỗi)", async () => {
    state.users = []; // không tài khoản nào khớp
    state.traLoi = { cs1: { data: [{ id: "acc-1", ownerUserId: "u-la" }] } };
    const kq = await dongBoNick(QLCS1, { orgCode: "cs1" });
    expect(kq[0]?.ok).toBe(true);
    expect(state.tao[0]).toMatchObject({ sataUserId: null });
  });

  it("[ZC-NA-09b] 🔴 ĐẢO 24/09: chủ nick bên ZaloCRM KHÔNG còn thành lượt phân công", async () => {
    // ── CA NÀY TỪNG KHẲNG ĐỊNH ĐIỀU NGƯỢC LẠI, và chính nó là bằng chứng của sự cố ──
    // Nguyên văn cũ: "`owner.externalId` khớp một User có thật ⇒ GÁN CHỦ NICK", và nó
    // xanh suốt — vì hồi đó `sataUserId` chỉ để HIỂN THỊ cột "Sale sở hữu".
    //
    // Rồi cột ấy được đọc như "nick đã giao cho ai" (migration 20260924120000), và một
    // giá trị MÁY ĐOÁN thành một lượt phân quyền ĐỘC QUYỀN. Đo trên prod ngay sau lượt
    // triển khai: mỗi nick cắt còn đúng một người, Cô Diệu (CS1) mở hộp thư ra TRỐNG.
    //
    // Nay đường đồng bộ KHÔNG chạm cột phân công nữa. `owner.externalId` vẫn được đọc
    // và vẫn được kiểm (`locChuNickCoThat`) — chỉ là không ghi vào đâu cả.
    state.users = [{ id: "u-1", name: "Chị Sale" }];
    state.traLoi = {
      cs1: { data: [{ id: "acc-1", ownerUserId: "fork-99", owner: { externalId: "u-1" } }] },
    };
    await dongBoNick(QLCS1, { orgCode: "cs1" });
    expect(state.tao[0]).toMatchObject({ sataUserId: null });
  });

  it("[ZC-NA-09c] chỉ có `ownerUserId` của fork ⇒ nick KHÔNG có chủ, không gán bừa", async () => {
    // Trước 13/09 chỗ này đọc thẳng `ownerUserId` — luôn trượt bộ lọc người dùng nên
    // cột "người sở hữu" rỗng vĩnh viễn mà không ai thấy lỗi. Nay là hành vi CÓ CHỦ ĐÍCH.
    state.users = [{ id: "u-1", name: "Chị Sale" }];
    state.traLoi = { cs1: { data: [{ id: "acc-1", ownerUserId: "u-1" }] } };
    await dongBoNick(QLCS1, { orgCode: "cs1" });
    expect(state.tao[0]).toMatchObject({ sataUserId: null });
  });

  it("[ZC-NA-10] nick đã XOÁ MỀM không hồi sinh — người đã gỡ nó có chủ đích", async () => {
    state.nicks = [
      {
        id: "n1",
        zcrmAccountId: "acc-1",
        orgCode: "cs1",
        sataUserId: null,
        displayName: "đã gỡ",
        status: "DISCONNECTED",
        lastEventAt: null,
        centerId: "cs1",
        orgUnitId: "ou-cs1",
        deletedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    ];
    state.traLoi = { cs1: { data: [{ id: "acc-1", status: "connected" }] } };
    const kq = await dongBoNick(QLCS1, { orgCode: "cs1" });
    expect(state.capNhat).toEqual([]);
    expect(state.tao).toEqual([]);
    expect(kq[0]?.soBoQua).toBe(1);
  });

  it("[ZC-NA-11] lỗi mạng một org ⇒ ghi nhật ký FAILED, KHÔNG ném, org còn lại vẫn chạy", async () => {
    state.loiMang = new Set(["cs1"]);
    state.traLoi = { cs2: { data: [{ id: "acc-2" }] } };
    const kq = await dongBoNick(HO);
    expect(kq.length).toBe(2);
    expect(kq.find((r) => r.orgCode === "cs1")?.ok).toBe(false);
    expect(kq.find((r) => r.orgCode === "cs1")?.ma).toBe("HET_GIO");
    expect(kq.find((r) => r.orgCode === "cs2")?.ok).toBe(true);
    expect(state.tao.length).toBe(1);
    expect(state.nhatKy.some((l) => l.orgCode === "cs1" && l.status === "FAILED")).toBe(true);
  });

  it("[ZC-NA-12] mỗi lượt đồng bộ để lại một dòng nhật ký — nút không được im lặng", async () => {
    state.traLoi = { cs1: { data: [] } };
    await dongBoNick(QLCS1, { orgCode: "cs1" });
    expect(state.nhatKy).toEqual([
      expect.objectContaining({ orgCode: "cs1", action: "SYNC_NICKS", status: "SUCCESS" }),
    ]);
  });
});
