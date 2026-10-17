// @vitest-environment node
/**
 * [AFC-DB-*] — CAMPAIGN · QUY TẮC QUY NGUỒN · WEBSITE · MEMBERSHIP của Affiliate trên Postgres THẬT (AFF-P0b).
 *
 * Thứ chỉ DB mới chứng minh: CHECK của migration CHẶN thật khi đi vòng qua tầng ứng dụng; cổng KÍCH HOẠT đứng dưới khoá hàng (kích hoạt vs gỡ website chạy ĐUA — không bao giờ ra
 * campaign ACTIVE mà không còn website); chạy lại sau tạm dừng đi qua CÙNG cổng; từ chối ⇒ KHÔNG có dòng nào ghi (cổng đứng trước phép ghi); khoá lạc quan; mở lại membership không tạo dòng trùng.
 *
 * Chạy: `pnpm test:hoa-hong-db` (hoặc `vitest run -c vitest.db.config.ts tests/hoa-hong/affiliate-campaign.spec.ts`). `pnpm test:unit` trần sẽ SKIP.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dữ liệu mang tiền tố `FXAFC` và được dọn ĐẦU mỗi ca (mỗi ca tự dựng fixture — luật 18). Ngày TUYỆT ĐỐI (luật 19).
 */
import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { docDoiTacChoCampaign, docLuaChonChoCampaign, docMembership, docXemTruocNguon } from "../../lib/affiliate/doc-campaign";
import { doiTrangThaiCampaign, ganWebsite, goWebsite, suaCampaign, taoCampaign, themQuyTac, xoaQuyTac } from "../../lib/affiliate/ghi-campaign";
import { doiTrangThaiMembership, suaMembership, themMembership } from "../../lib/affiliate/ghi-membership";

if (!RUN_DB_TESTS) console.warn(`[AFC-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "FXAFC";
const NGUOI = { userId: "fx-afc-user", ten: "Quản trị fixture AFC" };
const NOW = new Date("2026-10-13T03:00:00.000Z");
const MUON = new Date("2026-10-13T04:00:00.000Z");
const LY_DO = "Lý do đủ dài để qua cổng";

let seq = 0;
const ma = (t: string) => `${P}_${t}${(seq += 1)}`;

async function don() {
  const camp = await db.affiliateCampaign.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
  const ids = camp.map((c) => c.id);
  await db.affiliateMembership.deleteMany({ where: { campaignId: { in: ids } } });
  await db.affiliateCampaignRule.deleteMany({ where: { campaignId: { in: ids } } });
  await db.affiliateCampaignSite.deleteMany({ where: { campaignId: { in: ids } } });
  await db.affiliateCampaign.deleteMany({ where: { id: { in: ids } } });
  await db.affiliatePartyTag.deleteMany({ where: { party: { code: { startsWith: P } } } });
  await db.affiliate.deleteMany({ where: { code: { startsWith: P } } });
  await db.affiliateSite.deleteMany({ where: { code: { startsWith: P } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: P } } });
  await db.affiliateTag.deleteMany({ where: { code: { startsWith: P } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: P } } });
  await db.auditLog.deleteMany({ where: { actorName: NGUOI.ten } });
}

beforeEach(async () => {
  if (RUN_DB_TESTS) await don();
});
afterAll(async () => {
  if (RUN_DB_TESTS) await don();
});

const nguon = (p: { status?: "ACTIVE" | "INACTIVE" | "DRAFT"; selectable?: boolean } = {}) => {
  const code = ma("S");
  return db.leadSourceGroup.create({
    data: { code, name: `Nguồn ${code}`, sourceType: "PARTNER", referrerRequirement: "NONE", sortOrder: 900, status: p.status ?? "ACTIVE", selectable: p.selectable ?? true },
  });
};
const website = (status: "ACTIVE" | "INACTIVE" = "ACTIVE") => {
  const code = ma("W");
  const host = `${code.toLowerCase().replace(/_/g, "-")}.example.test`; // CHECK `AffiliateSite_domains_chk`: chỉ a-z 0-9 . , -
  return db.affiliateSite.create({ data: { code, name: `Web ${code}`, baseUrl: `https://${host}`, allowedDomains: [host], status } });
};
const loai = () => {
  const code = ma("T");
  return db.affiliateType.create({ data: { code, name: `Loại ${code}` } });
};
const nhan = () => {
  const code = ma("G");
  return db.affiliateTag.create({ data: { code, name: `Nhãn ${code}` } });
};
const doiTac = (p: { status?: "ACTIVE" | "SUSPENDED" | "PENDING"; typeId?: string | null } = {}) => {
  const code = ma("D");
  return db.affiliate.create({ data: { code, name: `Đối tác ${code}`, status: p.status ?? "ACTIVE", isActive: (p.status ?? "ACTIVE") === "ACTIVE", typeId: p.typeId ?? null } });
};

const DAU_VAO_TAO = (code: string, p: Record<string, unknown> = {}) => ({
  code,
  name: `Campaign ${code}`,
  description: null,
  attributionModel: "FIRST_VALID",
  cookieWindowDays: 30,
  protectWindowDays: 90,
  allowSelfReferral: false,
  defaultSourceGroupId: null,
  effectiveFrom: null,
  effectiveTo: null,
  ...p,
});

async function taoNhap(p: Record<string, unknown> = {}) {
  const r = await taoCampaign({ nguoi: NGUOI, vao: DAU_VAO_TAO(ma("C"), p), now: NOW });
  if (!r.ok) throw new Error(`fixture: ${r.loi}`);
  return r;
}

/**
 * Campaign DRAFT đủ điều kiện kích hoạt: nguồn mặc định ACTIVE + một website ACTIVE + (AFF-L1) đã CHỌN RÕ «không có mức riêng». Vế thưởng đặt thẳng ở DB vì bộ này không kiểm vế đó —
 * nó có bộ riêng (`affiliate-chinh-sach-campaign.spec.ts`); để trống thì mọi ca kích hoạt ở đây đỏ vì lý do chẳng liên quan.
 */
