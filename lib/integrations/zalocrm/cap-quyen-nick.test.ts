// @vitest-environment node
/**
 * Cấp/GỠ quyền truy cập nick theo cơ sở (chốt 13/09/2026).
 *
 * ⚠️ VÌ SAO BỘ NÀY TỒN TẠI, và vì sao nửa số ca là về VẾ GỠ:
 * cấp thì ai cũng nhớ kiểm — mở hộp thư thấy hội thoại là biết chạy. GỠ thì không có
 * triệu chứng nào cả: người nghỉ việc vẫn đọc được chat của khách, mọi màn hình vẫn
 * xanh, không dòng lỗi nào. Kiểu hỏng ấy chỉ có test bắt được, nên nó nằm ở đây.
 *
 * Ca đắt thứ hai là [ZC-CQ-05]: cơ sở CHƯA CÓ NICK phải im lặng tuyệt đối. Bộ này chạy
 * 288 lượt/ngày và đó là hiện trạng của MỌI cơ sở cho tới khi có SIM thật (việc 9.16) —
 * kêu ở trạng thái bình thường là dạy người vận hành bỏ qua nhật ký.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DongVai = { userId: string; role?: { code: string } };

/**
 * `path` của từng đơn vị, theo quy ước repo (`/ho/danang/cs1/`).
 *
 * Fixture phải mang hình dạng THẬT: từ 24/09 `nguoiDuocDungNick` leo lên đơn vị cấp
 * trên qua `path` để lấy nhân sự Hội sở. Một fixture không có `path` thì nhánh ấy
 * không bao giờ chạy, và mọi ca về Hội sở xanh vì lý do sai.
 */
const DUONG_DON_VI: Record<string, string> = {
  HO: "/ho/",
  CS1: "/ho/danang/cs1/",
  CS2: "/ho/danang/cs2/",
};

const state = {
  anhXa: {} as Record<string, string>,
  coKhoa: new Set<string>(),
  nicks: {} as Record<
    string,
    { zcrmAccountId: string; giao?: { sataUserId: string; mucQuyen: string }[] }[]
  >,
  vaiTheoDonVi: {} as Record<string, DongVai[]>,
  donViCo: new Set<string>(),
  /** Tài khoản đã nghỉ/khoá — vẫn còn dòng `UserOrgRole` nhưng phải bị loại. */
  daNghi: new Set<string>(),
  whereVai: [] as unknown[],
  whereNguoi: [] as unknown[],
  goi: [] as Array<{
    orgCode: string;
    nick: string;
    quyen: { sataUserId: string; mucQuyen: string }[];
  }>,
  traLoi: { ok: true, data: { granted: 0, revoked: 0, unknown: 0 } } as Record<string, unknown>,
  nhatKy: [] as Array<{ orgCode: string; status: string }>,
};

