// @vitest-environment node
/**
 * [AWS-*] WEBSITE + TRANG ĐÍCH AFFILIATE trên Postgres THẬT (AFF-P0b, docs/source-commission/12).
 *
 * Thứ chỉ DB mới chứng minh: transaction thật (cổng từ chối ⇒ KHÔNG dòng nào được ghi, kể cả audit), khoá lạc quan trên `updatedAt` mili-giây,
 * đua tạo cùng mã / cùng mẫu đường dẫn ra «đã có» chứ không ra lỗi 500, và CHECK của migration CHẶN THẬT khi đi vòng qua tầng ứng dụng bằng SQL trực tiếp
 * (Prisma không đọc CHECK nên drift không thấy; hàm ghi có thể bị sửa mất cổng mà CHECK vẫn là lưới cuối).
 *
 * Chạy: `DATABASE_URL=… DIRECT_URL=… pnpm exec vitest run -c vitest.db.config.ts tests/hoa-hong/affiliate-website.spec.ts`. `pnpm test:unit` trần sẽ SKIP.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dữ liệu mang tiền tố `FXAWS` và được dọn ĐẦU mỗi ca (mỗi ca tự dựng fixture — luật 18). Ngày TUYỆT ĐỐI (luật 19) — module này
 * không có logic thời gian nên không cần đồng hồ.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { docWebsite } from "../../lib/affiliate/doc-website";
import {
  batTatTrangDich,
  doiTrangThaiWebsite,
  suaTrangDich,
  suaWebsite,
  taoWebsite,
  themTrangDich,
  xoaWebsite,
} from "../../lib/affiliate/ghi-website";

if (!RUN_DB_TESTS) console.warn(`[AWS] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NGUOI = { userId: "fx-aws-user", ten: "Fixture AWS" };
const MA = "FXAWS";

async function don() {
  const sites = await db.affiliateSite.findMany({ where: { code: { startsWith: MA } }, select: { id: true } });
  const ids = sites.map((s) => s.id);
  await db.affiliateLandingPage.deleteMany({ where: { siteId: { in: ids } } });
  await db.affiliateCampaignSite.deleteMany({ where: { siteId: { in: ids } } });
  await db.affiliateSite.deleteMany({ where: { id: { in: ids } } });
  await db.affiliateCampaign.deleteMany({ where: { code: { startsWith: MA } } });
  await db.auditLog.deleteMany({ where: { actorName: NGUOI.ten } });
}

const vaoTao = (p: Record<string, unknown> = {}) => ({
  code: `${MA}_A`,
  name: "Quà tặng fixture",
  baseUrl: "https://fxaws-a.example.com",
  allowedDomains: ["fxaws-a.example.com"],
  trackingEnabled: true,
  defaultCampaignId: null,
  ...p,
});

async function taoOk(p: Record<string, unknown> = {}) {
  const kq = await taoWebsite({ nguoi: NGUOI, vao: vaoTao(p) });
  if (!kq.ok) throw new Error(`fixture website hỏng: ${kq.loi}`);
  const dong = await db.affiliateSite.findUniqueOrThrow({ where: { id: kq.id } });
  return { id: kq.id, dong };
}

async function taoCampaign(code: string, status: "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED") {
  return db.affiliateCampaign.create({ data: { code, name: `Campaign ${code}`, status } });
}

const demAudit = (entityType?: string) => db.auditLog.count({ where: { actorName: NGUOI.ten, ...(entityType ? { entityType } : {}) } });

describe.skipIf(!RUN_DB_TESTS)("[AWS] website + trang đích Affiliate", () => {
  beforeAll(don);
  beforeEach(don);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  // ── Tạo ────────────────────────────────────────────────────────────────────────────────────────────
  describe("[AWS-01..05] tạo website", () => {
    it("[AWS-01] tạo: chuẩn hoá gốc URL + tên miền, mặc định ACTIVE, audit CÙNG transaction", async () => {
      const kq = await taoWebsite({
        nguoi: NGUOI,
        vao: vaoTao({ baseUrl: "  https://FXAWS-A.example.com/ ", allowedDomains: ["FXAWS-A.example.com", " fxaws-a.example.com ", "www.fxaws-a.example.com"] }),
      });
      expect(kq.ok).toBe(true);
      const dong = await db.affiliateSite.findFirstOrThrow({ where: { code: `${MA}_A` } });
      expect(dong.baseUrl).toBe("https://fxaws-a.example.com");
      expect(dong.allowedDomains).toEqual(["fxaws-a.example.com", "www.fxaws-a.example.com"]); // hạ chữ thường + bỏ trùng + giữ thứ tự
      expect(dong.status).toBe("ACTIVE");
      expect(dong.trackingEnabled).toBe(true);
      expect(dong.createdById).toBe(NGUOI.userId);
      const audit = await db.auditLog.findMany({ where: { actorName: NGUOI.ten, entityType: "AffiliateSite", entityId: dong.id } });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe("AFFILIATE_WEBSITE_TAO");
      expect(audit[0]!.module).toBe("nguon-hoa-hong");
      expect(audit[0]!.reason).toContain(`${MA}_A`);
    });

    it("[AWS-02] tạo: host của gốc URL KHÔNG nằm trong tên miền được phép ⇒ từ chối cạnh ô baseUrl, KHÔNG dòng nào được ghi (kể cả audit)", async () => {
      const kq = await taoWebsite({ nguoi: NGUOI, vao: vaoTao({ baseUrl: "https://khac.example.com", allowedDomains: ["fxaws-a.example.com"] }) });
      expect(kq).toMatchObject({ ok: false, truong: "baseUrl" });
      expect(await db.affiliateSite.count({ where: { code: { startsWith: MA } } })).toBe(0);
      expect(await demAudit()).toBe(0);
    });

    it.each([
      ["http thay vì https", { baseUrl: "http://fxaws-a.example.com" }, "baseUrl"],
      ["gốc URL có đường dẫn", { baseUrl: "https://fxaws-a.example.com/lp" }, "baseUrl"],
      ["gốc URL có cổng", { baseUrl: "https://fxaws-a.example.com:8443" }, "baseUrl"],
      ["gốc URL có userinfo", { baseUrl: "https://evil.com@fxaws-a.example.com" }, "baseUrl"],
      ["gốc URL trống", { baseUrl: "" }, "baseUrl"],
      ["danh sách tên miền rỗng", { allowedDomains: [] }, "allowedDomains"],
      ["tên miền có scheme", { allowedDomains: ["https://fxaws-a.example.com"] }, "allowedDomains"],
      ["tên miền có đường dẫn", { allowedDomains: ["fxaws-a.example.com/khoa"] }, "allowedDomains"],
      ["tên miền ký tự đại diện", { allowedDomains: ["*.example.com", "fxaws-a.example.com"] }, "allowedDomains"],
      ["tên miền chữ có dấu", { allowedDomains: ["fxaws-à.example.com", "fxaws-a.example.com"] }, "allowedDomains"],
      ["tên miền một nhãn", { allowedDomains: ["localhost"] , baseUrl: "https://localhost" }, "allowedDomains"],
      ["quá nhiều tên miền", { allowedDomains: Array.from({ length: 21 }, (_, i) => `fxaws-${i}.example.com`) }, "allowedDomains"],
      ["mã quá ngắn", { code: "ab" }, "code"],
      ["tên quá ngắn", { name: "a" }, "name"],
      ["trường lạ (không tự thêm status)", { status: "INACTIVE" }, "chung"],
    ])("[AWS-03] tạo: %s ⇒ từ chối đúng ô, không ghi gì", async (_ten, patch, truong) => {
      const kq = await taoWebsite({ nguoi: NGUOI, vao: vaoTao(patch) });
      expect(kq.ok).toBe(false);
      if (!kq.ok) expect(kq.truong).toBe(truong);
      expect(await db.affiliateSite.count({ where: { code: { startsWith: MA } } })).toBe(0);
      expect(await demAudit()).toBe(0);
    });

    it("[AWS-04] tạo trùng mã ⇒ «đã có»; ĐUA hai lượt cùng mã ⇒ đúng MỘT thành công, người sau nhận «đã có» (không ném lỗi 500)", async () => {
      await taoOk();
      const trung = await taoWebsite({ nguoi: NGUOI, vao: vaoTao() });
      expect(trung).toMatchObject({ ok: false, truong: "code" });

      const ra = await Promise.all([
        taoWebsite({ nguoi: NGUOI, vao: vaoTao({ code: `${MA}_B`, baseUrl: "https://fxaws-b.example.com", allowedDomains: ["fxaws-b.example.com"] }) }),
        taoWebsite({ nguoi: NGUOI, vao: vaoTao({ code: `${MA}_B`, baseUrl: "https://fxaws-b.example.com", allowedDomains: ["fxaws-b.example.com"] }) }),
      ]);
      expect(ra.filter((r) => r.ok)).toHaveLength(1);
      const thua = ra.find((r) => !r.ok);
      expect(thua).toMatchObject({ ok: false, truong: "code" });
      expect(await db.affiliateSite.count({ where: { code: `${MA}_B` } })).toBe(1);
      // audit của lượt thua đã rollback cùng transaction: chỉ còn 2 dòng TAO (A và B), không dòng mồ côi.
      expect(await demAudit("AffiliateSite")).toBe(2);
    });

    it("[AWS-05] tạo: campaign mặc định phải tồn tại và CHƯA kết thúc; DRAFT/ACTIVE/PAUSED đều chọn được", async () => {
      const ended = await taoCampaign(`${MA}_C_END`, "ENDED");
      const draft = await taoCampaign(`${MA}_C_DRAFT`, "DRAFT");
      expect(await taoWebsite({ nguoi: NGUOI, vao: vaoTao({ defaultCampaignId: ended.id }) })).toMatchObject({ ok: false, truong: "defaultCampaignId" });
      expect(await taoWebsite({ nguoi: NGUOI, vao: vaoTao({ defaultCampaignId: "khong-ton-tai" }) })).toMatchObject({ ok: false, truong: "defaultCampaignId" });
      expect(await db.affiliateSite.count({ where: { code: { startsWith: MA } } })).toBe(0);
      const ok = await taoWebsite({ nguoi: NGUOI, vao: vaoTao({ defaultCampaignId: draft.id }) });
      expect(ok.ok).toBe(true);
      const dong = await db.affiliateSite.findFirstOrThrow({ where: { code: `${MA}_A` } });
      expect(dong.defaultCampaignId).toBe(draft.id);
    });
  });

  // ── Sửa ────────────────────────────────────────────────────────────────────────────────────────────
  describe("[AWS-06..08] sửa website", () => {
    it("[AWS-06] sửa tên: ghi đúng trường đổi, đẩy updatedAt, audit mang cũ → mới; KHÔNG đổi gì ⇒ doi=false và không audit", async () => {
      const { id, dong } = await taoOk();
      const truoc = await demAudit();
      const kq = await suaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, vao: { name: "Tên mới" }, lyDo: "Đổi tên theo thương hiệu mới" });
      expect(kq).toMatchObject({ ok: true, doi: true, truongDoi: ["name"] });
      const sau = await db.affiliateSite.findUniqueOrThrow({ where: { id } });
      expect(sau.name).toBe("Tên mới");
      expect(sau.updatedAt.getTime()).toBeGreaterThan(dong.updatedAt.getTime());
      const a = await db.auditLog.findFirstOrThrow({ where: { actorName: NGUOI.ten, entityId: id, action: "AFFILIATE_WEBSITE_SUA" } });
      expect(a.changedFields).toEqual(["name"]);
      expect(a.oldValues).toEqual({ name: "Quà tặng fixture" });
      expect(a.newValues).toEqual({ name: "Tên mới" });
      expect(a.reason).toBe("Đổi tên theo thương hiệu mới");
      expect(await demAudit()).toBe(truoc + 1);

      // biểu mẫu gửi lại mọi ô nguyên xi ⇒ không đổi gì
      const khongDoi = await suaWebsite({
        nguoi: NGUOI,
        id,
        updatedAtDaThay: sau.updatedAt,
        vao: { name: "Tên mới", baseUrl: sau.baseUrl, allowedDomains: sau.allowedDomains, trackingEnabled: true, defaultCampaignId: null },
        lyDo: null,
      });
      expect(khongDoi).toMatchObject({ ok: true, doi: false, truongDoi: [] });
      expect(await demAudit()).toBe(truoc + 1);
    });

    it("[AWS-06b] khoá lạc quan: `updatedAtDaThay` cũ ⇒ «vừa được người khác đổi», không ghi gì; ĐỐI CHỨNG mốc đúng ⇒ ghi được", async () => {
      const { id, dong } = await taoOk();
      await suaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, vao: { name: "Lượt một" }, lyDo: null });
      const truoc = await demAudit();
      const cu = await suaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, vao: { name: "Lượt hai (mốc cũ)" }, lyDo: null });
      expect(cu).toMatchObject({ ok: false, truong: "vuaDoi" });
      expect((await db.affiliateSite.findUniqueOrThrow({ where: { id } })).name).toBe("Lượt một");
      expect(await demAudit()).toBe(truoc);
      const moi = (await db.affiliateSite.findUniqueOrThrow({ where: { id } })).updatedAt;
      expect(await suaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: moi, vao: { name: "Lượt hai (mốc mới)" }, lyDo: null })).toMatchObject({ ok: true, doi: true });
    });

    it("[AWS-07] sửa: mã KHÔNG đổi được; gỡ tên miền của gốc URL / đổi gốc URL sang host lạ bị chặn trong transaction; không ghi gì", async () => {
      const { id, dong } = await taoOk({ allowedDomains: ["fxaws-a.example.com", "www.fxaws-a.example.com"] });
      const truoc = await demAudit();
      expect(await suaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, vao: { code: `${MA}_Z`, name: "x y" }, lyDo: null })).toMatchObject({ ok: false, truong: "code" });
      // gỡ tên miền đang là host của gốc URL
      expect(await suaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, vao: { allowedDomains: ["www.fxaws-a.example.com"] }, lyDo: null })).toMatchObject({
        ok: false,
        truong: "allowedDomains",
      });
      // đổi gốc URL sang host chưa khai
      expect(await suaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, vao: { baseUrl: "https://khac.example.com" }, lyDo: null })).toMatchObject({ ok: false, truong: "baseUrl" });
      // http
      expect(await suaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, vao: { baseUrl: "http://fxaws-a.example.com" }, lyDo: null })).toMatchObject({ ok: false, truong: "baseUrl" });
      const sau = await db.affiliateSite.findUniqueOrThrow({ where: { id } });
      expect(sau.allowedDomains).toEqual(["fxaws-a.example.com", "www.fxaws-a.example.com"]);
      expect(sau.baseUrl).toBe("https://fxaws-a.example.com");
      expect(await demAudit()).toBe(truoc);
      // đối chứng dương: đổi gốc URL sang tên miền thứ hai ĐÃ khai thì được
      expect(
        await suaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, vao: { baseUrl: "https://www.fxaws-a.example.com/" }, lyDo: null }),
      ).toMatchObject({ ok: true, doi: true, truongDoi: ["baseUrl"] });
    });

    it("[AWS-07b] sửa TÊN của website cũ mang gốc URL không còn đúng luật mới KHÔNG bị chặn oan (chỉ kiểm khi gốc URL/tên miền đổi)", async () => {
      const { id, dong } = await taoOk();
      // dữ liệu cũ nhập tay: gốc URL có đường dẫn — migration chỉ đòi https://…
      await db.$executeRaw`UPDATE "AffiliateSite" SET "baseUrl" = 'https://fxaws-a.example.com/lp' WHERE "id" = ${id}`;
      const hienTai = await db.affiliateSite.findUniqueOrThrow({ where: { id } });
      expect(hienTai.updatedAt.getTime()).toBe(dong.updatedAt.getTime()); // UPDATE thô không đụng updatedAt
      expect(await suaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: hienTai.updatedAt, vao: { name: "Chỉ đổi tên" }, lyDo: null })).toMatchObject({ ok: true, doi: true, truongDoi: ["name"] });
    });

    it("[AWS-08] sửa: campaign mặc định ĐÃ KẾT THÚC từ trước KHÔNG chặn việc sửa tên; ĐỔI sang campaign đã kết thúc thì bị chặn; gỡ về null được", async () => {
      const ended = await taoCampaign(`${MA}_C_END`, "ENDED");
      const ended2 = await taoCampaign(`${MA}_C_END2`, "ENDED");
      const draft = await taoCampaign(`${MA}_C_DRAFT`, "DRAFT");
      const { id, dong } = await taoOk({ defaultCampaignId: draft.id });
      await db.affiliateCampaign.update({ where: { id: draft.id }, data: { status: "ENDED" } }); // campaign kết thúc SAU khi đã làm mặc định
      expect(await suaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, vao: { name: "Sửa tên", defaultCampaignId: draft.id }, lyDo: null })).toMatchObject({ ok: true, doi: true, truongDoi: ["name"] });
      let moi = (await db.affiliateSite.findUniqueOrThrow({ where: { id } })).updatedAt;
      expect(await suaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: moi, vao: { defaultCampaignId: ended.id }, lyDo: null })).toMatchObject({ ok: false, truong: "defaultCampaignId" });
      expect(await suaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: moi, vao: { defaultCampaignId: ended2.id }, lyDo: null })).toMatchObject({ ok: false, truong: "defaultCampaignId" });
      expect((await db.affiliateSite.findUniqueOrThrow({ where: { id } })).defaultCampaignId).toBe(draft.id);
      expect(await suaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: moi, vao: { defaultCampaignId: null }, lyDo: null })).toMatchObject({ ok: true, truongDoi: ["defaultCampaignId"] });
      moi = (await db.affiliateSite.findUniqueOrThrow({ where: { id } })).updatedAt;
      expect((await db.affiliateSite.findUniqueOrThrow({ where: { id } })).defaultCampaignId).toBeNull();
      expect(moi.getTime()).toBeGreaterThan(dong.updatedAt.getTime());
    });
  });

  // ── Trạng thái ─────────────────────────────────────────────────────────────────────────────────────
  describe("[AWS-09] ngừng / bật lại website", () => {
    it("ngừng cần lý do ≥ 10 ký tự (9 ký tự bị từ chối, trạng thái KHÔNG đổi); bật lại không cần lý do; audit mang số campaign đang chạy", async () => {
      const { id, dong } = await taoOk();
      const chay = await taoCampaign(`${MA}_C_ACT`, "ACTIVE");
      const nhap = await taoCampaign(`${MA}_C_DRAFT`, "DRAFT");
      await db.affiliateCampaignSite.createMany({ data: [{ campaignId: chay.id, siteId: id }, { campaignId: nhap.id, siteId: id }] });
      const truoc = await demAudit();

      expect(await doiTrangThaiWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, den: "INACTIVE", lyDo: null })).toMatchObject({ ok: false, truong: "lyDo" });
      expect(await doiTrangThaiWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, den: "INACTIVE", lyDo: "123456789" })).toMatchObject({ ok: false, truong: "lyDo" });
      expect(await doiTrangThaiWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, den: "INACTIVE", lyDo: "          " })).toMatchObject({ ok: false, truong: "lyDo" });
      expect((await db.affiliateSite.findUniqueOrThrow({ where: { id } })).status).toBe("ACTIVE");
      expect(await demAudit()).toBe(truoc);

      const ngung = await doiTrangThaiWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, den: "INACTIVE", lyDo: "Đối tác dừng chương trình" });
      expect(ngung).toMatchObject({ ok: true, tu: "ACTIVE", den: "INACTIVE", campaignDangChay: 1 });
      expect((await db.affiliateSite.findUniqueOrThrow({ where: { id } })).status).toBe("INACTIVE");
      const a = await db.auditLog.findFirstOrThrow({ where: { actorName: NGUOI.ten, entityId: id, action: "AFFILIATE_WEBSITE_NGUNG" } });
      expect(a.reason).toBe("Đối tác dừng chương trình");
      expect(a.newValues).toMatchObject({ status: "INACTIVE", campaignDangChay: 1 });

      const moi = (await db.affiliateSite.findUniqueOrThrow({ where: { id } })).updatedAt;
      expect(await doiTrangThaiWebsite({ nguoi: NGUOI, id, updatedAtDaThay: moi, den: "INACTIVE", lyDo: "Ngừng lần hai không đổi gì" })).toMatchObject({ ok: false, truong: "trangThai" });
      expect(await doiTrangThaiWebsite({ nguoi: NGUOI, id, updatedAtDaThay: moi, den: "ACTIVE", lyDo: null })).toMatchObject({ ok: true, tu: "INACTIVE", den: "ACTIVE" });
      expect((await db.affiliateSite.findUniqueOrThrow({ where: { id } })).status).toBe("ACTIVE");
    });

    it("khoá lạc quan: mốc cũ ⇒ «vừa được người khác đổi», trạng thái không đổi", async () => {
      const { id, dong } = await taoOk();
      await suaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, vao: { name: "Đã đổi" }, lyDo: null });
      expect(await doiTrangThaiWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, den: "INACTIVE", lyDo: "Ngừng với mốc cũ đã thay" })).toMatchObject({ ok: false, truong: "vuaDoi" });
      expect((await db.affiliateSite.findUniqueOrThrow({ where: { id } })).status).toBe("ACTIVE");
    });
  });

  // ── Xoá ────────────────────────────────────────────────────────────────────────────────────────────
  describe("[AWS-10] xoá website", () => {
    it("xoá được CHỈ khi trống; có trang đích hoặc đã gắn campaign ⇒ từ chối và website CÒN NGUYÊN; thiếu lý do ⇒ từ chối", async () => {
      const trong = await taoOk({ code: `${MA}_T`, baseUrl: "https://fxaws-t.example.com", allowedDomains: ["fxaws-t.example.com"] });
      const coTrang = await taoOk({ code: `${MA}_P`, baseUrl: "https://fxaws-p.example.com", allowedDomains: ["fxaws-p.example.com"] });
      const coCamp = await taoOk({ code: `${MA}_G`, baseUrl: "https://fxaws-g.example.com", allowedDomains: ["fxaws-g.example.com"] });
      await themTrangDich({ nguoi: NGUOI, vao: { siteId: coTrang.id, pathPattern: "/khoa-hoc/*", label: null } });
      const camp = await taoCampaign(`${MA}_C_X`, "DRAFT");
      await db.affiliateCampaignSite.create({ data: { campaignId: camp.id, siteId: coCamp.id } });

      for (const x of [coTrang, coCamp]) {
        const hienTai = await db.affiliateSite.findUniqueOrThrow({ where: { id: x.id } });
        const kq = await xoaWebsite({ nguoi: NGUOI, id: x.id, updatedAtDaThay: hienTai.updatedAt, lyDo: "Tạo nhầm website này" });
        expect(kq).toMatchObject({ ok: false, truong: "xoa" });
        expect(await db.affiliateSite.count({ where: { id: x.id } })).toBe(1);
      }
      expect(await db.affiliateLandingPage.count({ where: { siteId: coTrang.id } })).toBe(1);
      expect(await db.affiliateCampaignSite.count({ where: { siteId: coCamp.id } })).toBe(1);

      expect(await xoaWebsite({ nguoi: NGUOI, id: trong.id, updatedAtDaThay: trong.dong.updatedAt, lyDo: null })).toMatchObject({ ok: false, truong: "lyDo" });
      expect(await xoaWebsite({ nguoi: NGUOI, id: trong.id, updatedAtDaThay: trong.dong.updatedAt, lyDo: "ngắn quá" })).toMatchObject({ ok: false, truong: "lyDo" });
      expect(await db.affiliateSite.count({ where: { id: trong.id } })).toBe(1);

      expect(await xoaWebsite({ nguoi: NGUOI, id: trong.id, updatedAtDaThay: trong.dong.updatedAt, lyDo: "Tạo nhầm, chưa dùng" })).toEqual({ ok: true });
      expect(await db.affiliateSite.count({ where: { id: trong.id } })).toBe(0);
      const a = await db.auditLog.findFirstOrThrow({ where: { actorName: NGUOI.ten, entityId: trong.id, action: "AFFILIATE_WEBSITE_XOA" } });
      expect(a.reason).toBe("Tạo nhầm, chưa dùng");
      expect(a.oldValues).toMatchObject({ code: `${MA}_T`, baseUrl: "https://fxaws-t.example.com" });
    });

    it("khoá lạc quan: mốc cũ ⇒ «vừa được người khác đổi», website còn nguyên; website không tồn tại ⇒ «không tìm thấy»", async () => {
      const { id, dong } = await taoOk();
      await suaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, vao: { name: "Đã đổi tên" }, lyDo: null });
      expect(await xoaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, lyDo: "Xoá với mốc đã cũ rồi" })).toMatchObject({ ok: false, truong: "vuaDoi" });
      expect(await db.affiliateSite.count({ where: { id } })).toBe(1);
      expect(await xoaWebsite({ nguoi: NGUOI, id: "khong-ton-tai", updatedAtDaThay: new Date(), lyDo: "Không có website này" })).toMatchObject({ ok: false, truong: "khongTimThay" });
    });

    it("ĐUA xoá ↔ thêm trang đích trên website trống: không bao giờ vừa xoá xong vừa có trang đích mồ côi; không ném lỗi", async () => {
      for (let i = 0; i < 4; i += 1) {
        await don();
        const { id, dong } = await taoOk();
        const [x, t] = await Promise.all([
          xoaWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, lyDo: "Đua xoá với thêm trang đích" }),
          themTrangDich({ nguoi: NGUOI, vao: { siteId: id, pathPattern: "/khoa-hoc/*", label: null } }),
        ]);
        const conSite = (await db.affiliateSite.count({ where: { id } })) === 1;
        const conTrang = await db.affiliateLandingPage.count({ where: { siteId: id } });
        if (conSite) {
          // xoá thua: hoặc bị từ chối vì đã có trang đích, hoặc ... (không có cách nào khác website còn mà xoá báo ok)
          expect(x.ok).toBe(false);
          expect(t.ok).toBe(true);
          expect(conTrang).toBe(1);
        } else {
          expect(x.ok).toBe(true);
          expect(t.ok).toBe(false);
          expect(conTrang).toBe(0);
        }
      }
    });
  });

  // ── Trang đích ─────────────────────────────────────────────────────────────────────────────────────
  describe("[AWS-11..12] trang đích", () => {
    it("[AWS-11] thêm: chuẩn hoá mẫu, mặc định BẬT, audit; trùng (kể cả khác dấu / cuối) ⇒ «đã có»; ĐUA ⇒ một thành công, người sau «đã có»", async () => {
      const { id } = await taoOk();
      const k1 = await themTrangDich({ nguoi: NGUOI, vao: { siteId: id, pathPattern: " /khoa-robotics/ ", label: "  Khoá Robotics  " } });
      expect(k1.ok).toBe(true);
      const d = await db.affiliateLandingPage.findFirstOrThrow({ where: { siteId: id } });
      expect(d).toMatchObject({ pathPattern: "/khoa-robotics", label: "Khoá Robotics", isActive: true, createdById: NGUOI.userId });
      expect(await db.auditLog.count({ where: { actorName: NGUOI.ten, entityType: "AffiliateLandingPage", action: "AFFILIATE_TRANG_DICH_THEM" } })).toBe(1);

      expect(await themTrangDich({ nguoi: NGUOI, vao: { siteId: id, pathPattern: "/khoa-robotics", label: null } })).toMatchObject({ ok: false, truong: "pathPattern" });
      const ra = await Promise.all([
        themTrangDich({ nguoi: NGUOI, vao: { siteId: id, pathPattern: "/khoa-hoc/*", label: null } }),
        themTrangDich({ nguoi: NGUOI, vao: { siteId: id, pathPattern: "/khoa-hoc/*", label: null } }),
      ]);
      expect(ra.filter((r) => r.ok)).toHaveLength(1);
      expect(ra.find((r) => !r.ok)).toMatchObject({ ok: false, truong: "pathPattern" });
      expect(await db.affiliateLandingPage.count({ where: { siteId: id } })).toBe(2);
      // audit của lượt thua đã rollback
      expect(await db.auditLog.count({ where: { actorName: NGUOI.ten, entityType: "AffiliateLandingPage", action: "AFFILIATE_TRANG_DICH_THEM" } })).toBe(2);
    });

    it.each([
      ["hai gạch chéo ở đầu", "//evil.com"],
      ["hai gạch chéo giữa", "/khoa-hoc//x"],
      ["đoạn ..", "/khoa-hoc/../admin"],
      ["đoạn . ", "/khoa-hoc/./x"],
      ["%2e mã hoá", "/khoa-hoc/%2e%2e/admin"],
      ["dấu cách", "/khoa hoc"],
      ["tab", "/khoa\thoc"],
      ["dấu ?", "/khoa-hoc?x=1"],
      ["dấu #", "/khoa-hoc#x"],
      ["* giữa đường dẫn", "/khoa-hoc/*/x"],
      ["* không sau /", "/khoa*"],
      ["không bắt đầu bằng /", "khoa-hoc"],
      ["scheme", "https://evil.com/x"],
      ["trống", ""],
    ])("[AWS-11b] thêm mẫu xấu: %s ⇒ từ chối cạnh ô đường dẫn, KHÔNG dòng nào được ghi", async (_ten, mau) => {
      const { id } = await taoOk();
      const truoc = await demAudit();
      const kq = await themTrangDich({ nguoi: NGUOI, vao: { siteId: id, pathPattern: mau, label: null } });
      expect(kq).toMatchObject({ ok: false, truong: "pathPattern" });
      expect(await db.affiliateLandingPage.count({ where: { siteId: id } })).toBe(0);
      expect(await demAudit()).toBe(truoc);
    });

    it("[AWS-11c] thêm vào website không tồn tại ⇒ «không tìm thấy»; website đã NGỪNG vẫn thêm được (chuẩn bị sẵn trước khi bật lại)", async () => {
      expect(await themTrangDich({ nguoi: NGUOI, vao: { siteId: "khong-ton-tai", pathPattern: "/x", label: null } })).toMatchObject({ ok: false, truong: "khongTimThay" });
      const { id, dong } = await taoOk();
      await doiTrangThaiWebsite({ nguoi: NGUOI, id, updatedAtDaThay: dong.updatedAt, den: "INACTIVE", lyDo: "Tạm dừng để chuẩn bị lại" });
      expect((await themTrangDich({ nguoi: NGUOI, vao: { siteId: id, pathPattern: "/x", label: null } })).ok).toBe(true);
    });

    it("[AWS-12] sửa trang đích: đổi mẫu / nhãn; trùng mẫu khác ⇒ «đã có»; mẫu xấu ⇒ từ chối; mốc cũ ⇒ vừa đổi; không đổi gì ⇒ không audit", async () => {
      const { id } = await taoOk();
      await themTrangDich({ nguoi: NGUOI, vao: { siteId: id, pathPattern: "/a", label: null } });
      await themTrangDich({ nguoi: NGUOI, vao: { siteId: id, pathPattern: "/b", label: null } });
      const a = await db.affiliateLandingPage.findFirstOrThrow({ where: { siteId: id, pathPattern: "/a" } });
      const truoc = await demAudit("AffiliateLandingPage");

      // Câu lỗi nêu CHÍNH mẫu trùng («/b» đã chuẩn hoá, không phải «/b/» người gõ): chỉ cổng kiểm-trước nói được vậy, lưới P2002 chỉ có câu chung.
      expect(await suaTrangDich({ nguoi: NGUOI, id: a.id, updatedAtDaThay: a.updatedAt, vao: { pathPattern: "/b/" }, lyDo: null })).toMatchObject({
        ok: false,
        truong: "pathPattern",
        loi: "Đường dẫn «/b» đã có ở website này.",
      });
      expect(await suaTrangDich({ nguoi: NGUOI, id: a.id, updatedAtDaThay: a.updatedAt, vao: { pathPattern: "/a/../b" }, lyDo: null })).toMatchObject({ ok: false, truong: "pathPattern" });
      expect((await db.affiliateLandingPage.findUniqueOrThrow({ where: { id: a.id } })).pathPattern).toBe("/a");
      expect(await demAudit("AffiliateLandingPage")).toBe(truoc);

      expect(await suaTrangDich({ nguoi: NGUOI, id: a.id, updatedAtDaThay: a.updatedAt, vao: { pathPattern: "/a", label: null }, lyDo: null })).toMatchObject({ ok: true });
      expect(await demAudit("AffiliateLandingPage")).toBe(truoc); // không đổi gì

      const k = await suaTrangDich({ nguoi: NGUOI, id: a.id, updatedAtDaThay: a.updatedAt, vao: { pathPattern: "/khoa-moi/*", label: "Khoá mới" }, lyDo: "Đổi đường dẫn sau khi đối tác dời trang" });
      expect(k.ok).toBe(true);
      const sau = await db.affiliateLandingPage.findUniqueOrThrow({ where: { id: a.id } });
      expect(sau).toMatchObject({ pathPattern: "/khoa-moi/*", label: "Khoá mới" });
      const au = await db.auditLog.findFirstOrThrow({ where: { actorName: NGUOI.ten, entityId: a.id, action: "AFFILIATE_TRANG_DICH_SUA" } });
      expect(au.oldValues).toEqual({ pathPattern: "/a", label: null });
      expect(au.changedFields.sort()).toEqual(["label", "pathPattern"]);

      expect(await suaTrangDich({ nguoi: NGUOI, id: a.id, updatedAtDaThay: a.updatedAt, vao: { label: "Mốc cũ" }, lyDo: null })).toMatchObject({ ok: false, truong: "vuaDoi" });
      expect(await suaTrangDich({ nguoi: NGUOI, id: "khong-ton-tai", updatedAtDaThay: new Date(), vao: { label: "x" }, lyDo: null })).toMatchObject({ ok: false, truong: "khongTimThay" });
    });

    it("[AWS-12b] bật/tắt trang đích: tắt rồi tắt lần nữa ⇒ từ chối; bật lại được; mốc cũ ⇒ vừa đổi; audit đủ hai chiều", async () => {
      const { id } = await taoOk();
      await themTrangDich({ nguoi: NGUOI, vao: { siteId: id, pathPattern: "/a", label: null } });
      const a = await db.affiliateLandingPage.findFirstOrThrow({ where: { siteId: id } });
      expect(await batTatTrangDich({ nguoi: NGUOI, id: a.id, updatedAtDaThay: a.updatedAt, den: true, lyDo: null })).toMatchObject({ ok: false, truong: "trangThai" });
      const tat = await batTatTrangDich({ nguoi: NGUOI, id: a.id, updatedAtDaThay: a.updatedAt, den: false, lyDo: "Đối tác gỡ trang này" });
      expect(tat).toMatchObject({ ok: true, den: false });
      expect((await db.affiliateLandingPage.findUniqueOrThrow({ where: { id: a.id } })).isActive).toBe(false);
      expect(await batTatTrangDich({ nguoi: NGUOI, id: a.id, updatedAtDaThay: a.updatedAt, den: true, lyDo: null })).toMatchObject({ ok: false, truong: "vuaDoi" });
      const moi = (await db.affiliateLandingPage.findUniqueOrThrow({ where: { id: a.id } })).updatedAt;
      expect(await batTatTrangDich({ nguoi: NGUOI, id: a.id, updatedAtDaThay: moi, den: true, lyDo: null })).toMatchObject({ ok: true, den: true });
      expect(await db.auditLog.count({ where: { actorName: NGUOI.ten, entityId: a.id, action: { in: ["AFFILIATE_TRANG_DICH_TAT", "AFFILIATE_TRANG_DICH_BAT"] } } })).toBe(2);
    });
  });

  // ── CHECK của migration ────────────────────────────────────────────────────────────────────────────
  describe("[AWS-13] CHECK của migration chặn THẬT khi đi vòng qua tầng ứng dụng (SQL trực tiếp)", () => {
    const chenSite = (p: { id: string; code: string; baseUrl: string; domains: string[] }) =>
      db.$executeRaw`INSERT INTO "AffiliateSite" ("id", "code", "name", "baseUrl", "allowedDomains", "updatedAt")
                     VALUES (${p.id}, ${p.code}, 'Fixture SQL', ${p.baseUrl}, ${p.domains}::text[], NOW())`;
    const chenTrang = (p: { id: string; siteId: string; mau: string }) =>
      db.$executeRaw`INSERT INTO "AffiliateLandingPage" ("id", "siteId", "pathPattern", "updatedAt") VALUES (${p.id}, ${p.siteId}, ${p.mau}, NOW())`;

    it("ĐỐI CHỨNG DƯƠNG: SQL hợp lệ chèn được (không phải SQL của test gõ hỏng mới ra «bị chặn»)", async () => {
      await chenSite({ id: "fxaws-sql-ok", code: `${MA}_SQL`, baseUrl: "https://fxaws-sql.example.com", domains: ["fxaws-sql.example.com"] });
      await chenTrang({ id: "fxaws-sql-ok-t1", siteId: "fxaws-sql-ok", mau: "/khoa-hoc/*" });
      await chenTrang({ id: "fxaws-sql-ok-t2", siteId: "fxaws-sql-ok", mau: "/khoa-robotics" });
      expect(await db.affiliateLandingPage.count({ where: { siteId: "fxaws-sql-ok" } })).toBe(2);
    });

    it.each([
      ["http thay vì https", { baseUrl: "http://fxaws-sql.example.com", domains: ["fxaws-sql.example.com"], code: `${MA}_S1` }, "AffiliateSite_base_url_chk"],
      ["không scheme", { baseUrl: "fxaws-sql.example.com", domains: ["fxaws-sql.example.com"], code: `${MA}_S2` }, "AffiliateSite_base_url_chk"],
      ["danh sách tên miền rỗng", { baseUrl: "https://fxaws-sql.example.com", domains: [] as string[], code: `${MA}_S3` }, "AffiliateSite_domains_chk"],
      ["tên miền viết HOA", { baseUrl: "https://fxaws-sql.example.com", domains: ["FXAWS-sql.example.com"], code: `${MA}_S4` }, "AffiliateSite_domains_chk"],
      ["tên miền có đường dẫn", { baseUrl: "https://fxaws-sql.example.com", domains: ["fxaws-sql.example.com/khoa"], code: `${MA}_S5` }, "AffiliateSite_domains_chk"],
      ["tên miền có dấu cách", { baseUrl: "https://fxaws-sql.example.com", domains: ["fxaws sql.example.com"], code: `${MA}_S6` }, "AffiliateSite_domains_chk"],
      ["tên miền có ký tự đại diện", { baseUrl: "https://fxaws-sql.example.com", domains: ["*.example.com"], code: `${MA}_S7` }, "AffiliateSite_domains_chk"],
      ["mã viết thường", { baseUrl: "https://fxaws-sql.example.com", domains: ["fxaws-sql.example.com"], code: "fxaws_s8" }, "AffiliateSite_code_chk"],
      ["mã quá ngắn", { baseUrl: "https://fxaws-sql.example.com", domains: ["fxaws-sql.example.com"], code: "AB" }, "AffiliateSite_code_chk"],
    ])("website: %s ⇒ CHECK từ chối", async (_ten, p, rang) => {
      await expect(chenSite({ id: "fxaws-sql-bad", code: p.code, baseUrl: p.baseUrl, domains: p.domains })).rejects.toThrow(new RegExp(rang));
      expect(await db.affiliateSite.count({ where: { id: "fxaws-sql-bad" } })).toBe(0);
    });

    it.each([
      ["không bắt đầu bằng /", "khoa-hoc"],
      ["dấu * ở GIỮA", "/khoa-hoc/*/x"],
      ["hai dấu *", "/khoa-hoc/**"],
      ["dấu cách", "/khoa hoc"],
      ["dấu ?", "/khoa-hoc?x=1"],
      ["dấu #", "/khoa-hoc#x"],
    ])("trang đích: %s ⇒ CHECK từ chối", async (_ten, mau) => {
      await chenSite({ id: "fxaws-sql-p", code: `${MA}_SP`, baseUrl: "https://fxaws-sql.example.com", domains: ["fxaws-sql.example.com"] });
      await expect(chenTrang({ id: "fxaws-sql-p-t", siteId: "fxaws-sql-p", mau })).rejects.toThrow(/AffiliateLandingPage_path_chk/);
      expect(await db.affiliateLandingPage.count({ where: { siteId: "fxaws-sql-p" } })).toBe(0);
    });

    it("trang đích trùng (website, mẫu) ⇒ ràng buộc duy nhất từ chối kể cả qua SQL", async () => {
      await chenSite({ id: "fxaws-sql-u", code: `${MA}_SU`, baseUrl: "https://fxaws-sql.example.com", domains: ["fxaws-sql.example.com"] });
      await chenTrang({ id: "fxaws-sql-u-1", siteId: "fxaws-sql-u", mau: "/a" });
      await expect(chenTrang({ id: "fxaws-sql-u-2", siteId: "fxaws-sql-u", mau: "/a" })).rejects.toThrow();
    });
  });

  // ── Đọc ────────────────────────────────────────────────────────────────────────────────────────────
  describe("[AWS-14] docWebsite", () => {
    it("trả website kèm trang đích, campaign đang gắn (chỉ đọc) và campaign mặc định ĐÃ KẾT THÚC vẫn hiện ở dòng nhưng KHÔNG nằm trong danh sách chọn", async () => {
      const draft = await taoCampaign(`${MA}_C_DRAFT`, "DRAFT");
      const ended = await taoCampaign(`${MA}_C_END`, "ENDED");
      const { id, dong } = await taoOk({ defaultCampaignId: draft.id });
      await themTrangDich({ nguoi: NGUOI, vao: { siteId: id, pathPattern: "/khoa-hoc/*", label: "Khoá học" } });
      await themTrangDich({ nguoi: NGUOI, vao: { siteId: id, pathPattern: "/khoa-robotics", label: null } });
      await db.affiliateCampaignSite.createMany({ data: [{ campaignId: draft.id, siteId: id }, { campaignId: ended.id, siteId: id }] });
      await db.affiliateCampaign.update({ where: { id: draft.id }, data: { status: "ENDED" } });

      const kq = await docWebsite();
      const d = kq.dong.find((x) => x.id === id);
      expect(d).toBeDefined();
      expect(d!.capNhatLuc).toBe(dong.updatedAt.toISOString());
      expect(d!.trangDich.map((t) => t.pathPattern)).toEqual(["/khoa-hoc/*", "/khoa-robotics"]);
      expect(d!.campaigns.map((c) => c.code)).toEqual([`${MA}_C_DRAFT`, `${MA}_C_END`]);
      expect(d!.defaultCampaign).toMatchObject({ id: draft.id, status: "ENDED" });
      expect(kq.campaignChon.map((c) => c.code)).not.toContain(`${MA}_C_END`);
      expect(kq.campaignChon.map((c) => c.code)).not.toContain(`${MA}_C_DRAFT`); // đã ENDED
      const moi = await taoCampaign(`${MA}_C_NEW`, "ACTIVE");
      expect((await docWebsite()).campaignChon.map((c) => c.id)).toContain(moi.id);
    });
  });
});