async function campaignSanSang(p: Record<string, unknown> = {}) {
  const [n, w] = await Promise.all([nguon(), website()]);
  const c = await taoNhap({ defaultSourceGroupId: n.id, ...p });
  const g = await ganWebsite({ nguoi: NGUOI, campaignId: c.id, siteId: w.id, now: NOW });
  if (!g.ok) throw new Error(`fixture: ${g.loi}`);
  await db.affiliateCampaign.update({ where: { id: c.id }, data: { rewardMode: "NONE" } });
  return { c, n, w };
}

const dongCampaign = (id: string) => db.affiliateCampaign.findUniqueOrThrow({ where: { id } });
/** Chọn rõ «không có mức riêng» thẳng ở DB (xem `campaignSanSang`): các ca dưới đây kiểm website / nguồn / hiệu lực, không kiểm vế thưởng. */
const khongThuongRieng = (id: string) => db.affiliateCampaign.update({ where: { id }, data: { rewardMode: "NONE" } });
const dangKy = (entityId: string, action?: string) => db.auditLog.count({ where: { entityId, actorName: NGUOI.ten, ...(action ? { action } : {}) } });
const kichHoat = async (id: string, now = NOW) => doiTrangThaiCampaign({ nguoi: NGUOI, id, updatedAtDaThay: (await dongCampaign(id)).updatedAt, den: "ACTIVE", lyDo: null, now });
const tamDung = async (id: string) => doiTrangThaiCampaign({ nguoi: NGUOI, id, updatedAtDaThay: (await dongCampaign(id)).updatedAt, den: "PAUSED", lyDo: LY_DO, now: NOW });

describe.skipIf(!RUN_DB_TESTS)("[AFC-DB-01] tạo campaign", () => {
  it("ra đời ở DRAFT với đúng tham số, người tạo được ghi, nhật ký CÙNG lượt", async () => {
    const n = await nguon();
    const r = await taoNhap({ defaultSourceGroupId: n.id, cookieWindowDays: 45, allowSelfReferral: true });
    const d = await dongCampaign(r.id);
    expect(d).toMatchObject({ status: "DRAFT", cookieWindowDays: 45, protectWindowDays: 90, allowSelfReferral: true, defaultSourceGroupId: n.id, createdById: NGUOI.userId, activatedAt: null });
    expect(await dangKy(r.id, "CAMPAIGN_TAO")).toBe(1);
  });

  it("trùng mã ⇒ «đã có», KHÔNG thêm dòng, KHÔNG thêm nhật ký; hai lượt tạo cùng mã chạy ĐUA chỉ một lượt thắng", async () => {
    const a = await taoNhap();
    const lai = await taoCampaign({ nguoi: NGUOI, vao: DAU_VAO_TAO(a.code), now: NOW });
    expect(lai).toMatchObject({ ok: false, truong: "code" });
    const code = ma("C");
    const dua = await Promise.all([taoCampaign({ nguoi: NGUOI, vao: DAU_VAO_TAO(code), now: NOW }), taoCampaign({ nguoi: NGUOI, vao: DAU_VAO_TAO(code), now: NOW })]);
    expect(dua.filter((x) => x.ok)).toHaveLength(1);
    expect(dua.find((x) => !x.ok)).toMatchObject({ ok: false, truong: "code" });
    expect(await db.affiliateCampaign.count({ where: { code } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "CAMPAIGN_TAO", actorName: NGUOI.ten } })).toBe(2);
  });

  it("nguồn mặc định không dùng được (tạm ngừng / không chọn được / không tồn tại) ⇒ từ chối và không ghi gì", async () => {
    for (const nguonXau of [await nguon({ status: "INACTIVE" }), await nguon({ selectable: false })]) {
      const code = ma("C");
      const r = await taoCampaign({ nguoi: NGUOI, vao: DAU_VAO_TAO(code, { defaultSourceGroupId: nguonXau.id }), now: NOW });
      expect(r).toMatchObject({ ok: false, truong: "defaultSourceGroupId" });
      expect(await db.affiliateCampaign.count({ where: { code } })).toBe(0);
    }
    expect(await taoCampaign({ nguoi: NGUOI, vao: DAU_VAO_TAO(ma("C"), { defaultSourceGroupId: "khong-co-that" }), now: NOW })).toMatchObject({ ok: false, truong: "defaultSourceGroupId" });
  });
});