vi.mock("@/lib/db", () => ({
  db: {
    zaloCrmNick: {
      // 🔴 MOCK PHẢI TÔN TRỌNG `select`. Bản trước trả nguyên object bất kể `select`, nên
      // gỡ `sataUserId` khỏi câu tra thật cho **0 ca đỏ** — đo được bằng phép cấy 24/09.
      // Đó là lỗi CÂM tệ nhất của đường này: mọi nick hoá "chưa giao" và cả cơ sở lại
      // thấy hết, không lỗi nào báo. Mock nào cũng phải cho cổng ăn đúng thứ Prisma cho
      // nó ăn, nếu không nó chỉ kiểm chính cái mock.
      //
      // `giao` là QUAN HỆ nên `select` của nó là một object lồng, không phải `true`.
      // Prisma trả `[]` khi quan hệ được chọn mà không có dòng nào — mô phỏng đúng thế,
      // để "quên chọn `giao`" vẫn ra `undefined` và vẫn nổ (đó là phép cấy ta cần giữ).
      findMany: vi.fn(
        async (args: { where?: { orgCode?: string }; select?: Record<string, unknown> }) => {
          const dong = state.nicks[args?.where?.orgCode ?? ""] ?? [];
          const sel = args?.select;
          if (!sel) return dong;
          const cot = Object.keys(sel).filter((k) => sel[k]);
          return dong.map((d) =>
            Object.fromEntries(
              cot.map((k) => [
                k,
                k === "giao" ? (d.giao ?? []) : (d as unknown as Record<string, unknown>)[k],
              ]),
            ),
          );
        },
      ),
    },
    orgUnit: {
      findFirst: vi.fn(async (args: { where?: { code?: string } }) => {
        const code = args?.where?.code ?? "";
        // `path` là thứ nhánh "lấy người Hội sở" dựa vào — trả thiếu là nhánh ấy chết
        // im lặng và ca [ZC-CQ-12] xanh vì lý do sai.
        return state.donViCo.has(code)
          ? { id: `ou-${code}`, path: DUONG_DON_VI[code] ?? null }
          : null;
      }),
      // Tra đơn vị TỔ TIÊN theo `path`. Chỉ trả đơn vị CÓ THẬT trong fixture.
      findMany: vi.fn(async (args: { where?: { path?: { in?: string[] } } }) => {
        const duong = new Set(args?.where?.path?.in ?? []);
        return Object.entries(DUONG_DON_VI)
          .filter(([ma, p]) => duong.has(p) && state.donViCo.has(ma))
          .map(([ma]) => ({ id: `ou-${ma}` }));
      }),
    },
    userOrgRole: {
      // 🔴 `orgUnitId` nay là `{ in: [...] }` (cơ sở + tổ tiên), và mỗi dòng trả về
      // PHẢI mang `orgUnitId`: tầng trên dùng nó để tách "người của cơ sở" khỏi "người
      // hội sở". Thiếu nó thì người Hội sở lọt vào tập MẶC ĐỊNH — nới quyền im lặng
      // trên mọi nick chưa giao của mọi cơ sở.
      findMany: vi.fn(async (args: { where?: unknown }) => {
        state.whereVai.push(args?.where);
        const w = args?.where as { orgUnitId?: { in?: string[] } };
        const ra: (DongVai & { orgUnitId: string })[] = [];
        for (const id of w?.orgUnitId?.in ?? []) {
          const code = id.replace(/^ou-/, "");
          for (const d of state.vaiTheoDonVi[code] ?? []) ra.push({ ...d, orgUnitId: id });
        }
        return ra;
      }),
    },
    user: {
      findMany: vi.fn(async (args: { where?: { id?: { in?: string[] } } }) => {
        state.whereNguoi.push(args?.where);
        const ids = args?.where?.id?.in ?? [];
        return ids.filter((i) => !state.daNghi.has(i)).map((id) => ({ id }));
      }),
    },
  },
}));

vi.mock("@/lib/settings/service", () => ({
  getSetting: vi.fn(async (key: string) => {
    if (key === "zalocrm.orgCodes") return state.anhXa;
    throw new Error(`Unknown setting key: ${key}`);
  }),
}));

vi.mock("@/lib/integrations/zalocrm/client", () => ({
  docKhoaApi: vi.fn((orgCode: string) => (state.coKhoa.has(orgCode) ? "k" : null)),
  datQuyenNickZalocrm: vi.fn(
    async (
      orgCode: string,
      nick: string,
      quyen: readonly { sataUserId: string; mucQuyen: string }[],
    ) => {
      state.goi.push({ orgCode, nick, quyen: quyen.map((q) => ({ ...q })) });
      return state.traLoi;
    },
  ),
}));

vi.mock("@/lib/integrations/zalocrm/log", () => ({
  ghiNhatKyZalocrm: vi.fn(async (i: { orgCode: string; status: string }) => {
    state.nhatKy.push({ orgCode: i.orgCode, status: i.status });
    return "log-1";
  }),
}));

