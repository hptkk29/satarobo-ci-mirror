// [AQM-*] — MA TRẬN QUYỀN AFFILIATE: mỗi vai × mỗi khoá `affiliate*:*` (AFF-L3a, quyết định Q5 về vai Giám đốc).
//
// MA TRẬN GÕ TAY, KHÔNG ĐỌC TỪ `ROLE_SEED` (khuôn `nguon-hoa-hong-quyen.test.ts`): suy từ seed thì test chỉ kiểm seed bằng chính nó. Muốn đổi ai-được-gì thì sửa Ở ĐÂY và ở seed cùng lúc.
// Mỗi ô là một phép đo hai chiều — "vai X CÓ khoá K" (đối chứng dương) VÀ "vai Y KHÔNG có khoá K" — để một ca chỉ khẳng định sự vắng mặt không thể đạt chỉ vì tính năng hỏng hẳn.
//
// ── Vì sao Giám đốc CÓ `affiliate_referrals:view-org` mà KHÔNG có `:manage` (quyết định theo CHỨC NĂNG, không theo tên vai) ──────────────────────────────────────────────────────────────────────
//  · Giám đốc KÍCH HOẠT campaign (`affiliate_campaigns:activate`) và kích hoạt chính sách hoa hồng (`commission_policies:activate`), và đọc sổ hoa hồng toàn hệ (`commission:view-center`).
//    Kích hoạt một campaign mà không thấy được referral campaign đó sinh ra là kích hoạt trong bóng tối — chức năng giám sát kết quả thiếu đúng một khoá.
//  · `view-org` chỉ ĐỌC, không PII khách (`lib/affiliate/doc-referral.ts`), tầm nhìn theo nơi neo vai (prefix `affiliate_referrals:` ở `getModelPrefixes`) — không phải nới quyền ghi.
//  · `:manage` (khai tay / xử lý referral) là việc VẬN HÀNH của Marketing, không phải của BLĐ: giữ 0.
// Lên main phải bấm `seed-prod-roles.yml` (RBAC v2 đọc quyền từ DB).
import { describe, expect, it } from "vitest";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { ROLE_SEED } from "../../prisma/seed-roles";

const KEYS = [
  "affiliates:view",
  "affiliates:manage",
  "affiliate_campaigns:view",
  "affiliate_campaigns:manage",
  "affiliate_campaigns:activate",
  "affiliate_memberships:manage",
  "affiliate_links:manage",
  "affiliate_referrals:view-org",
  "affiliate_referrals:manage",
] as const;
type Key = (typeof KEYS)[number];

/** Vai → tập khoá Affiliate. Vai KHÔNG liệt kê = không có khoá nào (kiểm riêng ở [AQM-02]). */
const MA_TRAN: Readonly<Record<string, readonly Key[]>> = {
  SUPER_ADMIN: [...KEYS],
  HO_MARKETING: ["affiliates:view", "affiliates:manage", "affiliate_campaigns:view", "affiliate_campaigns:manage", "affiliate_memberships:manage", "affiliate_links:manage", "affiliate_referrals:view-org", "affiliate_referrals:manage"],
  HO_ACCOUNTANT: ["affiliates:view", "affiliate_campaigns:view", "affiliate_referrals:view-org"],
  CENTER_MANAGER: ["affiliates:view", "affiliate_campaigns:view", "affiliate_referrals:view-org"],
  GIAM_DOC: ["affiliates:view", "affiliate_campaigns:view", "affiliate_campaigns:activate", "affiliate_referrals:view-org"],
};

const giu = (code: string): string[] => {
  const r = ROLE_SEED.find((x) => x.code === code);
  if (!r) throw new Error(`ROLE_SEED thiếu RoleDef ${code}`);
  return r.perms.map((p) => p.action);
};
const aiGiu = (key: string): string[] => ROLE_SEED.filter((r) => r.perms.some((p) => p.action === key)).map((r) => r.code);

describe("[AQM-01] từng ô vai × khoá: CÓ ở đúng vai, KHÔNG ở vai còn lại", () => {
  for (const key of KEYS) {
    it(`${key}: đúng tập vai, không hơn không kém`, () => {
      const mongDoi = Object.entries(MA_TRAN)
        .filter(([, ks]) => ks.includes(key))
        .map(([vai]) => vai)
        .sort();
      expect(mongDoi.length).toBeGreaterThan(0); // đối chứng dương: khoá này CÓ người giữ
      expect(aiGiu(key).sort()).toEqual(mongDoi);
    });
  }
  for (const [vai, ks] of Object.entries(MA_TRAN)) {
    it(`${vai}: có đủ ${ks.length} khoá và KHÔNG có khoá nào ngoài danh sách`, () => {
      const co = giu(vai).filter((a): a is Key => (KEYS as readonly string[]).includes(a));
      expect([...co].sort()).toEqual([...ks].sort());
    });
  }
});

