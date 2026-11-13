// @vitest-environment node
/**
 * Hồ sơ Bộ Công Thương mục 4 — SỔ GHI mốc đồng ý "Chính sách hoạt động của website"
 * (`SitePolicyAcceptance`).
 *
 * Đây là tầng dưới cùng của cổng chặn `/portal/hoc-phi`: layout hỏi đúng một câu qua
 * `hasAcceptedSitePolicy`. Sai ở đây là sai ở tất cả, nên các bất biến được pin thẳng vào
 * PAYLOAD gửi xuống Prisma chứ không chỉ pin giá trị trả về.
 *
 * Bất biến pin ở file này:
 *  • Câu hỏi luôn kèm `policyKey` + `version` ĐANG PHÁT HÀNH. Bỏ `version` đi thì người đã
 *    đồng ý bản cũ được coi là đã đồng ý bản mới — đúng thứ việc nâng version sinh ra để chống.
 *  • `recordSitePolicyAcceptance` idempotent và `acceptedAt` GIỮ LẦN ĐẦU. Mốc cần lưu là
 *    "lúc nào họ đồng ý", không phải "lần bấm gần nhất"; F5 hai lần không được dời bằng
 *    chứng. `update` RỖNG là thứ giữ điều đó, nên payload `update` được kiểm trực tiếp.
 *  • `userId` rỗng ⇒ false và KHÔNG chạm DB (fail-closed, không bắn query rác).
 *  • Cấu trúc bảng: UNIQUE (userId, policyKey, version) và `ENABLE ROW LEVEL SECURITY`.
 *    Hai thứ này CHỈ sống trong file SQL nên không một test hành vi nào bắt được — đọc
 *    thẳng migration là cách duy nhất.
 *
 * Prisma được thay bằng bản giả CÓ HÀNH VI (tôn trọng khoá unique; `update` rỗng thì không
 * đổi hàng; đồng hồ giả nhích mỗi lượt ghi). Bản giả chỉ ghi nhận lời gọi sẽ XANH cả khi
 * `upsert` ghi đè `acceptedAt` — tức xanh đúng lúc bằng chứng bị phá.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  userId: string;
  policyKey: string;
  version: string;
  acceptedAt: Date;
  ip: string | null;
  userAgent: string | null;
};

type Khoa = { userId: string; policyKey: string; version: string };

const h = vi.hoisted(() => {
  const state = { rows: [] as Row[], tick: 0 };
  const nextNow = () => new Date(Date.UTC(2026, 8, 21, 3, state.tick++));

  const tim = (k: Khoa) =>
    state.rows.find(
      (r) => r.userId === k.userId && r.policyKey === k.policyKey && r.version === k.version,
    );

  const findUnique = vi.fn(async (args: { where: { userId_policyKey_version: Khoa } }) => {
    return tim(args.where.userId_policyKey_version) ?? null;
  });

  /** Mô phỏng đúng ngữ nghĩa Prisma: trúng unique → áp `update`; trượt → `create`. */
  const upsert = vi.fn(
    async (args: {
      where: { userId_policyKey_version: Khoa };
      create: Omit<Row, "id" | "acceptedAt"> & { acceptedAt?: Date };
      update: Record<string, unknown>;
    }) => {
      const cu = tim(args.where.userId_policyKey_version);
      if (cu) {
        Object.assign(cu, args.update); // `update` rỗng ⇒ hàng KHÔNG đổi
        return cu;
      }
      const moi: Row = {
        id: `row-${state.rows.length + 1}`,
        acceptedAt: args.create.acceptedAt ?? nextNow(),
        ...args.create,
      };
      state.rows.push(moi);
      return moi;
    },
  );

  const count = vi.fn(async (args: { where: { policyKey: string; version: string } }) => {
    return state.rows.filter(
      (r) => r.policyKey === args.where.policyKey && r.version === args.where.version,
    ).length;
  });

  return { state, findUnique, upsert, count };
});

vi.mock("@/lib/db", () => ({
  db: { sitePolicyAcceptance: { findUnique: h.findUnique, upsert: h.upsert, count: h.count } },
}));

// `cache()` của React ghi nhớ theo tham số trong CÙNG một request; dưới vitest không có
// ngữ cảnh request nên nó là no-op — nhưng import động để chắc chắn mock đã cắm trước.
const {
  hasAcceptedSitePolicy,
  recordSitePolicyAcceptance,
  countSitePolicyAccepted,
} = await import("./site-policy");
const { SITE_POLICY_KEY, SITE_POLICY_VERSION } = await import("./site-policy-content");

beforeEach(() => {
  h.state.rows = [];
  h.state.tick = 0;
  h.findUnique.mockClear();
  h.upsert.mockClear();
  h.count.mockClear();
});