import {
  capQuyenNickZalocrm,
  layDuongToTien,
} from "@/lib/integrations/zalocrm/cap-quyen-nick";

/** `User.id` của một lượt gửi, đã sắp — phần lớn ca chỉ quan tâm AI, không quan tâm mức. */
function ids(g: { quyen: { sataUserId: string }[] } | undefined): string[] {
  return [...(g?.quyen ?? []).map((q) => q.sataUserId)].sort();
}
/** Mức của một người trong một lượt gửi. `undefined` = không có trong danh sách. */
function mucCua(g: { quyen: { sataUserId: string; mucQuyen: string }[] } | undefined, id: string) {
  return g?.quyen.find((q) => q.sataUserId === id)?.mucQuyen;
}

beforeEach(() => {
  state.anhXa = { CS1: "cs1" };
  state.coKhoa = new Set(["cs1"]);
  state.nicks = { cs1: [{ zcrmAccountId: "acc-1" }] };
  state.vaiTheoDonVi = {
    CS1: [
      { userId: "u-sale-1", role: { code: "CENTER_SALES_CSM" } },
      { userId: "u-sale-2", role: { code: "CENTER_SALES_CSM" } },
      // Trước 24/09 dòng này chỉ có `userId` và cái tên "qlcs" là một GỢI Ý, không phải
      // sự thật kiểm được. Nay vai là thật, vì `[ZC-CQ-11]` đo đúng vế "quản lý thấy mọi nick".
      { userId: "u-qlcs", role: { code: "CENTER_MANAGER" } },
    ],
  };
  state.donViCo = new Set(["CS1", "CS2", "HO"]);
  state.daNghi = new Set();
  state.whereVai = [];
  state.whereNguoi = [];
  state.goi = [];
  state.traLoi = { ok: true, data: { granted: 3, revoked: 0, unknown: 0 } };
  state.nhatKy = [];
});
afterEach(() => vi.clearAllMocks());

