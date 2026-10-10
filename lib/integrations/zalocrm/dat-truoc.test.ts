// @vitest-environment node
/**
 * L12 — DÒNG "ĐẶT TRƯỚC" của `ZaloCrmThread`: luật ghi, và cổng gác của đường ghi.
 *
 * ── LỖ HỔNG MÀ BỘ NÀY ĐÓNG ───────────────────────────────────────────────────
 * Kế hoạch §5 (việc S2) nói: khi Sale bấm "Nhắn Zalo", Sata ghi tạm
 * `ZaloCrmThread.leadId` theo `(orgCode, phone)` để webhook ĐẦU TIÊN của hội thoại
 * nối được về đúng phiếu. Đường ĐỌC đã có (`nap-su-kien.ts` tra đúng cặp đó, ca
 * `[ZC-L7-03]` chứng minh) — nhưng đường GHI thì KHÔNG AI LÀM: trang
 * `/admin/zalo-crm` khai `lead?: string` trong kiểu `searchParams` mà thân hàm chưa
 * bao giờ đọc tới. Hệ quả trên thực địa: mọi hội thoại Zalo cá nhân rơi vào nhóm mồ
 * côi và phải nối tay, vì tin ĐẦU TIÊN của khách KHÔNG kèm số điện thoại.
 * Hỏng câm điển hình — không lỗi, không log, chỉ là "sao hộp thư toàn hội thoại lạ".
 *
 * ── VÌ SAO PHẦN LUẬT NẰM Ở HÀM THUẦN ─────────────────────────────────────────
 * Quyết định "ghi gì / KHÔNG ghi gì" là chỗ duy nhất có thể làm hỏng dữ liệu thật
 * (cướp ánh xạ hội thoại của khách khác). Tách nó thành `quyetDinhDatTruoc` cho phép
 * kiểm TOÀN BỘ bảng tình huống mà không cần Postgres — ca chạm DB (`tests/inbox/
 * zalocrm.spec.ts`) chỉ còn phải chứng minh "hai đầu nối được với nhau".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";

// ── Bộ giả cho hai cổng DB mà file nguồn dùng ────────────────────────────────
// `db` (bảng ánh xạ, SCOPE_EXEMPT ⇒ tra thẳng) và `scopedDb` (đọc phiếu lead theo
// đúng tầm nhìn của người đang bấm). Giả cả hai để bộ này chạy được ở mọi máy.
const state: {
  phieu: { id: string; phone: string; centerId: string | null } | null;
  /** Kết quả cho từng lượt `findFirst` — lượt 1 là đường thường, lượt 2 là đường đua. */
  docLanLuot: (Record<string, unknown> | null)[];
  loiTaoDong: unknown;
  goi: { ten: string; args: Record<string, unknown> }[];
} = { phieu: null, docLanLuot: [], loiTaoDong: null, goi: [] };

vi.mock("@/lib/db", () => ({
  db: {
    zaloCrmThread: {
      findFirst: vi.fn(async (args: Record<string, unknown>) => {
        state.goi.push({ ten: "findFirst", args });
        return state.docLanLuot.length ? (state.docLanLuot.shift() ?? null) : null;
      }),
      create: vi.fn(async (args: Record<string, unknown>) => {
        state.goi.push({ ten: "create", args });
        if (state.loiTaoDong) throw state.loiTaoDong;
        return { id: "dong-moi" };
      }),
      update: vi.fn(async (args: Record<string, unknown>) => {
        state.goi.push({ ten: "update", args });
        return { id: "dong-cu" };
      }),
    },
  },
}));

vi.mock("@/lib/db-scope", () => ({
  scopedDb: vi.fn(() => ({
    lead: {
      findFirst: vi.fn(async (args: Record<string, unknown>) => {
        state.goi.push({ ten: "lead.findFirst", args });
        return state.phieu;
      }),
    },
  })),
}));