describe("sổ đồng ý chính sách hoạt động (SitePolicyAcceptance)", () => {
  it("[SPA-01] chưa có dòng nào ⇒ false", async () => {
    expect(await hasAcceptedSitePolicy("u1")).toBe(false);
  });

  it("[SPA-02] ghi rồi ⇒ true", async () => {
    await recordSitePolicyAcceptance("u1");
    expect(await hasAcceptedSitePolicy("u1")).toBe(true);
  });

  it("[SPA-03] câu hỏi LUÔN kèm policyKey + version đang phát hành", async () => {
    await hasAcceptedSitePolicy("u1");
    expect(h.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_policyKey_version: {
            userId: "u1",
            policyKey: SITE_POLICY_KEY,
            version: SITE_POLICY_VERSION,
          },
        },
        select: { userId: true },
      }),
    );
  });

  it("[SPA-04] đồng ý bản CŨ ⇒ vẫn phải hỏi lại", async () => {
    // Đây là toàn bộ lý do cột `version` tồn tại.
    h.state.rows.push({
      id: "cu",
      userId: "u1",
      policyKey: SITE_POLICY_KEY,
      version: "2020-01-01",
      acceptedAt: new Date(0),
      ip: null,
      userAgent: null,
    });
    expect(await hasAcceptedSitePolicy("u1")).toBe(false);
  });

  it("[SPA-05] đồng ý chính sách KHÁC ⇒ không tính", async () => {
    h.state.rows.push({
      id: "khac",
      userId: "u1",
      policyKey: "mot-chinh-sach-khac",
      version: SITE_POLICY_VERSION,
      acceptedAt: new Date(0),
      ip: null,
      userAgent: null,
    });
    expect(await hasAcceptedSitePolicy("u1")).toBe(false);
  });

  it("[SPA-06] userId rỗng ⇒ false và KHÔNG chạm DB", async () => {
    expect(await hasAcceptedSitePolicy("")).toBe(false);
    expect(h.findUnique).not.toHaveBeenCalled();
  });

  it("[SPA-07] ghi hai lần ⇒ đúng MỘT dòng, và acceptedAt GIỮ LẦN ĐẦU", async () => {
    await recordSitePolicyAcceptance("u1");
    const lanDau = h.state.rows[0]!.acceptedAt;
    await recordSitePolicyAcceptance("u1");
    expect(h.state.rows).toHaveLength(1);
    expect(h.state.rows[0]!.acceptedAt).toEqual(lanDau);
  });

  it("[SPA-08] payload `update` phải RỖNG — đó là thứ giữ mốc lần đầu", async () => {
    await recordSitePolicyAcceptance("u1");
    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
  });

  it("[SPA-09] lưu ip/userAgent khi có, null khi không", async () => {
    await recordSitePolicyAcceptance("u1", { ip: "1.2.3.4", userAgent: "UA/1" });
    expect(h.state.rows[0]).toMatchObject({ ip: "1.2.3.4", userAgent: "UA/1" });
    await recordSitePolicyAcceptance("u2");
    expect(h.state.rows[1]).toMatchObject({ ip: null, userAgent: null });
  });

  it("[SPA-10] đếm theo đúng bản đang phát hành", async () => {
    await recordSitePolicyAcceptance("u1");
    await recordSitePolicyAcceptance("u2");
    expect(await countSitePolicyAccepted()).toBe(2);
  });
});

/**
 * Hai bất biến CHỈ sống trong file SQL — không test hành vi nào chạm tới được.
 * Đây là mẫu "lưới ghim mã nguồn" của repo, cùng cách `lib/chat/policy.test.ts` làm.
 */
describe("migration của SitePolicyAcceptance", () => {
  const sql = readFileSync(
    path.join(
      process.cwd(),
      "prisma/migrations/20260922100000_site_policy_acceptance/migration.sql",
    ),
    "utf8",
  );

  it("[SPA-SQL-01] có UNIQUE (userId, policyKey, version)", () => {
    // Vừa chống ghi đôi khi bấm 2 tab, vừa là chỉ mục cho câu đọc nóng nhất.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "SitePolicyAcceptance_userId_policyKey_version_key"[\s\S]{0,120}"userId", "policyKey", "version"/,
    );
  });

  it("[SPA-SQL-02] có ENABLE ROW LEVEL SECURITY (luật E-bis #3)", () => {
    // Bảng mới ra đời với RLS TẮT trong khi Supabase đã cấp sẵn anon/authenticated đủ DML.
    expect(sql).toContain('ALTER TABLE "SitePolicyAcceptance" ENABLE ROW LEVEL SECURITY;');
  });

  it("[SPA-SQL-03] KHÔNG có khoá ngoại tới User — FK cascade sẽ xoá bằng chứng", () => {
    expect(sql).not.toMatch(/REFERENCES\s+"User"/);
  });
});