describe("cấp quyền", () => {
  it("[ZC-CQ-01] gửi ĐỦ danh sách người của cơ sở cho từng nick", () => {
    return capQuyenNickZalocrm().then((kq) => {
      expect(state.goi).toHaveLength(1);
      expect(state.goi[0]).toMatchObject({ orgCode: "cs1", nick: "acc-1" });
      expect(ids(state.goi[0])).toEqual(["u-qlcs", "u-sale-1", "u-sale-2"]);
      // Chưa giao ai ⇒ mức mặc định `chat` cho MỌI người, KỂ CẢ quản lý cơ sở.
      // (Nhánh "quản lý `admin` tự động" đã bị chủ dự án gỡ — xem `[PVN-02]`.)
      expect(mucCua(state.goi[0], "u-sale-1")).toBe("chat");
      expect(mucCua(state.goi[0], "u-qlcs")).toBe("chat");
      expect(kq.tong.capMoi).toBe(3);
    });
  });

  it("[ZC-CQ-02] nhiều nick ⇒ mỗi nick một lượt, cùng danh sách người", async () => {
    state.nicks.cs1 = [{ zcrmAccountId: "acc-1" }, { zcrmAccountId: "acc-2" }];
    await capQuyenNickZalocrm();
    expect(state.goi.map((g) => g.nick)).toEqual(["acc-1", "acc-2"]);
    expect(state.goi[0]!.quyen).toEqual(state.goi[1]!.quyen);
  });

  it("[ZC-CQ-11] nick ĐÃ GIAO ⇒ CHỈ người được giao, kể cả quản lý cũng phải có tên", async () => {
    // Hai nick: một đã giao cho `u-sale-2`, một chưa giao. MỘT lượt chạy phải sinh HAI
    // danh sách KHÁC NHAU — trước 24/09 vòng lặp gửi cùng một mảng cho mọi nick.
    state.nicks.cs1 = [
      { zcrmAccountId: "acc-giao", giao: [{ sataUserId: "u-sale-2", mucQuyen: "chat" }] },
      { zcrmAccountId: "acc-chua-giao", giao: [] },
    ];
    await capQuyenNickZalocrm();

    const giao = state.goi.find((g) => g.nick === "acc-giao")!;
    const chuaGiao = state.goi.find((g) => g.nick === "acc-chua-giao")!;

    expect(ids(giao)).toEqual(["u-sale-2"]);
    // ĐỐI CHỨNG ÂM — vế mà tính năng này sinh ra để làm.
    expect(ids(giao), "người KHÔNG được giao phải biến mất").not.toContain("u-sale-1");
    // 🔴 Và quản lý cơ sở cũng vậy (đảo 24/09): muốn họ thấy nick đã giao thì phải
    // thêm họ vào danh sách. Migration `20260924160000` làm việc đó một lần cho dữ
    // liệu đang có, để lượt triển khai không âm thầm cắt quyền của ai.
    expect(ids(giao), "nhánh 'quản lý admin tự động' đã quay lại").not.toContain("u-qlcs");
    // ĐỐI CHỨNG DƯƠNG — nick chưa giao KHÔNG được siết theo.
    expect(ids(chuaGiao)).toEqual(["u-qlcs", "u-sale-1", "u-sale-2"]);
  });

  it("[ZC-CQ-11e] giao TƯỜNG MINH cho quản lý ⇒ họ có mặt, đúng mức đã giao", async () => {
    // ĐỐI CHỨNG DƯƠNG của ca trên. Thiếu nó thì một bản "gỡ hẳn quản lý khỏi mọi nick"
    // cũng xanh, và không ai phát hiện tới lúc sếp hỏi vì sao không thấy chat.
    state.nicks.cs1 = [
      {
        zcrmAccountId: "acc-giao",
        giao: [
          { sataUserId: "u-sale-2", mucQuyen: "chat" },
          { sataUserId: "u-qlcs", mucQuyen: "admin" },
        ],
      },
    ];
    await capQuyenNickZalocrm();
    expect(ids(state.goi[0])).toEqual(["u-qlcs", "u-sale-2"]);
    expect(mucCua(state.goi[0], "u-qlcs")).toBe("admin");
  });

  it("[ZC-CQ-11f] HẠ mức quản lý xuống `read` ⇒ đúng `read`, không bị nâng lại", async () => {
    // Nhánh cũ dùng `rongHon(admin, read)` nên mọi mức của quản lý đều bị kéo về
    // `admin` — tức ô chọn trên màn là một lời hứa suông.
    state.nicks.cs1 = [
      { zcrmAccountId: "acc-1", giao: [{ sataUserId: "u-qlcs", mucQuyen: "read" }] },
    ];
    await capQuyenNickZalocrm();
    expect(mucCua(state.goi[0], "u-qlcs")).toBe("read");
  });

  it("[ZC-CQ-11c] MỖI NGƯỜI MỘT MỨC — mức của dòng giao đi tới nơi", async () => {
    // Đây là cả lý do đợt 24/09 tồn tại. Trước đó bên kia đóng cứng mọi người ở `chat`,
    // nên "giao cho Lộc quyền chỉ xem" là một câu nói dối trên màn.
    state.nicks.cs1 = [
      {
        zcrmAccountId: "acc-1",
        giao: [
          { sataUserId: "u-sale-1", mucQuyen: "read" },
          { sataUserId: "u-sale-2", mucQuyen: "admin" },
        ],
      },
    ];
    await capQuyenNickZalocrm();
    expect(mucCua(state.goi[0], "u-sale-1")).toBe("read");
    expect(mucCua(state.goi[0], "u-sale-2")).toBe("admin");
    // Quản lý cơ sở KHÔNG có dòng giao ⇒ KHÔNG có mặt (đảo 24/09).
    expect(mucCua(state.goi[0], "u-qlcs")).toBeUndefined();
  });

  it("[ZC-CQ-11d] mức LẠ trong DB ⇒ rơi về `read`, KHÔNG đi thẳng sang ZaloCRM", async () => {
    // Cột là `String` (ràng bằng CHECK), nên một lượt ghi tay hay một bản migration hỏng
    // vẫn nhét được chuỗi lạ. Nó phải làm người ta thấy ÍT đi, không phải nhiều hơn.
    state.nicks.cs1 = [
      { zcrmAccountId: "acc-1", giao: [{ sataUserId: "u-sale-1", mucQuyen: "owner" }] },
    ];
    await capQuyenNickZalocrm();
    expect(mucCua(state.goi[0], "u-sale-1")).toBe("read");
  });

  it("[ZC-CQ-11b] người được giao đã NGHỈ ⇒ rơi về cả cơ sở, không về rỗng", async () => {
    // Rỗng = hộp thư khách không ai đọc được, và không một dòng lỗi nào báo.
    state.nicks.cs1 = [
      { zcrmAccountId: "acc-giao", giao: [{ sataUserId: "u-sale-2", mucQuyen: "chat" }] },
    ];
    state.daNghi = new Set(["u-sale-2"]);
    await capQuyenNickZalocrm();
    expect(ids(state.goi[0])).toEqual(["u-qlcs", "u-sale-1"]);
  });

  it("[ZC-CQ-03] lấy MỌI nhân sự của đúng đơn vị, trừ vai quan hệ", async () => {
    // 🔴 24/09/2026 — câu tra KHÔNG còn `code: { in: VAI_DUOC_CAP_NICK }`. Tập này nay
    // là "ai giao tay được" (mọi nhân sự của cơ sở); tập "ai dùng được MẶC ĐỊNH" tính
    // ở tầng trên theo `role.code`. Lọc lại ở đây là thu hẹp tập giao tay về như cũ.
    await capQuyenNickZalocrm();
    const w = state.whereVai[0] as {
      status?: string;
      role?: { code?: { in?: string[]; notIn?: string[] } };
      orgUnitId?: { in?: string[] };
    };
    expect(w.status).toBe("ACTIVE");
    expect(w.role?.code?.in, "lọc theo danh sách vai = thu hẹp lại tập giao tay").toBeUndefined();
    // Phụ huynh là KHÁCH HÀNG. Hôm nay họ không có dòng `UserOrgRole` nào nên câu tra
    // không thể trả về họ — điều kiện này là hàng rào THỨ HAI, và nó phải còn đó.
    expect([...(w.role?.code?.notIn ?? [])]).toEqual(["PARENT"]);
    // Cơ sở + tổ tiên của nó. Mất vế tổ tiên là nhân sự Hội sở biến mất khỏi màn giao
    // nick — đúng triệu chứng 24/09 ("không có ms Trang trong màn giao nick").
    expect([...(w.orgUnitId?.in ?? [])].sort()).toEqual(["ou-CS1", "ou-HO"]);
    // Nghỉ việc / khoá tài khoản là ca CHÍNH của vế gỡ — lọc ở bước tra `User`, vì dòng
    // `UserOrgRole` của người nghỉ thường VẪN CÒN.
    expect(state.whereNguoi[0]).toMatchObject({ isActive: true, deletedAt: null });
  });

  it("[ZC-CQ-12] người HỘI SỞ: THÊM TAY được, nhưng KHÔNG dùng nick mặc định", async () => {
    // 🔴 Chủ dự án báo 24/09: *"không có ms Trang trong màn giao nick zalo vì ms Trang
    // là HO"*. Nhân sự Hội sở không neo ở cơ sở nào, nên câu tra chỉ nhìn một đơn vị đã
    // bỏ sót họ — và triệu chứng là một cái tên VẮNG MẶT, không phải một lỗi.
    state.vaiTheoDonVi.HO = [{ userId: "u-trang", role: { code: "CENTER_MANAGER" } }];

    // ① nick CHƯA giao ai ⇒ Hội sở KHÔNG tự có quyền. Cho họ quyền mặc định là mở mọi
    //    nick chưa giao của MỌI cơ sở cho một người — nới quyền toàn hệ thống, im lặng.
    state.nicks.cs1 = [{ zcrmAccountId: "acc-1", giao: [] }];
    await capQuyenNickZalocrm();
    expect(ids(state.goi[0]), "Hội sở lọt vào tập mặc định").not.toContain("u-trang");
    expect(ids(state.goi[0])).toEqual(["u-qlcs", "u-sale-1", "u-sale-2"]);

    // ② GIAO TAY cho người Hội sở ⇒ dòng giao CÓ hiệu lực.
    state.goi = [];
    state.nicks.cs1 = [
      { zcrmAccountId: "acc-1", giao: [{ sataUserId: "u-trang", mucQuyen: "admin" }] },
    ];
    await capQuyenNickZalocrm();
    expect(ids(state.goi[0]), "dòng giao cho Hội sở bị rụng").toEqual(["u-trang"]);
    expect(mucCua(state.goi[0], "u-trang")).toBe("admin");
  });

  it("[ZC-CQ-03d] vai NGOÀI chính sách: giao tay được, nhưng KHÔNG mặc định", async () => {
    // Cả điểm của đợt 24/09, đo ở tầng DB-mock. Hai vế phải đi cùng nhau.
    state.vaiTheoDonVi.CS1 = [
      { userId: "u-sale-1", role: { code: "CENTER_SALES_CSM" } },
      { userId: "u-gv", role: { code: "TEACHER" } },
    ];

    // ① nick CHƯA giao ⇒ giáo viên KHÔNG có mặt (không thuộc tập mặc định).
    state.nicks.cs1 = [{ zcrmAccountId: "acc-1", giao: [] }];
    await capQuyenNickZalocrm();
    expect(ids(state.goi[0])).toEqual(["u-sale-1"]);
    expect(ids(state.goi[0]), "giáo viên đọc được nick chưa giao").not.toContain("u-gv");

    // ② nick GIAO TAY cho chính giáo viên đó ⇒ dòng giao CÓ hiệu lực.
    state.goi = [];
    state.nicks.cs1 = [
      { zcrmAccountId: "acc-1", giao: [{ sataUserId: "u-gv", mucQuyen: "read" }] },
    ];
    await capQuyenNickZalocrm();
    expect(ids(state.goi[0])).toEqual(["u-gv"]);
    expect(mucCua(state.goi[0], "u-gv")).toBe("read");
  });

  it("[ZC-CQ-03b] tài khoản đã khoá/nghỉ việc bị LOẠI dù vẫn còn dòng phân vai", async () => {
    state.daNghi = new Set(["u-sale-2"]);
    const kq = await capQuyenNickZalocrm();
    expect(ids(state.goi[0]), "người đã nghỉ vẫn đọc được chat khách").not.toContain("u-sale-2");
    expect(ids(state.goi[0])).toEqual(["u-qlcs", "u-sale-1"]);
    expect(kq.theoOrg[0]?.soNguoi).toBe(2);
  });

  it("[ZC-CQ-03c] cơ sở chưa có đơn vị trong cây ⇒ danh sách RỖNG, không đoán", async () => {
    state.donViCo = new Set();
    await capQuyenNickZalocrm();
    expect(state.goi[0]!.quyen).toEqual([]);
  });
});