describe("[AQM-02] vai KHÔNG liệt kê ở ma trận không có khoá Affiliate nào (kể cả vai mới thêm sau này)", () => {
  it("mọi RoleDef ngoài ma trận ⇒ 0 khoá", () => {
    const ngoai = ROLE_SEED.filter((r) => !(r.code in MA_TRAN));
    expect(ngoai.length).toBeGreaterThan(5); // đối chứng dương: có vai để kiểm
    const viPham = ngoai.flatMap((r) => r.perms.filter((p) => p.action.startsWith("affiliate")).map((p) => `${r.code}·${p.action}`));
    expect(viPham).toEqual([]);
  });
  it("PARENT (vai quan hệ, không nằm trong cây OrgUnit) không có khoá quản trị Affiliate nào — cổng đối tác của họ gác bằng bảng nối, không bằng RoleDef", () => {
    expect(giu("PARENT").filter((a) => a.startsWith("affiliate"))).toEqual([]);
  });
});

describe("[AQM-03] Giám đốc: GIÁM SÁT được (xem referral) nhưng KHÔNG QUẢN LÝ (không manage, không phát link, không ghi danh)", () => {
  it("đối chứng dương: thấy tab Referral; kích hoạt được campaign", () => {
    expect(giu("GIAM_DOC")).toContain("affiliate_referrals:view-org");
    expect(giu("GIAM_DOC")).toContain("affiliate_campaigns:activate");
  });
  it("đối chứng ÂM: không có bất kỳ khoá GHI nào ngoài `activate`", () => {
    for (const k of ["affiliates:manage", "affiliate_campaigns:manage", "affiliate_memberships:manage", "affiliate_links:manage", "affiliate_referrals:manage"] as const) {
      expect(giu("GIAM_DOC"), k).not.toContain(k);
    }
  });
});

describe("[AQM-04] tab nào MỞ ĐƯỢC theo vai (PAGE_GATES): hợp của các khoá gác tab", () => {
  const TAB = {
    affiliate: "/nguon-hoa-hong/affiliate",
    campaign: "/nguon-hoa-hong/campaign",
    website: "/nguon-hoa-hong/website",
    link: "/nguon-hoa-hong/link",
    referral: "/nguon-hoa-hong/referral",
  } as const;
  const mo = (vai: string, tab: keyof typeof TAB): boolean => (PAGE_GATES as Record<string, readonly string[]>)[TAB[tab]]!.some((k) => giu(vai).includes(k));
  const MONG_DOI: Record<string, Record<keyof typeof TAB, boolean>> = {
    SUPER_ADMIN: { affiliate: true, campaign: true, website: true, link: true, referral: true },
    HO_MARKETING: { affiliate: true, campaign: true, website: true, link: true, referral: true },
    GIAM_DOC: { affiliate: true, campaign: true, website: true, link: true, referral: true },
    HO_ACCOUNTANT: { affiliate: true, campaign: true, website: true, link: true, referral: true },
    CENTER_MANAGER: { affiliate: true, campaign: true, website: true, link: true, referral: true },
    CENTER_SALES_CSM: { affiliate: false, campaign: false, website: false, link: false, referral: false },
    TEACHER: { affiliate: false, campaign: false, website: false, link: false, referral: false },
    PARENT: { affiliate: false, campaign: false, website: false, link: false, referral: false },
  };
  for (const [vai, tabs] of Object.entries(MONG_DOI)) {
    it(`${vai}: ${Object.entries(tabs)
      .map(([t, v]) => `${t}=${v ? "mở" : "đóng"}`)
      .join(" · ")}`, () => {
      for (const t of Object.keys(TAB) as (keyof typeof TAB)[]) expect(mo(vai, t), `${vai} → ${t}`).toBe(tabs[t]);
    });
  }
  it("trước bản vá, Giám đốc KHÔNG mở được tab Referral — phép đo chứng minh ma trận đang bắt đúng khoá thêm vào", () => {
    const truoc = giu("GIAM_DOC").filter((k) => k !== "affiliate_referrals:view-org");
    expect((PAGE_GATES as Record<string, readonly string[]>)[TAB.referral]!.some((k) => truoc.includes(k))).toBe(false);
  });
});