describe.skipIf(!RUN_DB_TESTS)("[AFC-DB-02] CHECK của migration chặn THẬT khi đi vòng qua tầng ứng dụng", () => {
  const mat = async (f: () => Promise<unknown>): Promise<string> => {
    try {
      await f();
      return "KHONG_LOI";
    } catch (e) {
      const meta = (e as { meta?: { code?: string; message?: string } }).meta;
      return `${meta?.code ?? ""} ${meta?.message ?? ""} ${(e as Error).message}`;
    }
  };
  const them = (code: string, cookie: number, baoVe: number, tu: string | null, den: string | null) =>
    db.$executeRaw`INSERT INTO "AffiliateCampaign" ("id","code","name","cookieWindowDays","protectWindowDays","effectiveFrom","effectiveTo","updatedAt")
      VALUES (${ma("ID")}, ${code}, 'x', ${cookie}, ${baoVe}, ${tu}::timestamptz, ${den}::timestamptz, now())`;

  it("cookie 0 · cookie 366 · bảo vệ 0 · bảo vệ 731 · mã chữ thường · hết hạn ≤ bắt đầu: mỗi cái bị CHECK (23514) chặn; bộ hợp lệ thì qua", async () => {
    expect(await mat(() => them(ma("C"), 1, 1, null, null))).toBe("KHONG_LOI");
    expect(await mat(() => them(ma("C"), 365, 730, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"))).toBe("KHONG_LOI");
    for (const [ten, f] of [
      ["cookie 0", () => them(ma("C"), 0, 90, null, null)],
      ["cookie 366", () => them(ma("C"), 366, 90, null, null)],
      ["bảo vệ 0", () => them(ma("C"), 30, 0, null, null)],
      ["bảo vệ 731", () => them(ma("C"), 30, 731, null, null)],
      ["mã chữ thường", () => them(`${P.toLowerCase()}_thuong`, 30, 90, null, null)],
      ["hết hạn = bắt đầu", () => them(ma("C"), 30, 90, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")],
    ] as const) {
      expect(await mat(f), ten).toContain("23514");
    }
  });

  it("quy tắc không loại không nhãn · ruleKey sai khuôn: CHECK chặn; membership hiệu lực ngược: CHECK chặn", async () => {
    const [c, n, t] = await Promise.all([taoNhap(), nguon(), loai()]);
    const rule = (typeId: string | null, tagId: string | null, key: string) =>
      db.$executeRaw`INSERT INTO "AffiliateCampaignRule" ("id","campaignId","typeId","tagId","ruleKey","sourceGroupId","updatedAt") VALUES (${ma("R")}, ${c.id}, ${typeId}, ${tagId}, ${key}, ${n.id}, now())`;
    expect(await mat(() => rule(null, null, "T:*|G:*"))).toContain("23514");
    expect(await mat(() => rule(t.id, null, "T:sai|G:*"))).toContain("23514");
    expect(await mat(() => rule(t.id, null, `T:${t.id}|G:*`))).toBe("KHONG_LOI");
    const d = await doiTac();
    const mem = () =>
      db.$executeRaw`INSERT INTO "AffiliateMembership" ("id","partyId","campaignId","effectiveFrom","effectiveTo","updatedAt") VALUES (${ma("M")}, ${d.id}, ${c.id}, '2026-05-01T00:00:00Z'::timestamptz, '2026-04-01T00:00:00Z'::timestamptz, now())`;
    expect(await mat(mem)).toContain("23514");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[AFC-DB-03] kích hoạt — cổng đứng dưới khoá, từ chối không để lại dấu vết", () => {
  it("thiếu website ⇒ từ chối, vẫn DRAFT, không nhật ký kích hoạt, `activatedAt` trống; đủ điều kiện ⇒ ACTIVE + người kích hoạt + nhật ký", async () => {
    const n = await nguon();
    const w = await website();
    const c = await taoNhap({ defaultSourceGroupId: n.id });
    await khongThuongRieng(c.id);
    const chan = await kichHoat(c.id);
    expect(chan).toMatchObject({ ok: false, truong: "kichHoat" });
    expect(chan.ok === false && chan.loi).toContain("website");
    expect(await dongCampaign(c.id)).toMatchObject({ status: "DRAFT", activatedAt: null, activatedById: null });
    expect(await dangKy(c.id, "CAMPAIGN_KICH_HOAT")).toBe(0);

    await ganWebsite({ nguoi: NGUOI, campaignId: c.id, siteId: w.id, now: NOW });
    const ok = await kichHoat(c.id, MUON);
    expect(ok).toMatchObject({ ok: true, tu: "DRAFT", den: "ACTIVE" });
    expect(await dongCampaign(c.id)).toMatchObject({ status: "ACTIVE", activatedById: NGUOI.userId, activatedAt: MUON });
    expect(await dangKy(c.id, "CAMPAIGN_KICH_HOAT")).toBe(1);
  });

  it("mô hình SPLIT lưu được ở nháp nhưng KHÔNG kích hoạt được", async () => {
    const { c } = await campaignSanSang({ attributionModel: "SPLIT" });
    const r = await kichHoat(c.id);
    expect(r.ok).toBe(false);
    expect((await dongCampaign(c.id)).status).toBe("DRAFT");
  });

  it("không có nguồn mặc định và không quy tắc ⇒ chặn; thêm quy tắc rồi thì qua", async () => {
    const w = await website();
    const n = await nguon();
    const t = await loai();
    const c = await taoNhap();
    await khongThuongRieng(c.id);
    await ganWebsite({ nguoi: NGUOI, campaignId: c.id, siteId: w.id, now: NOW });
    expect((await kichHoat(c.id)).ok).toBe(false);
    expect((await themQuyTac({ nguoi: NGUOI, campaignId: c.id, vao: { typeId: t.id, tagId: null, sourceGroupId: n.id }, lyDo: null, now: NOW })).ok).toBe(true);
    expect((await kichHoat(c.id)).ok).toBe(true);
  });

  it("nguồn bị ngừng SAU khi chọn ⇒ kích hoạt bị chặn, câu NÊU TÊN nguồn và nguyên nhân; vẫn DRAFT", async () => {
    const { c, n } = await campaignSanSang();
    await db.leadSourceGroup.update({ where: { id: n.id }, data: { status: "INACTIVE" } });
    const r = await kichHoat(c.id);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.loi).toContain(n.name);
      expect(r.loi).toContain("Tạm ngừng");
    }
    expect((await dongCampaign(c.id)).status).toBe("DRAFT");
  });

  it("CHẠY LẠI sau tạm dừng đi qua CÙNG cổng: ngừng nguồn lúc đang tạm dừng ⇒ chạy lại bị chặn, vẫn PAUSED", async () => {
    const { c, n } = await campaignSanSang();
    expect((await kichHoat(c.id)).ok).toBe(true);
    expect((await tamDung(c.id)).ok).toBe(true);
    await db.leadSourceGroup.update({ where: { id: n.id }, data: { status: "INACTIVE" } });
    const r = await kichHoat(c.id);
    expect(r.ok).toBe(false);
    expect((await dongCampaign(c.id)).status).toBe("PAUSED");
    await db.leadSourceGroup.update({ where: { id: n.id }, data: { status: "ACTIVE" } });
    const lai = await kichHoat(c.id);
    expect(lai).toMatchObject({ ok: true, tu: "PAUSED", den: "ACTIVE" });
    expect(await dangKy(c.id, "CAMPAIGN_CHAY_LAI")).toBe(1);
  });

  it("đã hết hiệu lực (hạn ≤ `now`) ⇒ chặn", async () => {
    const { c } = await campaignSanSang({ effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: new Date("2026-06-01T00:00:00.000Z") });
    const r = await kichHoat(c.id);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.loi).toContain("hết hiệu lực");
  });

  it("tạm dừng / kết thúc không có lý do ⇒ chặn, trạng thái không đổi; ENDED là cuối", async () => {
    const { c } = await campaignSanSang();
    await kichHoat(c.id);
    const thieu = await doiTrangThaiCampaign({ nguoi: NGUOI, id: c.id, updatedAtDaThay: (await dongCampaign(c.id)).updatedAt, den: "PAUSED", lyDo: "ngắn", now: NOW });
    expect(thieu).toMatchObject({ ok: false, truong: "lyDo" });
    expect((await dongCampaign(c.id)).status).toBe("ACTIVE");
    const ket = await doiTrangThaiCampaign({ nguoi: NGUOI, id: c.id, updatedAtDaThay: (await dongCampaign(c.id)).updatedAt, den: "ENDED", lyDo: LY_DO, now: NOW });
    expect(ket.ok).toBe(true);
    expect((await kichHoat(c.id)).ok).toBe(false);
    expect((await dongCampaign(c.id)).status).toBe("ENDED");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[AFC-DB-04] khoá lạc quan & ĐUA", () => {
  it("`updatedAtDaThay` cũ ⇒ «vừa được người khác đổi», không ghi gì", async () => {
    const { c } = await campaignSanSang();
    const cu = (await dongCampaign(c.id)).updatedAt;
    expect((await suaCampaign({ nguoi: NGUOI, id: c.id, updatedAtDaThay: cu, vao: { name: "Tên 2" }, lyDo: null, now: NOW })).ok).toBe(true);
    const lai = await suaCampaign({ nguoi: NGUOI, id: c.id, updatedAtDaThay: cu, vao: { name: "Tên 3" }, lyDo: null, now: NOW });
    expect(lai).toMatchObject({ ok: false, truong: "vuaDoi" });
    expect((await dongCampaign(c.id)).name).toBe("Tên 2");
  });

  it("đổi quy tắc / website / thành viên đóng dấu lại `updatedAt` ⇒ kích hoạt trên trang CŨ bị từ chối (không kích hoạt trên cấu hình chưa thấy)", async () => {
    const { c } = await campaignSanSang();
    const cu = (await dongCampaign(c.id)).updatedAt;
    const w2 = await website();
    await ganWebsite({ nguoi: NGUOI, campaignId: c.id, siteId: w2.id, now: NOW });
    expect((await dongCampaign(c.id)).updatedAt.getTime()).toBeGreaterThan(cu.getTime());
    const r = await doiTrangThaiCampaign({ nguoi: NGUOI, id: c.id, updatedAtDaThay: cu, den: "ACTIVE", lyDo: null, now: NOW });
    expect(r).toMatchObject({ ok: false, truong: "vuaDoi" });
    expect((await dongCampaign(c.id)).status).toBe("DRAFT");
  });

  it("ĐUA: kích hoạt × gỡ website duy nhất ⇒ KHÔNG BAO GIỜ ra campaign ACTIVE mà không còn website bật (lặp 6 lần)", async () => {
    for (let i = 0; i < 6; i += 1) {
      const { c, w } = await campaignSanSang();
      const cu = (await dongCampaign(c.id)).updatedAt;
      const [a, g] = await Promise.all([
        doiTrangThaiCampaign({ nguoi: NGUOI, id: c.id, updatedAtDaThay: cu, den: "ACTIVE", lyDo: null, now: NOW }),
        goWebsite({ nguoi: NGUOI, campaignId: c.id, siteId: w.id, lyDo: null, now: NOW }),
      ]);
      const d = await dongCampaign(c.id);
      const conSite = await db.affiliateCampaignSite.count({ where: { campaignId: c.id, site: { status: "ACTIVE" } } });
      if (d.status === "ACTIVE") {
        expect(conSite, `lượt ${i}: ACTIVE nhưng mất website (kích hoạt=${JSON.stringify(a)} gỡ=${JSON.stringify(g)})`).toBeGreaterThan(0);
        expect(g.ok, "đã ACTIVE thì gỡ website cuối phải bị từ chối").toBe(false);
      } else {
        expect(a.ok, "gỡ website thắng thì kích hoạt phải bị từ chối").toBe(false);
        expect(g.ok).toBe(true);
      }
    }
  });

  it("ĐUA: kích hoạt × thêm quy tắc sai trạng thái không làm hỏng: quy tắc không thêm được khi ACTIVE", async () => {
    const { c } = await campaignSanSang();
    const t = await loai();
    const n2 = await nguon();
    expect((await kichHoat(c.id)).ok).toBe(true);
    const r = await themQuyTac({ nguoi: NGUOI, campaignId: c.id, vao: { typeId: t.id, tagId: null, sourceGroupId: n2.id }, lyDo: LY_DO, now: NOW });
    expect(r).toMatchObject({ ok: false, truong: "trangThai" });
    expect(await db.affiliateCampaignRule.count({ where: { campaignId: c.id } })).toBe(0);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[AFC-DB-05] sửa campaign", () => {
  it("ĐANG CHẠY: đổi cookie bị chặn (không ghi, không nhật ký); đổi tên + hạn được; nhật ký mang giá trị cũ → mới", async () => {
    const { c } = await campaignSanSang();
    await kichHoat(c.id);
    const truocNhatKy = await db.auditLog.count({ where: { actorName: NGUOI.ten, action: "CAMPAIGN_SUA" } });
    const chan = await suaCampaign({ nguoi: NGUOI, id: c.id, updatedAtDaThay: (await dongCampaign(c.id)).updatedAt, vao: { cookieWindowDays: 60 }, lyDo: LY_DO, now: NOW });
    expect(chan).toMatchObject({ ok: false, truong: "cookieWindowDays" });
    expect((await dongCampaign(c.id)).cookieWindowDays).toBe(30);
    expect(await db.auditLog.count({ where: { actorName: NGUOI.ten, action: "CAMPAIGN_SUA" } })).toBe(truocNhatKy);

    const han = new Date("2027-03-31T00:00:00.000Z");
    const ok = await suaCampaign({ nguoi: NGUOI, id: c.id, updatedAtDaThay: (await dongCampaign(c.id)).updatedAt, vao: { name: "Tên mới", effectiveTo: han }, lyDo: null, now: NOW });
    expect(ok).toMatchObject({ ok: true, doi: true, truongDoi: ["name", "effectiveTo"] });
    const nk = await db.auditLog.findFirstOrThrow({ where: { entityId: c.id, action: "CAMPAIGN_SUA" } });
    expect(nk.oldValues).toMatchObject({ effectiveTo: null });
    expect(nk.newValues).toMatchObject({ name: "Tên mới", effectiveTo: han.toISOString() });
  });

  it("PAUSED: đổi tham số cần lý do ≥ 10 ký tự; có lý do thì được và lý do vào nhật ký; nguồn mặc định mới không dùng được bị từ chối", async () => {
    const { c } = await campaignSanSang();
    await kichHoat(c.id);
    await tamDung(c.id);
    const thieu = await suaCampaign({ nguoi: NGUOI, id: c.id, updatedAtDaThay: (await dongCampaign(c.id)).updatedAt, vao: { protectWindowDays: 120 }, lyDo: null, now: NOW });
    expect(thieu).toMatchObject({ ok: false, truong: "lyDo" });
    const xau = await nguon({ status: "INACTIVE" });
    expect(await suaCampaign({ nguoi: NGUOI, id: c.id, updatedAtDaThay: (await dongCampaign(c.id)).updatedAt, vao: { defaultSourceGroupId: xau.id }, lyDo: LY_DO, now: NOW })).toMatchObject({ ok: false, truong: "defaultSourceGroupId" });
    const ok = await suaCampaign({ nguoi: NGUOI, id: c.id, updatedAtDaThay: (await dongCampaign(c.id)).updatedAt, vao: { protectWindowDays: 120 }, lyDo: LY_DO, now: NOW });
    expect(ok.ok).toBe(true);
    expect((await dongCampaign(c.id)).protectWindowDays).toBe(120);
    expect((await db.auditLog.findFirstOrThrow({ where: { entityId: c.id, action: "CAMPAIGN_SUA" } })).reason).toBe(LY_DO);
  });

  it("ENDED không sửa; hết hạn không sau bắt đầu bị chặn ở tầng ứng dụng (câu tiếng Việt, không phải lỗi Postgres)", async () => {
    const c = await taoNhap({ effectiveFrom: new Date("2026-10-01T00:00:00.000Z") });
    const sai = await suaCampaign({ nguoi: NGUOI, id: c.id, updatedAtDaThay: (await dongCampaign(c.id)).updatedAt, vao: { effectiveTo: new Date("2026-09-01T00:00:00.000Z") }, lyDo: null, now: NOW });
    expect(sai).toMatchObject({ ok: false, truong: "effectiveTo" });
    expect(sai.ok === false && sai.loi).not.toMatch(/violates|check constraint/i);
    await doiTrangThaiCampaign({ nguoi: NGUOI, id: c.id, updatedAtDaThay: (await dongCampaign(c.id)).updatedAt, den: "ENDED", lyDo: LY_DO, now: NOW });
    expect(await suaCampaign({ nguoi: NGUOI, id: c.id, updatedAtDaThay: (await dongCampaign(c.id)).updatedAt, vao: { name: "Sửa sau khi kết thúc" }, lyDo: null, now: NOW })).toMatchObject({ ok: false });
  });
});

describe.skipIf(!RUN_DB_TESTS)("[AFC-DB-06] quy tắc quy nguồn", () => {
  it("thêm quy tắc theo loại: ruleKey đúng khuôn, policyId trống, nhật ký gắn vào campaign; theo nhãn và theo cả hai là ba dòng khác nhau", async () => {
    const [c, n, t, g] = await Promise.all([taoNhap(), nguon(), loai(), nhan()]);
    for (const vao of [
      { typeId: t.id, tagId: null, sourceGroupId: n.id },
      { typeId: null, tagId: g.id, sourceGroupId: n.id },
      { typeId: t.id, tagId: g.id, sourceGroupId: n.id },
    ]) {
      expect((await themQuyTac({ nguoi: NGUOI, campaignId: c.id, vao, lyDo: null, now: NOW })).ok).toBe(true);
    }
    const ds = await db.affiliateCampaignRule.findMany({ where: { campaignId: c.id }, orderBy: { ruleKey: "asc" } });
    expect(ds.map((r) => r.ruleKey).sort()).toEqual([`T:${t.id}|G:${g.id}`, `T:${t.id}|G:*`, `T:*|G:${g.id}`].sort());
    expect(ds.every((r) => r.policyId === null)).toBe(true);
    expect(await dangKy(c.id, "CAMPAIGN_THEM_QUY_TAC")).toBe(3);
  });

  it("trùng cặp ⇒ «đã có quy tắc cho cặp này», còn đúng 1 dòng; hai lượt ĐUA cùng cặp chỉ một lượt thắng", async () => {
    const [c, n, t] = await Promise.all([taoNhap(), nguon(), loai()]);
    const vao = { typeId: t.id, tagId: null, sourceGroupId: n.id };
    const dua = await Promise.all([themQuyTac({ nguoi: NGUOI, campaignId: c.id, vao, lyDo: null, now: NOW }), themQuyTac({ nguoi: NGUOI, campaignId: c.id, vao, lyDo: null, now: NOW })]);
    expect(dua.filter((x) => x.ok)).toHaveLength(1);
    const thua = dua.find((x) => !x.ok);
    expect(thua && !thua.ok && thua.loi).toContain("Đã có quy tắc cho cặp này");
    expect(await db.affiliateCampaignRule.count({ where: { campaignId: c.id } })).toBe(1);
  });

  it("không loại không nhãn ⇒ từ chối; nguồn không dùng được ⇒ từ chối; loại / nhãn đã tắt ⇒ từ chối; không dòng nào được ghi", async () => {
    const [c, n, t] = await Promise.all([taoNhap(), nguon(), loai()]);
    const xau = await nguon({ status: "INACTIVE" });
    const tat = await db.affiliateType.update({ where: { id: t.id }, data: { isActive: false } });
    expect(await themQuyTac({ nguoi: NGUOI, campaignId: c.id, vao: { typeId: null, tagId: null, sourceGroupId: n.id }, lyDo: null, now: NOW })).toMatchObject({ ok: false });
    expect(await themQuyTac({ nguoi: NGUOI, campaignId: c.id, vao: { typeId: t.id, tagId: null, sourceGroupId: xau.id }, lyDo: null, now: NOW })).toMatchObject({ ok: false });
    expect(await themQuyTac({ nguoi: NGUOI, campaignId: c.id, vao: { typeId: tat.id, tagId: null, sourceGroupId: n.id }, lyDo: null, now: NOW })).toMatchObject({ ok: false, truong: "typeId" });
    expect(await db.affiliateCampaignRule.count({ where: { campaignId: c.id } })).toBe(0);
  });

  it("xoá quy tắc: nhật ký giữ giá trị cũ; PAUSED cần lý do; ĐANG CHẠY phải tạm dừng trước; quy tắc của campaign khác không xoá được qua campaign này", async () => {
    const { c, n } = await campaignSanSang();
    const khac = await taoNhap();
    const t = await loai();
    await themQuyTac({ nguoi: NGUOI, campaignId: c.id, vao: { typeId: t.id, tagId: null, sourceGroupId: n.id }, lyDo: null, now: NOW });
    await themQuyTac({ nguoi: NGUOI, campaignId: khac.id, vao: { typeId: t.id, tagId: null, sourceGroupId: n.id }, lyDo: null, now: NOW });
    const r = await db.affiliateCampaignRule.findFirstOrThrow({ where: { campaignId: c.id } });
    const rKhac = await db.affiliateCampaignRule.findFirstOrThrow({ where: { campaignId: khac.id } });
    expect(await xoaQuyTac({ nguoi: NGUOI, campaignId: c.id, ruleId: rKhac.id, lyDo: null, now: NOW })).toMatchObject({ ok: false });
    expect(await db.affiliateCampaignRule.count({ where: { id: rKhac.id } })).toBe(1);

    await kichHoat(c.id);
    expect(await xoaQuyTac({ nguoi: NGUOI, campaignId: c.id, ruleId: r.id, lyDo: LY_DO, now: NOW })).toMatchObject({ ok: false, truong: "trangThai" });
    await tamDung(c.id);
    expect(await xoaQuyTac({ nguoi: NGUOI, campaignId: c.id, ruleId: r.id, lyDo: null, now: NOW })).toMatchObject({ ok: false, truong: "lyDo" });
    expect((await xoaQuyTac({ nguoi: NGUOI, campaignId: c.id, ruleId: r.id, lyDo: LY_DO, now: NOW })).ok).toBe(true);
    expect(await db.affiliateCampaignRule.count({ where: { id: r.id } })).toBe(0);
    expect((await db.auditLog.findFirstOrThrow({ where: { entityId: c.id, action: "CAMPAIGN_XOA_QUY_TAC" } })).oldValues).toMatchObject({ ruleKey: `T:${t.id}|G:*` });
  });
});

describe.skipIf(!RUN_DB_TESTS)("[AFC-DB-07] website", () => {
  it("website TẮT hiện ở danh sách nhưng không gắn mới được; gắn trùng bị báo; gắn website bật được và có nhật ký", async () => {
    const [c, tat, bat] = await Promise.all([taoNhap(), website("INACTIVE"), website("ACTIVE")]);
    const luaChon = await docLuaChonChoCampaign(NOW);
    expect(luaChon.website.find((s) => s.id === tat.id)?.status).toBe("INACTIVE");
    expect(await ganWebsite({ nguoi: NGUOI, campaignId: c.id, siteId: tat.id, now: NOW })).toMatchObject({ ok: false, truong: "siteId" });
    expect((await ganWebsite({ nguoi: NGUOI, campaignId: c.id, siteId: bat.id, now: NOW })).ok).toBe(true);
    expect(await ganWebsite({ nguoi: NGUOI, campaignId: c.id, siteId: bat.id, now: NOW })).toMatchObject({ ok: false });
    expect(await db.affiliateCampaignSite.count({ where: { campaignId: c.id } })).toBe(1);
    expect(await dangKy(c.id, "CAMPAIGN_GAN_WEBSITE")).toBe(1);
  });

  it("ĐANG CHẠY: gỡ website bật CUỐI CÙNG bị chặn (còn nguyên liên kết); gắn thêm một cái rồi gỡ cái đầu thì được", async () => {
    const { c, w } = await campaignSanSang();
    await kichHoat(c.id);
    expect(await goWebsite({ nguoi: NGUOI, campaignId: c.id, siteId: w.id, lyDo: null, now: NOW })).toMatchObject({ ok: false, truong: "siteId" });
    expect(await db.affiliateCampaignSite.count({ where: { campaignId: c.id } })).toBe(1);
    const w2 = await website();
    expect((await ganWebsite({ nguoi: NGUOI, campaignId: c.id, siteId: w2.id, now: NOW })).ok).toBe(true);
    expect((await goWebsite({ nguoi: NGUOI, campaignId: c.id, siteId: w.id, lyDo: null, now: NOW })).ok).toBe(true);
    expect(await db.affiliateCampaignSite.count({ where: { campaignId: c.id } })).toBe(1);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[AFC-DB-08] membership", () => {
  const them = (campaignId: string, partyId: string, p: Record<string, unknown> = {}) =>
    themMembership({ nguoi: NGUOI, campaignId, vao: { partyId, groupLabel: null, effectiveFrom: null, effectiveTo: null, ...p }, now: NOW });
  const doi = async (id: string, den: "ACTIVE" | "SUSPENDED" | "ENDED", lyDo: string | null = null, now = NOW) =>
    doiTrangThaiMembership({ nguoi: NGUOI, id, updatedAtDaThay: (await db.affiliateMembership.findUniqueOrThrow({ where: { id } })).updatedAt, den, lyDo, now });

  it("thêm ⇒ PENDING (không tự ACTIVE); thêm lần hai ⇒ «đã ở trong campaign»; duyệt ghi người duyệt + lúc duyệt", async () => {
    const [c, d] = await Promise.all([taoNhap(), doiTac()]);
    const a = await them(c.id, d.id, { groupLabel: "Nhóm A" });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(await db.affiliateMembership.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "PENDING", groupLabel: "Nhóm A", approvedAt: null, createdById: NGUOI.userId });
    expect(await them(c.id, d.id)).toMatchObject({ ok: false, truong: "partyId" });
    expect(await db.affiliateMembership.count({ where: { campaignId: c.id } })).toBe(1);

    expect((await doi(a.id, "ACTIVE", null, MUON)).ok).toBe(true);
    expect(await db.affiliateMembership.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "ACTIVE", approvedById: NGUOI.userId, approvedAt: MUON });
  });

  it("ĐUA: hai lượt thêm cùng đối tác ⇒ đúng MỘT dòng, lượt thua nhận câu «đã ở trong campaign» (không phải lỗi 500)", async () => {
    const [c, d] = await Promise.all([taoNhap(), doiTac()]);
    const dua = await Promise.all([them(c.id, d.id), them(c.id, d.id)]);
    expect(dua.filter((x) => x.ok)).toHaveLength(1);
    const thua = dua.find((x) => !x.ok);
    expect(thua && !thua.ok && thua.loi).toContain("đã ở trong campaign");
    expect(await db.affiliateMembership.count({ where: { campaignId: c.id, partyId: d.id } })).toBe(1);
  });

  it("chỉ đối tác ACTIVE thêm được; campaign ENDED không nhận; tạm ngừng / kết thúc cần lý do", async () => {
    const [c, hoat, treo] = await Promise.all([taoNhap(), doiTac(), doiTac({ status: "SUSPENDED" })]);
    expect(await them(c.id, treo.id)).toMatchObject({ ok: false, truong: "partyId" });
    const a = await them(c.id, hoat.id);
    if (!a.ok) throw new Error("fixture");
    await doi(a.id, "ACTIVE");
    expect(await doi(a.id, "SUSPENDED", "ngắn")).toMatchObject({ ok: false, truong: "lyDo" });
    expect((await doi(a.id, "SUSPENDED", LY_DO)).ok).toBe(true);
    expect((await db.auditLog.findFirstOrThrow({ where: { entityId: a.id, action: "MEMBERSHIP_TAM_NGUNG" } })).reason).toBe(LY_DO);

    const cKet = await taoNhap();
    await doiTrangThaiCampaign({ nguoi: NGUOI, id: cKet.id, updatedAtDaThay: (await dongCampaign(cKet.id)).updatedAt, den: "ENDED", lyDo: LY_DO, now: NOW });
    const d2 = await doiTac();
    expect(await them(cKet.id, d2.id)).toMatchObject({ ok: false, truong: "campaign" });
    expect(await db.affiliateMembership.count({ where: { campaignId: cKet.id } })).toBe(0);
  });

  it("kết thúc rồi thêm lại ⇒ MỞ LẠI đúng dòng cũ (một dòng duy nhất), về PENDING, phê duyệt cũ bị bỏ, nhật ký giữ giá trị cũ", async () => {
    const [c, d] = await Promise.all([taoNhap(), doiTac()]);
    const a = await them(c.id, d.id, { groupLabel: "Nhóm cũ" });
    if (!a.ok) throw new Error("fixture");
    await doi(a.id, "ACTIVE", null, new Date("2026-10-05T00:00:00.000Z"));
    await db.affiliateMembership.update({ where: { id: a.id }, data: { effectiveFrom: new Date("2026-10-01T00:00:00.000Z") } });
    expect((await doi(a.id, "ENDED", LY_DO)).ok).toBe(true);
    const ketThuc = await db.affiliateMembership.findUniqueOrThrow({ where: { id: a.id } });
    expect(ketThuc).toMatchObject({ status: "ENDED", effectiveTo: NOW });

    const lai = await them(c.id, d.id, { groupLabel: null });
    expect(lai).toMatchObject({ ok: true, id: a.id, viec: "MO_LAI" });
    expect(await db.affiliateMembership.count({ where: { campaignId: c.id, partyId: d.id } })).toBe(1);
    const moi = await db.affiliateMembership.findUniqueOrThrow({ where: { id: a.id } });
    expect(moi).toMatchObject({ status: "PENDING", effectiveTo: null, approvedAt: null, approvedById: null, groupLabel: "Nhóm cũ" });
    const nk = await db.auditLog.findFirstOrThrow({ where: { entityId: a.id, action: "MEMBERSHIP_MO_LAI" } });
    expect(nk.oldValues).toMatchObject({ status: "ENDED" });
  });

  it("kết thúc dòng CHƯA bắt đầu hiệu lực ⇒ câu tiếng Việt nêu ngày, KHÔNG lỗi CHECK của Postgres, dòng không đổi", async () => {
    const [c, d] = await Promise.all([taoNhap(), doiTac()]);
    const a = await them(c.id, d.id, { effectiveFrom: new Date("2026-12-01T00:00:00.000Z") });
    if (!a.ok) throw new Error("fixture");
    const r = await doi(a.id, "ENDED", LY_DO);
    expect(r).toMatchObject({ ok: false, truong: "effectiveTo" });
    expect(r.ok === false && r.loi).toContain("01/12/2026");
    expect(r.ok === false && r.loi).not.toMatch(/violates|check constraint/i);
    expect((await db.affiliateMembership.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("PENDING");
  });

  it("khoá lạc quan: dấu thời gian cũ ⇒ «vừa được đổi»; sửa nhãn nhóm được và vào nhật ký", async () => {
    const [c, d] = await Promise.all([taoNhap(), doiTac()]);
    const a = await them(c.id, d.id);
    if (!a.ok) throw new Error("fixture");
    const cu = (await db.affiliateMembership.findUniqueOrThrow({ where: { id: a.id } })).updatedAt;
    expect((await suaMembership({ nguoi: NGUOI, id: a.id, updatedAtDaThay: cu, vao: { groupLabel: "Nhóm mới" }, lyDo: null, now: NOW })).ok).toBe(true);
    expect(await suaMembership({ nguoi: NGUOI, id: a.id, updatedAtDaThay: cu, vao: { groupLabel: "Nhóm khác" }, lyDo: null, now: NOW })).toMatchObject({ ok: false, truong: "vuaDoi" });
    expect((await db.affiliateMembership.findUniqueOrThrow({ where: { id: a.id } })).groupLabel).toBe("Nhóm mới");
  });

  it("danh sách thành viên: phân trang + lọc trạng thái; KHÔNG trả SĐT / email của đối tác", async () => {
    const c = await taoNhap();
    for (let i = 0; i < 3; i += 1) {
      const d = await doiTac();
      await db.affiliate.update({ where: { id: d.id }, data: { phone: "0900000000", email: "kin@example.test" } });
      const m = await them(c.id, d.id);
      if (m.ok && i === 0) await doi(m.id, "ACTIVE");
    }
    const trang1 = await docMembership({ campaignId: c.id, trangThai: null, trang: 1, kichThuoc: 2 });
    const trang2 = await docMembership({ campaignId: c.id, trangThai: null, trang: 2, kichThuoc: 2 });
    expect([trang1.tong, trang1.dong.length, trang2.dong.length]).toEqual([3, 2, 1]);
    expect((await docMembership({ campaignId: c.id, trangThai: "ACTIVE", trang: 1, kichThuoc: 10 })).tong).toBe(1);
    expect(JSON.stringify(trang1)).not.toMatch(/0900000000|kin@example/);
    const chon = await docDoiTacChoCampaign(c.id);
    expect(JSON.stringify(chon)).not.toMatch(/0900000000|kin@example/);
    expect(chon.doiTac.filter((x) => x.code.startsWith(P) && x.trongCampaign !== null)).toHaveLength(3);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[AFC-DB-09] xem trước nguồn & ô chọn — đọc thật", () => {
  it("ô chọn nguồn CHỈ có nguồn chọn được (không tạm ngừng, không tắt «chọn được»); UNKNOWN của hệ thống không có mặt", async () => {
    const [tot, ngung, khongChon] = await Promise.all([nguon(), nguon({ status: "INACTIVE" }), nguon({ selectable: false })]);
    const kq = await docLuaChonChoCampaign(NOW);
    const ids = new Set(kq.nguon.map((n) => n.id));
    expect(ids.has(tot.id)).toBe(true);
    expect(ids.has(ngung.id)).toBe(false);
    expect(ids.has(khongChon.id)).toBe(false);
    const khongTheChon = await db.leadSourceGroup.findMany({ where: { selectable: false }, select: { id: true } });
    for (const s of khongTheChon) expect(ids.has(s.id), "nguồn selectable=false (vd UNKNOWN) lọt vào ô chọn").toBe(false);
  });

  it("xem trước đi qua giaiNguonCuaDoiTac thật: quy tắc LOẠI+NHÃN thắng quy tắc loại; thêm đối tác khác loại ⇒ rơi về nguồn mặc định; thiếu cả ⇒ cần xem tay kèm lý do", async () => {
    const [nLoai, nCa, nMd, t, g, tKhac] = await Promise.all([nguon(), nguon(), nguon(), loai(), nhan(), loai()]);
    const c = await taoNhap({ defaultSourceGroupId: nMd.id });
    await themQuyTac({ nguoi: NGUOI, campaignId: c.id, vao: { typeId: t.id, tagId: null, sourceGroupId: nLoai.id }, lyDo: null, now: NOW });
    await themQuyTac({ nguoi: NGUOI, campaignId: c.id, vao: { typeId: t.id, tagId: g.id, sourceGroupId: nCa.id }, lyDo: null, now: NOW });
    const dt = await doiTac({ typeId: t.id });
    await db.affiliatePartyTag.create({ data: { partyId: dt.id, tagId: g.id } });
    const a = await docXemTruocNguon({ campaignId: c.id, partyId: dt.id, now: NOW });
    expect(a?.ketQua).toMatchObject({ loai: "NGUON", sourceGroupId: nCa.id, tu: "RULE_LOAI_VA_NHAN" });

    const dtKhac = await doiTac({ typeId: tKhac.id });
    expect((await docXemTruocNguon({ campaignId: c.id, partyId: dtKhac.id, now: NOW }))?.ketQua).toMatchObject({ sourceGroupId: nMd.id, tu: "MAC_DINH_CAMPAIGN" });

    const trong = await taoNhap();
    const r = await docXemTruocNguon({ campaignId: trong.id, partyId: dtKhac.id, now: NOW });
    expect(r?.ketQua.loai).toBe("XEM_TAY");
    expect(r?.doiTac.trongCampaign).toBeNull();
    expect(await docXemTruocNguon({ campaignId: c.id, partyId: "khong-co", now: NOW })).toBeNull();
  });
});