describe("GỠ quyền — vế không có triệu chứng, chỉ test bắt được", () => {
  it("[ZC-CQ-04] người rời cơ sở KHÔNG còn trong danh sách gửi đi", async () => {
    // Lượt 1: ba người. Lượt 2: `u-sale-2` đã chuyển cơ sở / nghỉ việc ⇒ truy vấn không
    // trả họ nữa ⇒ danh sách gửi sang fork thiếu họ ⇒ fork gỡ bản ghi quyền.
    await capQuyenNickZalocrm();
    expect(ids(state.goi[0])).toContain("u-sale-2");

    state.goi = [];
    state.vaiTheoDonVi.CS1 = [
      { userId: "u-sale-1", role: { code: "CENTER_SALES_CSM" } },
      { userId: "u-qlcs", role: { code: "CENTER_MANAGER" } },
    ];
    state.traLoi = { ok: true, data: { granted: 2, revoked: 1, unknown: 0 } };
    const kq = await capQuyenNickZalocrm();

    expect(ids(state.goi[0]), "người đã rời phải BIẾN MẤT khỏi danh sách").not.toContain(
      "u-sale-2",
    );
    expect(ids(state.goi[0])).toEqual(["u-qlcs", "u-sale-1"]);
    expect(kq.tong.daGo).toBe(1);
  });

  it("[ZC-CQ-04b] cơ sở không còn ai ⇒ gửi MẢNG RỖNG, không bỏ qua", async () => {
    // Bỏ qua khi danh sách rỗng là để nguyên quyền cho cả đội cũ — đúng cái bẫy "chỉ
    // thêm, không gỡ" mà endpoint thay-cả-tập sinh ra để tránh.
    state.vaiTheoDonVi.CS1 = [];
    state.traLoi = { ok: true, data: { granted: 0, revoked: 3, unknown: 0 } };
    const kq = await capQuyenNickZalocrm();
    expect(state.goi).toHaveLength(1);
    expect(state.goi[0]!.quyen).toEqual([]);
    expect(kq.tong.daGo).toBe(3);
  });

  it("[ZC-CQ-04c] có GỠ thì PHẢI để lại vết trong nhật ký", async () => {
    state.traLoi = { ok: true, data: { granted: 2, revoked: 1, unknown: 0 } };
    await capQuyenNickZalocrm();
    expect(state.nhatKy).toHaveLength(1);
    expect(state.nhatKy[0]).toMatchObject({ orgCode: "cs1", status: "SUCCESS" });
  });
});