import {
  chuanBiDatTruoc,
  datTruocLuongZalo,
  quyetDinhDatTruoc,
  type DongDatTruoc,
} from "./dat-truoc";

beforeEach(() => {
  state.phieu = null;
  state.docLanLuot = [];
  state.loiTaoDong = null;
  state.goi = [];
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** Actor tối thiểu — chỉ đủ field mà đường ghi này đọc. */
function actor(o?: { centers?: string[]; sieu?: boolean }) {
  return {
    userId: "u-1",
    isSuperAdmin: o?.sieu ?? false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: o?.centers ?? ["cs1"],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const dem = (ten: string) => state.goi.filter((g) => g.ten === ten).length;

// ═══════════════════════════════════════════════════════════════════════════
// A — CHUẨN BỊ THAM SỐ (thuần)
// ═══════════════════════════════════════════════════════════════════════════
describe("chuanBiDatTruoc — cổng vào của đường ghi", () => {
  it("[ZC-L12-U01] thiếu `lead` (mở màn từ sidebar) ⇒ KHÔNG ghi gì", () => {
    // Địa chỉ `/zalo-crm` trần là lối vào bình thường hằng ngày. Ghi một dòng ánh xạ
    // cho nó là bịa ra quan hệ số ↔ phiếu mà không ai yêu cầu.
    expect(chuanBiDatTruoc({ compose: "84912345678", lead: "", orgCode: "cs1" })).toEqual({
      ok: false,
      ma: "THIEU_THAM_SO",
    });
    expect(chuanBiDatTruoc({ compose: "84912345678", orgCode: "cs1" })).toEqual({
      ok: false,
      ma: "THIEU_THAM_SO",
    });
    expect(chuanBiDatTruoc({ lead: "lead-1", orgCode: "cs1" })).toEqual({
      ok: false,
      ma: "THIEU_THAM_SO",
    });
  });

  it("[ZC-L12-U02] SĐT về CANONICAL `84…` — đúng dạng mà nap-su-kien tra", () => {
    // `nap-su-kien.ts` tra `ZaloCrmThread` bằng `{ orgCode, phone }` SO BẰNG, và số
    // trong payload webhook đã được `dich-payload` chuẩn hoá về `84…`. Ghi lệch dạng
    // là dòng đặt trước nằm đó vô dụng mà KHÔNG AI BIẾT — không lỗi, không log.
    expect(chuanBiDatTruoc({ compose: "0912345678", lead: " lead-1 ", orgCode: "cs1" })).toEqual({
      ok: true,
      so: "84912345678",
      leadId: "lead-1",
    });
    expect(chuanBiDatTruoc({ compose: "+84 912 345 678", lead: "lead-1", orgCode: "cs1" })).toEqual(
      { ok: true, so: "84912345678", leadId: "lead-1" },
    );
  });

  it("[ZC-L12-U03] số cố định / rác / bản đã che ⇒ SO_KHONG_HOP_LE", () => {
    // `090xxxx456` là bản CHE PII: nếu nó lọt được vào bảng ánh xạ thì mỗi lượt tin
    // sau đều tra hụt, và hội thoại vẫn mồ côi — cùng triệu chứng với việc không có
    // dòng nào, nhưng khó truy hơn vì bảng "có dữ liệu".
    for (const x of ["02363123456", "090xxxx456", "alo", "0912"]) {
      expect(chuanBiDatTruoc({ compose: x, lead: "lead-1", orgCode: "cs1" })).toEqual({
        ok: false,
        ma: "SO_KHONG_HOP_LE",
      });
    }
  });

  it("[ZC-L12-U04] orgCode sai khuôn ⇒ ORG_KHONG_HOP_LE (không ghi org bịa vào bảng)", () => {
    // Cùng khuôn `/^[a-z0-9-]{1,32}$/` với webhook, vé SSO và ô cấu hình. Một dòng
    // mang orgCode lạ sẽ không bao giờ được webhook nào tra tới.
    expect(chuanBiDatTruoc({ compose: "84912345678", lead: "l", orgCode: "CS1 lạ" })).toEqual({
      ok: false,
      ma: "ORG_KHONG_HOP_LE",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B — LUẬT GHI (thuần): bảng tình huống đầy đủ
// ═══════════════════════════════════════════════════════════════════════════
describe("quyetDinhDatTruoc — ghi gì, và TUYỆT ĐỐI không ghi gì", () => {
  const co = {
    so: "84912345678",
    leadId: "lead-1",
    phieu: { phone: "84912345678", centerId: "cs1" },
    coSoCenterId: "cs1",
  };
  const dong = (o?: Partial<DongDatTruoc>): DongDatTruoc => ({
    id: "dong-cu",
    leadId: null,
    zcrmConversationId: null,
    centerId: "cs1",
    orgUnitId: "ou-cs1",
    ...o,
  });

  it("[ZC-L12-U05] chưa có dòng nào ⇒ TẠO", () => {
    expect(quyetDinhDatTruoc({ ...co, dong: null })).toEqual({ viec: "TAO" });
  });

  it("[ZC-L12-U06] dòng có sẵn nhưng CHƯA nối phiếu ⇒ điền `leadId` vào chỗ trống", () => {
    // Ca thật: webhook đã tạo dòng từ một hội thoại chưa khớp được lead nào; Sale mở
    // phiếu đúng của khách đó rồi bấm "Nhắn Zalo". Đây chính là lúc con người trả lời
    // được câu hỏi mà máy không trả lời được.
    expect(quyetDinhDatTruoc({ ...co, dong: dong() })).toEqual({
      viec: "CAP_NHAT",
      id: "dong-cu",
      data: { leadId: "lead-1" },
    });
  });

  it("[ZC-L12-U07] dòng ĐÃ nối hội thoại thật mà chưa có phiếu ⇒ vẫn điền, KHÔNG đụng hội thoại", () => {
    const qd = quyetDinhDatTruoc({ ...co, dong: dong({ zcrmConversationId: "conv-1" }) });
    expect(qd).toEqual({ viec: "CAP_NHAT", id: "dong-cu", data: { leadId: "lead-1" } });
    // `data` không được chứa `zcrmConversationId` dưới BẤT KỲ hình thức nào.
    expect(JSON.stringify(qd)).not.toContain("zcrmConversationId");
  });

  it("[ZC-L12-U08] bấm lại đúng phiếu cũ ⇒ BỎ QUA (không đẻ lượt UPDATE vô nghĩa)", () => {
    expect(quyetDinhDatTruoc({ ...co, dong: dong({ leadId: "lead-1" }) })).toEqual({
      viec: "BO_QUA",
      ma: "DA_DUNG",
    });
  });

  it("[ZC-L12-U09] 🔴 dòng đang trỏ PHIẾU KHÁC ⇒ GIỮ NGUYÊN, kể cả khi chưa có hội thoại", () => {
    // `@@unique([orgCode, phone])`: một số trong một org chỉ giữ được MỘT ánh xạ.
    // Cho phép trỏ lại là chuyển lịch sử chat của khách sang phiếu khác — im lặng, và
    // chỉ lộ ra lúc Sale gọi nhầm người. Hai phiếu cùng số là lỗi TRÙNG PHIẾU, phải
    // gộp phiếu, không phải giành ánh xạ bằng cú bấm gần nhất.
    expect(
      quyetDinhDatTruoc({ ...co, dong: dong({ leadId: "lead-cu", zcrmConversationId: "conv-1" }) }),
    ).toEqual({ viec: "BO_QUA", ma: "GIU_ANH_XA_CU" });
    expect(quyetDinhDatTruoc({ ...co, dong: dong({ leadId: "lead-cu" }) })).toEqual({
      viec: "BO_QUA",
      ma: "GIU_ANH_XA_CU",
    });
  });

  it("[ZC-L12-U10] `?compose=` KHÔNG phải số của phiếu ⇒ không ghi (chống ghép tay trên URL)", () => {
    // Nút thật luôn dựng cặp (số, phiếu) từ CÙNG một bản ghi. Một cặp lệch chỉ đến từ
    // URL gõ tay/sửa tay — và nó ghi được thì hội thoại của người này rơi vào hồ sơ
    // người kia ngay từ tin đầu tiên.
    expect(
      quyetDinhDatTruoc({ ...co, phieu: { phone: "84905000111", centerId: "cs1" }, dong: null }),
    ).toEqual({ viec: "BO_QUA", ma: "SO_LECH_PHIEU" });
  });

  it("[ZC-L12-U11] phiếu lưu SĐT dạng `0…` vẫn khớp (DB còn cả hai dạng)", () => {
    expect(
      quyetDinhDatTruoc({ ...co, phieu: { phone: "0912345678", centerId: "cs1" }, dong: null }),
    ).toEqual({ viec: "TAO" });
  });

  it("[ZC-L12-U12] phiếu của CƠ SỞ KHÁC với tab đang mở ⇒ không ghi", () => {
    // Đường webhook đã cấm nối chéo cơ sở (lỗi B3). Đường "đặt trước" mà cho qua thì
    // nó thành cửa sau vòng qua chính lệnh cấm đó — người kiêm hai cơ sở mở phiếu CS1
    // trong lúc đang ở tab CS2 là đủ.
    expect(
      quyetDinhDatTruoc({ ...co, phieu: { phone: "84912345678", centerId: "cs2" }, dong: null }),
    ).toEqual({ viec: "BO_QUA", ma: "KHAC_CO_SO" });
  });

  it("[ZC-L12-U13] phiếu CHƯA gán cơ sở ⇒ vẫn ghi (không đoán, cùng nếp `thuNoiTheoSdt`)", () => {
    expect(
      quyetDinhDatTruoc({ ...co, phieu: { phone: "84912345678", centerId: null }, dong: null }),
    ).toEqual({ viec: "TAO" });
  });

  it("[ZC-L12-U14] dòng chưa biết cơ sở ⇒ điền luôn `centerId` cho lượt tra sau", () => {
    expect(
      quyetDinhDatTruoc({ ...co, dong: dong({ centerId: null, orgUnitId: null }) }),
    ).toEqual({ viec: "CAP_NHAT", id: "dong-cu", data: { leadId: "lead-1", centerId: "cs1" } });
    // Đã biết cơ sở rồi thì KHÔNG đụng vào — đè `centerId` là kéo cả dòng sang cơ sở khác.
    expect(
      quyetDinhDatTruoc({ ...co, dong: dong({ centerId: "cs9", orgUnitId: "ou-cs9" }) }),
    ).toEqual({ viec: "CAP_NHAT", id: "dong-cu", data: { leadId: "lead-1" } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C — ĐƯỜNG GHI THẬT: cổng gác + không được làm sập trang
// ═══════════════════════════════════════════════════════════════════════════
describe("datTruocLuongZalo — cổng gác và tính bền", () => {
  const coSo = { centerId: "cs1", orgCode: "cs1" };

  it("[ZC-L12-U15] đủ tham số + phiếu đọc được ⇒ tạo dòng đúng khoá `(orgCode, phone)`", async () => {
    state.phieu = { id: "lead-1", phone: "0912345678", centerId: "cs1" };
    const kq = await datTruocLuongZalo({
      actor: actor(),
      coSo,
      compose: "84912345678",
      lead: "lead-1",
    });
    expect(kq).toEqual({ ma: "DA_TAO", id: "dong-moi" });

    const tao = state.goi.find((g) => g.ten === "create")!;
    expect((tao.args as { data: Record<string, unknown> }).data).toEqual({
      orgCode: "cs1",
      phone: "84912345678",
      leadId: "lead-1",
      centerId: "cs1",
    });
    // `orgUnitId` KHÔNG được set tay: ghi kép là việc của `lib/org/dual-write.ts`
    // (luật cứng #3 — một chỗ duy nhất), tự suy từ `centerId`.
    expect(JSON.stringify(tao.args)).not.toContain("orgUnitId");
  });

  it("[ZC-L12-U16] mọi truy vấn đều tự lọc `deletedAt: null` (bảng KHÔNG ở SOFT_DELETE_MODELS)", async () => {
    state.phieu = { id: "lead-1", phone: "84912345678", centerId: "cs1" };
    await datTruocLuongZalo({ actor: actor(), coSo, compose: "84912345678", lead: "lead-1" });
    const doc = state.goi.find((g) => g.ten === "findFirst")!;
    expect((doc.args as { where: Record<string, unknown> }).where).toMatchObject({
      orgCode: "cs1",
      phone: "84912345678",
      deletedAt: null,
    });
  });

  it("[ZC-L12-U17] thiếu tham số ⇒ KHÔNG chạm DB một lượt nào", async () => {
    // Trang này mở hằng ngày từ sidebar. Một lượt truy vấn thừa mỗi lần mở màn là chi
    // phí trả mãi mãi cho một việc không ai yêu cầu.
    expect(await datTruocLuongZalo({ actor: actor(), coSo })).toEqual({ ma: "THIEU_THAM_SO" });
    expect(state.goi.length).toBe(0);
  });

  it("[ZC-L12-U18] 🔴 tab của cơ sở NGOÀI tầm nhìn ⇒ từ chối trước khi đọc gì", async () => {
    // `ZaloCrmThread` nằm trong `SCOPE_EXEMPT` ⇒ `scopedDb` KHÔNG che bảng này, cả
    // đọc lẫn ghi. Cách ly phải tự làm, đúng ở đây.
    const kq = await datTruocLuongZalo({
      actor: actor({ centers: ["cs1"] }),
      coSo: { centerId: "cs2", orgCode: "cs2" },
      compose: "84912345678",
      lead: "lead-1",
    });
    expect(kq).toEqual({ ma: "NGOAI_TAM_NHIN" });
    expect(state.goi.length).toBe(0);
  });

  it("[ZC-L12-U19] 🔴 phiếu ngoài tầm nhìn (scopedDb trả null) ⇒ không ghi", async () => {
    state.phieu = null;
    const kq = await datTruocLuongZalo({
      actor: actor(),
      coSo,
      compose: "84912345678",
      lead: "lead-cs2",
    });
    expect(kq).toEqual({ ma: "KHONG_DOC_DUOC_PHIEU" });
    expect(dem("create")).toBe(0);
    expect(dem("update")).toBe(0);
  });

  it("[ZC-L12-U20] SUPER_ADMIN không bị chặn bởi `visibleCenterIds` rỗng", async () => {
    // `visibleCenterIds` suy từ `UserOrgRole`; quản trị hệ thống có thể không đứng ở
    // đơn vị nào. Họ đã vượt `scopedDb` (`bypassesScope`) — dựng thêm một luật quyền
    // thứ hai ở đây là hai hệ trả lời khác nhau cho cùng một câu hỏi.
    state.phieu = { id: "lead-1", phone: "84912345678", centerId: "cs2" };
    const kq = await datTruocLuongZalo({
      actor: actor({ centers: [], sieu: true }),
      coSo: { centerId: "cs2", orgCode: "cs2" },
      compose: "84912345678",
      lead: "lead-1",
    });
    expect(kq).toMatchObject({ ma: "DA_TAO" });
  });

  it("[ZC-L12-U21] 🔴 DB ngã ⇒ KHÔNG ném ra ngoài (Sale vẫn phải nhắn được khách)", async () => {
    // Dòng đặt trước là việc PHỤ TRỢ. Để nó ném là biến một bảng ánh xạ hỏng thành
    // màn "Application error" chắn ngang việc chăm khách.
    state.phieu = { id: "lead-1", phone: "84912345678", centerId: "cs1" };
    state.loiTaoDong = new Error("Prisma ngã");
    const kq = await datTruocLuongZalo({
      actor: actor(),
      coSo,
      compose: "84912345678",
      lead: "lead-1",
    });
    expect(kq).toEqual({ ma: "GHI_HONG" });
    expect(console.error).toHaveBeenCalled();
  });

  it("[ZC-L12-U22] đua với webhook (P2002) ⇒ đọc lại và điền, không ném", async () => {
    // Hai tab / bấm hai lần / webhook về đúng lúc: khoá `@@unique([orgCode, phone])`
    // chặn đúng cuộc đua đó. Đọc lại là đủ — ném ở đây là báo lỗi cho một chuyện vô hại.
    state.phieu = { id: "lead-1", phone: "84912345678", centerId: "cs1" };
    state.docLanLuot = [
      null, // lượt 1: chưa có gì ⇒ quyết định TẠO
      { id: "dong-dua", leadId: null, zcrmConversationId: "conv-1", centerId: "cs1", orgUnitId: "ou1", deletedAt: null },
    ];
    state.loiTaoDong = new Prisma.PrismaClientKnownRequestError("trùng", {
      code: "P2002",
      clientVersion: "5",
    });

    const kq = await datTruocLuongZalo({
      actor: actor(),
      coSo,
      compose: "84912345678",
      lead: "lead-1",
    });
    expect(kq).toEqual({ ma: "DA_CAP_NHAT", id: "dong-dua" });
    const sua = state.goi.find((g) => g.ten === "update")!;
    expect((sua.args as { data: unknown }).data).toEqual({ leadId: "lead-1" });
  });

  it("[ZC-L12-U23] khoá đang bị dòng ĐÃ XOÁ MỀM chiếm ⇒ KHÔNG hồi sinh", async () => {
    // Người vận hành đã gỡ dòng đó có chủ đích. Máy không lật lại quyết định của người
    // (cùng luật với nick đã gỡ trong `nap-su-kien.ts`).
    state.phieu = { id: "lead-1", phone: "84912345678", centerId: "cs1" };
    state.docLanLuot = [
      null,
      {
        id: "dong-xoa",
        leadId: null,
        zcrmConversationId: null,
        centerId: "cs1",
        orgUnitId: "ou1",
        deletedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    ];
    state.loiTaoDong = new Prisma.PrismaClientKnownRequestError("trùng", {
      code: "P2002",
      clientVersion: "5",
    });

    expect(
      await datTruocLuongZalo({ actor: actor(), coSo, compose: "84912345678", lead: "lead-1" }),
    ).toEqual({ ma: "BI_XOA_MEM" });
    expect(dem("update")).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D — TRANG THẬT SỰ GỌI ĐƯỜNG GHI (đọc mã nguồn)
// ═══════════════════════════════════════════════════════════════════════════
describe("trang /admin/zalo-crm — đường ghi phải được CẮM VÀO", () => {
  const src = readFileSync(
    join(process.cwd(), "app/(admin)/admin/zalo-crm/page.tsx"),
    "utf8",
  );

  it("[ZC-L12-U24] 🔴 `sp.lead` được ĐỌC và `datTruocLuongZalo` được GỌI", () => {
    // Đây là ca canh đúng lỗ hổng gốc: kiểu `searchParams` khai `lead?: string` suốt
    // ba đợt mà thân hàm không đọc lần nào — typecheck xanh, lint xanh, build xanh,
    // và bảng ánh xạ vĩnh viễn rỗng. Không có test chạy-thật nào bắt được việc đó, vì
    // "không ghi gì" là một hành vi hoàn toàn hợp lệ về mặt kiểu.
    expect(src).toContain("sp.lead");
    expect(src).toContain("datTruocLuongZalo(");
  });
});