describe("im lặng khi không có gì để làm", () => {
  it("[ZC-CQ-05] cơ sở CHƯA CÓ NICK ⇒ không gọi mạng, không ghi nhật ký", async () => {
    // Hiện trạng của MỌI cơ sở cho tới khi có SIM thật (việc 9.16).
    state.nicks = { cs1: [] };
    const kq = await capQuyenNickZalocrm();
    expect(state.goi, "chưa có nick mà vẫn gọi API").toHaveLength(0);
    expect(state.nhatKy, "chưa có nick mà vẫn ghi nhật ký = rác 288 lượt/ngày").toHaveLength(0);
    expect(kq.theoOrg[0]).toMatchObject({ ok: true, ma: "CHUA_CO_NICK" });
    expect(kq.tong).toEqual({ capMoi: 0, daGo: 0, loi: 0 });
  });

  it("[ZC-CQ-06] chưa khai khoá API ⇒ bỏ qua lặng lẽ, KHÔNG đọc cả bảng nick", async () => {
    state.coKhoa = new Set();
    const kq = await capQuyenNickZalocrm();
    expect(state.goi).toHaveLength(0);
    expect(state.nhatKy).toHaveLength(0);
    expect(kq.theoOrg[0]).toMatchObject({ ok: false, ma: "CHUA_KHAI_KHOA_API" });
  });

  it("[ZC-CQ-07] lượt SẠCH (không gỡ ai, không lỗi) ⇒ im lặng", async () => {
    state.traLoi = { ok: true, data: { granted: 3, revoked: 0, unknown: 0 } };
    await capQuyenNickZalocrm();
    expect(state.nhatKy).toHaveLength(0);
  });
});

describe("hỏng hóc", () => {
  it("[ZC-CQ-08] gọi API hỏng ⇒ đếm lỗi + ghi nhật ký FAILED, không ném", async () => {
    state.traLoi = { ok: false, ma: "HET_GIO" };
    const kq = await capQuyenNickZalocrm();
    expect(kq.tong.loi).toBe(1);
    expect(state.nhatKy[0]).toMatchObject({ status: "FAILED" });
  });

  it("[ZC-CQ-09] một cơ sở hỏng KHÔNG chặn cơ sở kia", async () => {
    state.anhXa = { CS1: "cs1", CS2: "cs2" };
    state.coKhoa = new Set(["cs1", "cs2"]);
    state.nicks = { cs1: [{ zcrmAccountId: "acc-1" }], cs2: [{ zcrmAccountId: "acc-2" }] };
    state.vaiTheoDonVi = {
      CS1: [{ userId: "u-1", role: { code: "CENTER_SALES_CSM" } }],
      CS2: [{ userId: "u-2", role: { code: "CENTER_SALES_CSM" } }],
    };
    await capQuyenNickZalocrm();
    expect(state.goi.map((g) => g.orgCode)).toEqual(["cs1", "cs2"]);
    // Mỗi cơ sở gửi ĐÚNG người của mình — trộn danh sách là mở chéo cơ sở.
    expect(ids(state.goi[0])).toEqual(["u-1"]);
    expect(ids(state.goi[1])).toEqual(["u-2"]);
  });

  it("[ZC-CQ-10] hai cơ sở khai TRÙNG orgCode ⇒ chỉ chạy một lượt", async () => {
    state.anhXa = { CS1: "cs1", CS2: "cs1" };
    await capQuyenNickZalocrm();
    expect(state.goi).toHaveLength(1);
  });
});

// ── [ZC-TT-*] — đường tổ tiên, hàm THUẦN ────────────────────────────────────────────
//
// Đây là chỗ quyết định "ai ở cấp trên được thêm vào nick". Cắt chuỗi sai thì hoặc bỏ
// sót Hội sở (không ai thấy — đúng triệu chứng chủ dự án báo 24/09: "không có ms Trang
// trong màn giao nick"), hoặc quét rộng ra cả cây và thêm được người của CƠ SỞ KHÁC.
describe("[ZC-TT] đường tổ tiên của một đơn vị", () => {
  it("[ZC-TT-01] trả tổ tiên, KHÔNG gồm chính nó", () => {
    expect(layDuongToTien("/ho/danang/cs1/")).toEqual(["/ho/", "/ho/danang/"]);
  });

  it("[ZC-TT-02] gốc một đoạn ⇒ không có tổ tiên nào", () => {
    expect(layDuongToTien("/ho/")).toEqual([]);
  });

  it("[ZC-TT-03] đường KHÔNG đúng khuôn ⇒ rỗng, không đoán", () => {
    // `path` nullable (P1 additive). Đoán ở đây là quét sai nhánh cây.
    for (const xau of [null, undefined, "", "ho/danang/cs1/", "/ho/danang/cs1", "   "]) {
      expect(layDuongToTien(xau), `đoán bừa với: ${String(xau)}`).toEqual([]);
    }
  });

  it("[ZC-TT-04] dấu `/` cuối cắt đúng biên node — `/cs1` KHÔNG dính `/cs10`", () => {
    // Quy ước `path` của repo (schema.prisma). Mất dấu `/` là `LIKE` quét nhầm node.
    for (const p of layDuongToTien("/ho/danang/cs1/")) {
      expect(p.endsWith("/"), `đoạn thiếu dấu chéo cuối: ${p}`).toBe(true);
      expect(p.startsWith("/"), `đoạn thiếu dấu chéo đầu: ${p}`).toBe(true);
    }
  });
});
