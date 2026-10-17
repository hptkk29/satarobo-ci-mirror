// @vitest-environment node
/**
 * [AWL-*] LINK / QR / MÃ GIỚI THIỆU + ĐƯỜNG CÔNG KHAI trên Postgres THẬT (AFF-P1, docs/source-commission/12).
 *
 * Thứ chỉ DB mới chứng minh: transaction thật (cổng từ chối ⇒ KHÔNG dòng nào được ghi, kể cả audit), khoá hàng membership xếp hàng hai người phát đồng thời, vòng thử lại khi token đụng
 * khoá duy nhất CHẠY QUANH transaction (một câu lệnh lỗi làm Postgres huỷ cả transaction), xoay mã nguyên tử, và — quan trọng nhất — TRIGGER + CHECK của migration `affiliate_theo_doi`
 * CHẶN THẬT khi đi vòng qua tầng ứng dụng bằng SQL trực tiếp (Prisma không đọc CHECK/TRIGGER nên drift không thấy; hàm ghi có thể bị sửa mất cổng mà chúng vẫn là lưới cuối).
 *
 * Chạy: `DATABASE_URL=… DIRECT_URL=… pnpm exec vitest run -c vitest.db.config.ts tests/hoa-hong/affiliate-link.spec.ts`. `pnpm test:unit` trần sẽ SKIP.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dữ liệu mang tiền tố `FXAWL` và được dọn ĐẦU mỗi ca (mỗi ca tự dựng fixture — luật 18). `ReferralClick` có TRIGGER chỉ-thêm nên dọn nó phải tắt trigger
 * TRONG MỘT transaction rồi bật lại (DDL của Postgres có tính giao dịch) — chỉ ở hàm dọn của spec này. Ngày TUYỆT ĐỐI (luật 19): đồng hồ được TRUYỀN vào mọi hàm.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { docDanhSachLink, docTuyChonPhatLink } from "../../lib/affiliate/doc-link";
import { phatLink, thuHoiLink, xoayLink } from "../../lib/affiliate/ghi-link";
import { SO_LAN_THU_TOKEN, SO_LINK_HOAT_DONG_TOI_DA } from "../../lib/affiliate/ghi-link-dau-vao";
import { tinhSessionKey, xuLyBamLink, xuLyBeacon, type PhuThuoc } from "../../lib/affiliate/theo-doi-cong-khai";
import { sinhToken } from "../../lib/affiliate/token";

if (!RUN_DB_TESTS) console.warn(`[AWL] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NGUOI = { userId: "fx-awl-user", ten: "Fixture AWL" };
const MA = "FXAWL";
const NOW = new Date("2026-10-13T03:00:00.000Z");
/** Gốc link ngắn do CẤU HÌNH quyết (AFF-WEB) — hàm đọc nhận nó làm tham số, không tự đọc env, nên test truyền thẳng một gốc của môi trường test. */
const GOC_LINK_NGAN = "https://test.satarobo.vn";
/** Phạm vi ô chọn của QUẢN TRỊ: mọi đối tác, cả trang tiền tố. */
const TAT_CA = { partyIds: null, chiTrangChinhXac: false } as const;
const KHOA = "khoa-hmac-chi-dung-trong-spec-32-ky-tu!!";
const HOST = "fxawl-a.example.com";

async function don() {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`ALTER TABLE "ReferralClick" DISABLE TRIGGER "ReferralClick_chi_them"`;
    await tx.referralClick.deleteMany({ where: { asset: { party: { code: { startsWith: MA } } } } });
    await tx.$executeRaw`ALTER TABLE "ReferralClick" ENABLE TRIGGER "ReferralClick_chi_them"`;
  });
  await db.affiliateTrackingAsset.deleteMany({ where: { party: { code: { startsWith: MA } } } });
  await db.affiliateMembership.deleteMany({ where: { party: { code: { startsWith: MA } } } });
  const sites = await db.affiliateSite.findMany({ where: { code: { startsWith: MA } }, select: { id: true } });
  const ids = sites.map((s) => s.id);
  await db.affiliateLandingPage.deleteMany({ where: { siteId: { in: ids } } });
  await db.affiliateCampaignSite.deleteMany({ where: { siteId: { in: ids } } });
  await db.affiliateSite.deleteMany({ where: { id: { in: ids } } });
  await db.affiliateCampaign.deleteMany({ where: { code: { startsWith: MA } } });
  await db.affiliate.deleteMany({ where: { code: { startsWith: MA } } });
  await db.auditLog.deleteMany({ where: { actorName: NGUOI.ten } });
}

type Chuoi = { partyId: string; membershipId: string; campaignId: string; siteId: string; landingId: string };

/** Dựng chuỗi khoẻ: đối tác ACTIVE · campaign ACTIVE (cửa sổ cookie 45 ngày) · website ACTIVE gắn campaign · trang đích `/khoa-hoc/*` · membership ACTIVE. */
async function chuan(hau = "A", over: { campaign?: Record<string, unknown>; party?: Record<string, unknown>; membership?: Record<string, unknown>; site?: Record<string, unknown> } = {}): Promise<Chuoi> {
  const party = await db.affiliate.create({ data: { code: `${MA}_P${hau}`, name: `Đối tác ${hau}`, ...over.party } });
  const campaign = await db.affiliateCampaign.create({
    data: { code: `${MA}_C${hau}`, name: `Campaign ${hau}`, status: "ACTIVE", cookieWindowDays: 45, effectiveFrom: new Date("2026-10-01T00:00:00.000Z"), effectiveTo: new Date("2027-03-01T00:00:00.000Z"), ...over.campaign },
  });
  const site = await db.affiliateSite.create({
    data: { code: `${MA}_S${hau}`, name: `Website ${hau}`, baseUrl: `https://${hau.toLowerCase()}.${HOST}`, allowedDomains: [`${hau.toLowerCase()}.${HOST}`], status: "ACTIVE", trackingEnabled: true, ...over.site },
  });
  const landing = await db.affiliateLandingPage.create({ data: { siteId: site.id, pathPattern: "/khoa-hoc/*", label: "Khoá học" } });
  await db.affiliateCampaignSite.create({ data: { campaignId: campaign.id, siteId: site.id } });
  const membership = await db.affiliateMembership.create({
    data: { partyId: party.id, campaignId: campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-10-01T00:00:00.000Z"), ...over.membership },
  });
  return { partyId: party.id, membershipId: membership.id, campaignId: campaign.id, siteId: site.id, landingId: landing.id };
}

const vao = (c: Chuoi, p: Record<string, unknown> = {}) => ({ partyId: c.partyId, membershipId: c.membershipId, siteId: c.siteId, landingPath: "/khoa-hoc/robot", type: "LINK", label: null, ...p });
const phat = (c: Chuoi, p: Record<string, unknown> = {}, sinh?: () => string) => phatLink({ nguoi: NGUOI, vao: vao(c, p), now: NOW, sinh });
const demAsset = (c: Chuoi) => db.affiliateTrackingAsset.count({ where: { membershipId: c.membershipId } });
const demAudit = () => db.auditLog.count({ where: { actorName: NGUOI.ten } });
const tokenGia = (i: number) => `AAAAAAAA${String(i).padStart(2, "0")}`;

async function phatOk(c: Chuoi, p: Record<string, unknown> = {}) {
  const kq = await phat(c, p);
  if (!kq.ok) throw new Error(`fixture link hỏng: ${kq.loi}`);
  return kq;
}

describe.skipIf(!RUN_DB_TESTS)("[AWL] link / QR / mã giới thiệu + đường công khai", () => {
  beforeAll(don);
  beforeEach(don);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  // ── Phát ───────────────────────────────────────────────────────────────────────────────────────────
  describe("[AWL-01..06] phát link", () => {
    it("[AWL-01] phát: token đúng định dạng, ghi người tạo, audit CÙNG transaction và KHÔNG chứa token đầy đủ", async () => {
      const c = await chuan();
      const kq = await phat(c, { label: "  Poster  ", type: "QR" });
      expect(kq.ok).toBe(true);
      if (!kq.ok) return;
      expect(kq.token).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
      const dong = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: kq.id } });
      expect(dong).toMatchObject({ partyId: c.partyId, membershipId: c.membershipId, campaignId: c.campaignId, siteId: c.siteId, landingPath: "/khoa-hoc/robot", type: "QR", label: "Poster", status: "ACTIVE", createdById: NGUOI.userId });
      expect(dong.publicToken).toBe(kq.token);
      const audit = await db.auditLog.findMany({ where: { actorName: NGUOI.ten, entityType: "AffiliateTrackingAsset", entityId: kq.id } });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe("AFFILIATE_LINK_PHAT");
      expect(audit[0]!.module).toBe("nguon-hoa-hong");
      expect(JSON.stringify(audit[0])).not.toContain(kq.token);
    });

    it("[AWL-02] membership của đối tác KHÁC ⇒ từ chối cạnh ô membershipId, KHÔNG ghi gì", async () => {
      const a = await chuan("A");
      const b = await chuan("B");
      const kq = await phat(a, { membershipId: b.membershipId });
      expect(kq).toMatchObject({ ok: false, truong: "membershipId" });
      expect(await db.affiliateTrackingAsset.count({ where: { party: { code: { startsWith: MA } } } })).toBe(0);
      expect(await demAudit()).toBe(0);
    });

    it("[AWL-03] website KHÔNG gắn campaign của chương trình ⇒ từ chối cạnh ô siteId; đối chứng dương: gắn vào ⇒ phát được", async () => {
      const a = await chuan("A");
      const b = await chuan("B");
      const kq = await phat(a, { siteId: b.siteId });
      expect(kq).toMatchObject({ ok: false, truong: "siteId" });
      expect(await demAsset(a)).toBe(0);
      await db.affiliateCampaignSite.create({ data: { campaignId: a.campaignId, siteId: b.siteId } });
      expect((await phat(a, { siteId: b.siteId })).ok).toBe(true);
    });

    it("[AWL-04] trang đích: ngoài mẫu / trang bị tắt ⇒ từ chối cạnh ô landingPath; tiền tố cụ thể ⇒ phát được", async () => {
      const c = await chuan();
      expect(await phat(c, { landingPath: "/admin" })).toMatchObject({ ok: false, truong: "landingPath" });
      expect(await phat(c, { landingPath: "/khoa-hoc/../admin" })).toMatchObject({ ok: false, truong: "landingPath" });
      expect(await phat(c, { landingPath: "/khoa-hoc/robot?x=1" })).toMatchObject({ ok: false, truong: "landingPath" });
      expect(await phat(c, { landingPath: "//evil.com" })).toMatchObject({ ok: false, truong: "landingPath" });
      expect((await phat(c, { landingPath: "/khoa-hoc/robot-nang-cao" })).ok).toBe(true);
      await db.affiliateLandingPage.update({ where: { id: c.landingId }, data: { isActive: false } });
      expect(await phat(c)).toMatchObject({ ok: false, truong: "landingPath" });
      expect(await demAsset(c)).toBe(1);
    });

    it.each([
      ["campaign tạm dừng", { campaign: { status: "PAUSED" } }],
      ["campaign chưa tới ngày", { campaign: { effectiveFrom: new Date("2026-11-01T00:00:00.000Z") } }],
      ["campaign hết hạn", { campaign: { effectiveTo: new Date("2026-10-13T03:00:00.000Z") } }],
      ["đối tác bị tạm dừng", { party: { status: "SUSPENDED" } }],
      ["membership chờ duyệt", { membership: { status: "PENDING" } }],
      ["membership hết hạn", { membership: { effectiveTo: new Date("2026-10-12T00:00:00.000Z") } }],
      ["website ngừng", { site: { status: "INACTIVE" } }],
      ["website tắt theo dõi", { site: { trackingEnabled: false } }],
    ] as const)("[AWL-05] chuỗi hỏng: %s ⇒ từ chối bằng CHÍNH kiemLienKet, không ghi gì", async (_ten, over) => {
      const c = await chuan("A", over as never);
      const kq = await phat(c);
      expect(kq.ok).toBe(false);
      expect(await demAsset(c)).toBe(0);
      expect(await demAudit()).toBe(0);
    });

    it(`[AWL-06] hạn mức ${SO_LINK_HOAT_DONG_TOI_DA} link đang chạy / (đối tác × campaign): đủ ⇒ từ chối; thu hồi bớt ⇒ phát được`, async () => {
      const c = await chuan();
      await db.affiliateTrackingAsset.createMany({
        data: Array.from({ length: SO_LINK_HOAT_DONG_TOI_DA }, (_, i) => ({
          partyId: c.partyId,
          membershipId: c.membershipId,
          campaignId: c.campaignId,
          siteId: c.siteId,
          landingPath: "/khoa-hoc/robot",
          publicToken: tokenGia(i),
        })),
      });
      const day = await phat(c);
      expect(day.ok).toBe(false);
      expect(!day.ok && day.loi).toContain(String(SO_LINK_HOAT_DONG_TOI_DA));
      // Thu hồi một ⇒ phát lại được.
      const mot = await db.affiliateTrackingAsset.findFirstOrThrow({ where: { membershipId: c.membershipId, publicToken: tokenGia(0) } });
      const th = await thuHoiLink({ nguoi: NGUOI, id: mot.id, updatedAtDaThay: mot.updatedAt, lyDo: "Không dùng nữa nên thu hồi", now: NOW });
      expect(th.ok).toBe(true);
      expect((await phat(c)).ok).toBe(true);
    });

    it(`[AWL-06b] hậu quả cuối: BA người phát đồng thời khi còn đúng 2 chỗ trống ⇒ đúng 2 thành công, tổng ACTIVE không vượt ${SO_LINK_HOAT_DONG_TOI_DA}. (Chỉ kiểm KẾT QUẢ — không chứng minh khoá; việc đó là của [AWL-06c]. Cố ý chỉ 3 luồng để không chạm trần pool 5 kết nối của lib/db.ts trên runner ít CPU.)`, async () => {
      const c = await chuan();
      await db.affiliateTrackingAsset.createMany({
        data: Array.from({ length: SO_LINK_HOAT_DONG_TOI_DA - 2 }, (_, i) => ({
          partyId: c.partyId,
          membershipId: c.membershipId,
          campaignId: c.campaignId,
          siteId: c.siteId,
          landingPath: "/khoa-hoc/robot",
          publicToken: tokenGia(i),
        })),
      });
      const ra = await Promise.all([phat(c), phat(c), phat(c)]);
      expect(ra.filter((r) => r.ok)).toHaveLength(2);
      expect(await db.affiliateTrackingAsset.count({ where: { membershipId: c.membershipId, status: "ACTIVE" } })).toBe(SO_LINK_HOAT_DONG_TOI_DA);
    });

    it("[AWL-06c] KHOÁ HÀNG MEMBERSHIP có thật: khi một transaction khác đang giữ `FOR SHARE` trên membership, phatLink PHẢI chờ (nó cần `FOR UPDATE`); nhả khoá ⇒ phát xong. Dùng FOR SHARE chứ không FOR UPDATE: INSERT link kéo theo kiểm FK = `FOR KEY SHARE` trên membership, xung đột với FOR UPDATE nên phatLink sẽ chờ DÙ CÓ HAY KHÔNG có khoá của chính nó — đo 14/10: gỡ khoá mà dùng FOR UPDATE vẫn xanh. Ca đua tự nhiên [AWL-06b] cũng KHÔNG phân biệt được (Postgres cục bộ quá nhanh).", async () => {
      const c = await chuan();
      let ketQua: Promise<Awaited<ReturnType<typeof phat>>> | null = null;
      const trangThaiLuc = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "AffiliateMembership" WHERE "id" = ${c.membershipId} FOR SHARE`;
        ketQua = phat(c);
        return await Promise.race([ketQua.then(() => "xong"), new Promise<string>((r) => setTimeout(() => r("cho"), 600))]);
      });
      expect(trangThaiLuc).toBe("cho");
      expect((await ketQua!).ok).toBe(true);
      expect(await demAsset(c)).toBe(1);
    });
  });

  // ── Token đụng khoá ────────────────────────────────────────────────────────────────────────────────
  describe("[AWL-07] token đụng khoá duy nhất", () => {
    it("đụng 2 lần rồi gặp token mới ⇒ thành công ở lần thứ 3, đúng MỘT dòng mới", async () => {
      const c = await chuan();
      const cu = await phatOk(c);
      const dang = [cu.token, cu.token, "BBBBBBBBBB"];
      let goi = 0;
      const kq = await phat(c, {}, () => dang[goi++]!);
      expect(kq.ok).toBe(true);
      expect(goi).toBe(3);
      expect(kq.ok && kq.token).toBe("BBBBBBBBBB");
      expect(await demAsset(c)).toBe(2);
    });

    it(`đụng mãi ⇒ DỪNG đúng ${SO_LAN_THU_TOKEN} lần (không vòng vô hạn), báo lỗi, không dòng mới, không audit của lần thất bại`, async () => {
      const c = await chuan();
      const cu = await phatOk(c);
      const auditTruoc = await demAudit();
      let goi = 0;
      const kq = await phat(c, {}, () => {
        goi += 1;
        return cu.token;
      });
      expect(kq).toMatchObject({ ok: false });
      expect(goi).toBe(SO_LAN_THU_TOKEN);
      expect(await demAsset(c)).toBe(1);
      expect(await demAudit()).toBe(auditTruoc);
    });
  });

  // ── Thu hồi ────────────────────────────────────────────────────────────────────────────────────────
  describe("[AWL-08] thu hồi", () => {
    it("lý do 9 ký tự ⇒ từ chối cạnh ô lyDo, link vẫn ACTIVE; đủ 10 ⇒ REVOKED + mốc + người + lý do + audit", async () => {
      const c = await chuan();
      const l = await phatOk(c);
      const truoc = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } });
      const ngan = await thuHoiLink({ nguoi: NGUOI, id: l.id, updatedAtDaThay: truoc.updatedAt, lyDo: "123456789", now: NOW });
      expect(ngan).toMatchObject({ ok: false, truong: "lyDo" });
      expect((await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } })).status).toBe("ACTIVE");

      const ok = await thuHoiLink({ nguoi: NGUOI, id: l.id, updatedAtDaThay: truoc.updatedAt, lyDo: "  Poster đã gỡ khỏi hội chợ  ", now: NOW });
      expect(ok.ok).toBe(true);
      const sau = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } });
      expect(sau).toMatchObject({ status: "REVOKED", revokedById: NGUOI.userId, revokedReason: "Poster đã gỡ khỏi hội chợ" });
      expect(sau.revokedAt?.getTime()).toBe(NOW.getTime());
      const audit = await db.auditLog.findMany({ where: { actorName: NGUOI.ten, entityId: l.id, action: "AFFILIATE_LINK_THU_HOI" } });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.reason).toBe("Poster đã gỡ khỏi hội chợ");
    });

    it("thu hồi lần hai ⇒ từ chối; khoá lạc quan: mốc cũ ⇒ vuaDoi, link không đổi", async () => {
      const c = await chuan();
      const l = await phatOk(c);
      const t = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } });
      await db.affiliateTrackingAsset.update({ where: { id: l.id }, data: { label: "đã sửa nhãn" } });
      const cu = await thuHoiLink({ nguoi: NGUOI, id: l.id, updatedAtDaThay: t.updatedAt, lyDo: "Một lý do đủ dài để thu hồi", now: NOW });
      expect(cu).toMatchObject({ ok: false, truong: "vuaDoi" });
      expect((await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } })).status).toBe("ACTIVE");

      const moi = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } });
      expect((await thuHoiLink({ nguoi: NGUOI, id: l.id, updatedAtDaThay: moi.updatedAt, lyDo: "Một lý do đủ dài để thu hồi", now: NOW })).ok).toBe(true);
      const hai = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } });
      expect(await thuHoiLink({ nguoi: NGUOI, id: l.id, updatedAtDaThay: hai.updatedAt, lyDo: "Một lý do đủ dài để thu hồi", now: NOW })).toMatchObject({ ok: false, truong: "trangThai" });
    });

    it("link không tồn tại ⇒ khongTimThay, không ném", async () => {
      expect(await thuHoiLink({ nguoi: NGUOI, id: "khong-co", updatedAtDaThay: NOW, lyDo: "Một lý do đủ dài để thu hồi", now: NOW })).toMatchObject({ ok: false, truong: "khongTimThay" });
    });
  });

  // ── Xoay ───────────────────────────────────────────────────────────────────────────────────────────
  describe("[AWL-09] xoay mã", () => {
    it("thu hồi cũ + phát mới CÙNG định danh, rotatedFromId trỏ về cũ, hai audit, token khác", async () => {
      const c = await chuan();
      const l = await phatOk(c, { type: "QR", label: "Biển quảng cáo" });
      const cu0 = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } });
      const kq = await xoayLink({ nguoi: NGUOI, id: l.id, updatedAtDaThay: cu0.updatedAt, lyDo: "Biển bị chụp ảnh lan truyền", now: NOW });
      expect(kq.ok).toBe(true);
      if (!kq.ok) return;
      const cu = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } });
      const moi = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: kq.id } });
      expect(cu).toMatchObject({ status: "REVOKED", revokedReason: "Xoay mã: Biển bị chụp ảnh lan truyền" });
      expect(moi).toMatchObject({ status: "ACTIVE", rotatedFromId: l.id, partyId: cu.partyId, membershipId: cu.membershipId, campaignId: cu.campaignId, siteId: cu.siteId, landingPath: cu.landingPath, type: "QR", label: "Biển quảng cáo" });
      expect(moi.publicToken).not.toBe(cu.publicToken);
      expect(kq.thuHoiId).toBe(l.id);
      const audit = await db.auditLog.findMany({ where: { actorName: NGUOI.ten, action: { in: ["AFFILIATE_LINK_THU_HOI", "AFFILIATE_LINK_XOAY"] } } });
      expect(audit.map((a) => a.action).sort()).toEqual(["AFFILIATE_LINK_THU_HOI", "AFFILIATE_LINK_XOAY"]);
      expect(JSON.stringify(audit)).not.toContain(cu.publicToken);
      expect(JSON.stringify(audit)).not.toContain(moi.publicToken);
    });

    it("NGUYÊN TỬ: token mới đụng khoá mãi ⇒ link cũ VẪN ACTIVE (rollback), không dòng mới", async () => {
      const c = await chuan();
      const l = await phatOk(c);
      const t = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } });
      const kq = await xoayLink({ nguoi: NGUOI, id: l.id, updatedAtDaThay: t.updatedAt, lyDo: "Một lý do đủ dài để xoay", now: NOW, sinh: () => l.token });
      expect(kq.ok).toBe(false);
      expect((await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } })).status).toBe("ACTIVE");
      expect(await demAsset(c)).toBe(1);
    });

    it("chuỗi đã hỏng (campaign tạm dừng) ⇒ KHÔNG xoay (không đẻ link chết); link cũ vẫn ACTIVE; thu hồi vẫn làm được", async () => {
      const c = await chuan();
      const l = await phatOk(c);
      await db.affiliateCampaign.update({ where: { id: c.campaignId }, data: { status: "PAUSED" } });
      const t = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } });
      const kq = await xoayLink({ nguoi: NGUOI, id: l.id, updatedAtDaThay: t.updatedAt, lyDo: "Một lý do đủ dài để xoay", now: NOW });
      expect(kq).toMatchObject({ ok: false });
      expect(await demAsset(c)).toBe(1);
      expect((await thuHoiLink({ nguoi: NGUOI, id: l.id, updatedAtDaThay: t.updatedAt, lyDo: "Campaign tạm dừng nên thu hồi", now: NOW })).ok).toBe(true);
    });

    it("xoay KHÔNG bị hạn mức chặn (đủ N link vẫn xoay được)", async () => {
      const c = await chuan();
      await db.affiliateTrackingAsset.createMany({
        data: Array.from({ length: SO_LINK_HOAT_DONG_TOI_DA - 1 }, (_, i) => ({ partyId: c.partyId, membershipId: c.membershipId, campaignId: c.campaignId, siteId: c.siteId, landingPath: "/khoa-hoc/robot", publicToken: tokenGia(i) })),
      });
      const l = await phatOk(c);
      expect(await db.affiliateTrackingAsset.count({ where: { membershipId: c.membershipId, status: "ACTIVE" } })).toBe(SO_LINK_HOAT_DONG_TOI_DA);
      const t = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } });
      expect((await xoayLink({ nguoi: NGUOI, id: l.id, updatedAtDaThay: t.updatedAt, lyDo: "Một lý do đủ dài để xoay", now: NOW })).ok).toBe(true);
      expect(await db.affiliateTrackingAsset.count({ where: { membershipId: c.membershipId, status: "ACTIVE" } })).toBe(SO_LINK_HOAT_DONG_TOI_DA);
    });

    it("khoá lạc quan: xoay với mốc CŨ (link vừa được sửa) ⇒ vuaDoi, link không đổi, không dòng mới", async () => {
      const c = await chuan();
      const l = await phatOk(c);
      const t = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } });
      await db.affiliateTrackingAsset.update({ where: { id: l.id }, data: { label: "đã sửa nhãn" } });
      expect(await xoayLink({ nguoi: NGUOI, id: l.id, updatedAtDaThay: t.updatedAt, lyDo: "Một lý do đủ dài để xoay", now: NOW })).toMatchObject({ ok: false, truong: "vuaDoi" });
      expect((await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } })).status).toBe("ACTIVE");
      expect(await demAsset(c)).toBe(1);
    });

    it("lý do ngắn / mốc cũ / hai người xoay đồng thời ⇒ đúng MỘT thành công, đúng MỘT link ACTIVE kế thừa", async () => {
      const c = await chuan();
      const l = await phatOk(c);
      const t = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } });
      expect(await xoayLink({ nguoi: NGUOI, id: l.id, updatedAtDaThay: t.updatedAt, lyDo: "ngắn", now: NOW })).toMatchObject({ ok: false, truong: "lyDo" });
      const ra = await Promise.all([
        xoayLink({ nguoi: NGUOI, id: l.id, updatedAtDaThay: t.updatedAt, lyDo: "Hai người cùng bấm xoay mã", now: NOW }),
        xoayLink({ nguoi: NGUOI, id: l.id, updatedAtDaThay: t.updatedAt, lyDo: "Hai người cùng bấm xoay mã", now: NOW }),
      ]);
      expect(ra.filter((r) => r.ok)).toHaveLength(1);
      expect(await db.affiliateTrackingAsset.count({ where: { membershipId: c.membershipId, status: "ACTIVE" } })).toBe(1);
      expect(await demAsset(c)).toBe(2);
    });
  });

  // ── Đọc ────────────────────────────────────────────────────────────────────────────────────────────
  describe("[AWL-10..12] đọc", () => {
    const loc = (p: Record<string, unknown> = {}) => ({ trang: 1, kichThuoc: 25, trangThai: null, campaignMa: null, doiTacMa: null, coTheXemDayDu: true, gocLinkNgan: GOC_LINK_NGAN, chiDemLuotDaChot: false, now: NOW, ...p }) as Parameters<typeof docDanhSachLink>[0];

    it("[AWL-10] người chỉ XEM: payload KHÔNG chứa token đầy đủ nào, không URL dựng sẵn; người quản lý nhận đủ", async () => {
      const c = await chuan();
      const l1 = await phatOk(c);
      const l2 = await phatOk(c, { landingPath: "/khoa-hoc/b" });
      const xem = await docDanhSachLink(loc({ coTheXemDayDu: false }));
      const json = JSON.stringify(xem);
      expect(json).not.toContain(l1.token);
      expect(json).not.toContain(l2.token);
      expect(json).not.toMatch(/\/r\/|aff=/);
      expect(json).not.toMatch(/"[0-9A-HJKMNP-TV-Z]{10}"/); // không có chuỗi nào có DẠNG một token đầy đủ
      expect(xem.dong.every((d) => d.token.endsWith("…") && d.token.length === 5 && d.lienKetNgan === null && d.lienKetTrucTiep === null)).toBe(true);
      // URL cuối của người chỉ xem là địa chỉ SẠCH (trang đích, KHÔNG token) — vẫn có để họ thấy khách đến đâu; người quản lý nhận bản kèm ?aff=&cmp=
      expect(xem.dong.every((d) => d.urlCuoi !== null && !d.urlCuoi.includes("aff=") && d.urlCuoi.startsWith("https://"))).toBe(true);
      const quanLy = await docDanhSachLink(loc());
      const tok = quanLy.dong.map((d) => d.token).sort();
      expect(tok).toEqual([l1.token, l2.token].sort());
      const d1 = quanLy.dong.find((d) => d.token === l1.token)!;
      expect(d1.lienKetNgan).toBe(`${GOC_LINK_NGAN}/r/${l1.token}`);
      expect(d1.urlCuoi).toBe(d1.lienKetTrucTiep); // URL cuối của người quản lý = link trực tiếp (kèm ?aff=&cmp=)
      expect(d1.soReferral).toBe(0);
      // gốc chưa cấu hình (null) ⇒ KHÔNG dựng link ngắn (không đoán), link trực tiếp vẫn có
      const khongGoc = await docDanhSachLink(loc({ gocLinkNgan: null }));
      const k1 = khongGoc.dong.find((d) => d.token === l1.token)!;
      expect([k1.lienKetNgan, k1.lienKetTrucTiep === d1.lienKetTrucTiep]).toEqual([null, true]);
      expect(d1.lienKetTrucTiep).toBe(`https://a.${HOST}/khoa-hoc/robot?aff=${l1.token}&cmp=${MA}_CA`);
    });

    it("[AWL-11] đếm lượt bấm bằng MỘT câu GROUP BY: OK và không hợp lệ tách riêng; lọc trạng thái/campaign/đối tác; phân trang; lý do không dùng được", async () => {
      const a = await chuan("A");
      const b = await chuan("B");
      const la = await phatOk(a);
      const lb = await phatOk(b);
      await db.referralClick.createMany({
        data: [
          { assetId: la.id, campaignId: a.campaignId, partyId: a.partyId, outcome: "OK" },
          { assetId: la.id, campaignId: a.campaignId, partyId: a.partyId, outcome: "OK" },
          { assetId: la.id, campaignId: a.campaignId, partyId: a.partyId, outcome: "LINK_DA_THU_HOI" },
          { assetId: lb.id, campaignId: b.campaignId, partyId: b.partyId, outcome: "OK" },
        ],
      });
      const tat = await docDanhSachLink(loc());
      const da = tat.dong.find((d) => d.token === la.token)!;
      const dbb = tat.dong.find((d) => d.token === lb.token)!;
      expect([da.soLuotBam, da.soLuotBamLoi, dbb.soLuotBam, dbb.soLuotBamLoi]).toEqual([2, 1, 1, 0]);
      expect((await docDanhSachLink(loc({ campaignMa: `${MA}_CA` }))).dong.map((d) => d.token)).toEqual([la.token]);
      expect((await docDanhSachLink(loc({ doiTacMa: `${MA}_PB` }))).dong.map((d) => d.token)).toEqual([lb.token]);
      const trang1 = await docDanhSachLink(loc({ kichThuoc: 1 }));
      expect([trang1.tong, trang1.dong.length]).toEqual([2, 1]);

      await db.affiliateCampaign.update({ where: { id: a.campaignId }, data: { status: "PAUSED" } });
      const sau = await docDanhSachLink(loc());
      expect(sau.dong.find((d) => d.token === la.token)!.lyDoKhongDung).toBe("Campaign không ở trạng thái đang chạy.");
      expect(sau.dong.find((d) => d.token === lb.token)!.lyDoKhongDung).toBeNull();

      const t = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: lb.id } });
      await thuHoiLink({ nguoi: NGUOI, id: lb.id, updatedAtDaThay: t.updatedAt, lyDo: "Một lý do đủ dài để thu hồi", now: NOW });
      const loc2 = await docDanhSachLink(loc({ trangThai: "REVOKED" }));
      expect(loc2.dong.map((d) => d.token)).toEqual([lb.token]);
      expect(loc2.dong[0]!.lienKetNgan).toBeNull();
      expect(loc2.theoTrangThai).toEqual({ ACTIVE: 1, REVOKED: 1 });
    });

    it("[AWL-12] tuỳ chọn «Phát link»: chỉ đối tác ACTIVE × membership ACTIVE × campaign ACTIVE × website dùng được × TRONG CỬA SỔ NGÀY; chẩn đoán đếm đúng", async () => {
      const ok = await chuan("A");
      await chuan("B", { campaign: { status: "PAUSED" } });
      await chuan("C", { party: { status: "SUSPENDED" } });
      await chuan("D", { site: { trackingEnabled: false } });
      await chuan("E", { campaign: { effectiveFrom: new Date("2026-11-01T00:00:00.000Z") } }); // campaign ACTIVE nhưng CHƯA tới ngày
      await chuan("F", { campaign: { effectiveTo: new Date("2026-10-13T03:00:00.000Z") } }); // campaign ACTIVE nhưng ĐÃ hết hạn (biên trên MỞ: to = now ⇒ hết)
      await chuan("G", { membership: { effectiveTo: new Date("2026-10-12T00:00:00.000Z") } }); // membership ACTIVE nhưng hết hạn
      await chuan("H", { membership: { effectiveFrom: new Date("2026-11-01T00:00:00.000Z") } }); // membership ACTIVE nhưng chưa tới ngày
      const r = await docTuyChonPhatLink(NOW, TAT_CA);
      const cua = r.doiTac.filter((d) => d.ma.startsWith(MA));
      expect(cua.map((d) => d.ma)).toEqual([`${MA}_PA`]);
      expect(cua[0]!.chuongTrinh[0]).toMatchObject({ membershipId: ok.membershipId, campaignMa: `${MA}_CA` });
      // AFF-L6: mỗi trang đích chọn được mang thêm `id` (thứ gửi lên máy chủ) và `host` (tên miền đã giải = tên miền của website vì trang này không có host riêng).
      const trangDich = cua[0]!.chuongTrinh[0]!.websites[0]!.trangDich;
      expect(trangDich).toHaveLength(1);
      expect(trangDich[0]).toMatchObject({ mau: "/khoa-hoc/*", nhan: "Khoá học", kieu: "TIEN_TO" });
      expect(trangDich[0]!.id).toEqual(expect.any(String));
      expect(trangDich[0]!.host).toMatch(/\./);
      expect(r.chanDoan.soDoiTacHoatDong).toBeGreaterThanOrEqual(7);
      expect(r.chanDoan.soDoiTac).toBeGreaterThan(r.chanDoan.soDoiTacHoatDong - 1);
    });

    it("[AWL-12b] ĐỒNG BỘ với cổng thật: chuỗi mà ô chọn đưa ra thì phatLink nhận; chuỗi ô chọn LOẠI vì ngày thì phatLink cũng từ chối", async () => {
      const tot = await chuan("A");
      const chuaToi = await chuan("E", { campaign: { effectiveFrom: new Date("2026-11-01T00:00:00.000Z") } });
      const hetHan = await chuan("G", { membership: { effectiveTo: new Date("2026-10-12T00:00:00.000Z") } });
      const ra = await docTuyChonPhatLink(NOW, TAT_CA);
      const mid = new Set(ra.doiTac.flatMap((d) => d.chuongTrinh.map((c) => c.membershipId)));
      expect(mid.has(tot.membershipId)).toBe(true);
      expect((await phat(tot)).ok).toBe(true);
      for (const c of [chuaToi, hetHan]) {
        expect(mid.has(c.membershipId)).toBe(false);
        expect((await phat(c)).ok).toBe(false);
      }
    });
  });

  // ── Đường công khai trên DB thật ───────────────────────────────────────────────────────────────────
  describe("[AWL-13..14] đường công khai trên DB thật", () => {
    const deps = (): PhuThuoc => ({ client: db, now: () => NOW, goc: "https://satarobo.vn", choPhepTanSuat: async () => true, khoaHmac: () => KHOA, sinhMaPhien: () => "0123456789abcdef0123456789abcdef" });
    const chuyen = (tokenTho: string, p: Record<string, unknown> = {}) => xuLyBamLink({ tokenTho, ip: "9.9.9.9", query: {}, cookiePhien: null, referer: null, ...p }, deps());

    it("[AWL-13] /r: hợp lệ ⇒ 1 click OK trong DB, URL đích mang clk = id THẬT của click; cookie theo campaign; sessionKey = HMAC", async () => {
      const c = await chuan();
      const l = await phatOk(c);
      const kq = await chuyen(l.token, { query: { aff: "EVIL", clk: "x", redirect: "https://evil.com" }, referer: "https://facebook.com/post?phone=0905" });
      expect(kq.ketCuc).toBe("OK");
      const clicks = await db.referralClick.findMany({ where: { assetId: l.id } });
      expect(clicks).toHaveLength(1);
      expect(clicks[0]).toMatchObject({ outcome: "OK", campaignId: c.campaignId, partyId: c.partyId, referrerHost: "facebook.com", sessionKey: tinhSessionKey(KHOA, "0123456789abcdef0123456789abcdef") });
      expect(kq.diemDen).toBe(`https://a.${HOST}/khoa-hoc/robot?aff=${l.token}&cmp=${MA}_CA&clk=${clicks[0]!.id}`);
      expect(kq.cookieGioiThieu?.maxAgeGiay).toBe(45 * 86400);
    });

    it("[AWL-13b] /r: thu hồi ⇒ click mang mã lý do, KHÔNG cookie giới thiệu; token lạ/hỏng ⇒ KHÔNG dòng click nào", async () => {
      const c = await chuan();
      const l = await phatOk(c);
      const t = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } });
      await thuHoiLink({ nguoi: NGUOI, id: l.id, updatedAtDaThay: t.updatedAt, lyDo: "Một lý do đủ dài để thu hồi", now: NOW });
      const kq = await chuyen(l.token);
      expect(kq.cookieGioiThieu).toBeNull();
      expect(kq.diemDen).toBe(`https://a.${HOST}/khoa-hoc/robot`);
      expect((await db.referralClick.findMany({ where: { assetId: l.id } })).map((x) => x.outcome)).toEqual(["LINK_DA_THU_HOI"]);
      const truoc = await db.referralClick.count();
      await chuyen("ZZZZZZZZZZ");
      await chuyen("khong-phai-token");
      expect(await db.referralClick.count()).toBe(truoc);
    });

    it("[AWL-13c] /r: website bị gỡ khỏi campaign sau khi phát ⇒ click SITE_KHONG_GAN_CAMPAIGN, không cookie", async () => {
      const c = await chuan();
      const l = await phatOk(c);
      await db.affiliateCampaignSite.delete({ where: { campaignId_siteId: { campaignId: c.campaignId, siteId: c.siteId } } });
      const kq = await chuyen(l.token);
      expect(kq.cookieGioiThieu).toBeNull();
      expect((await db.referralClick.findMany({ where: { assetId: l.id } })).map((x) => x.outcome)).toEqual(["SITE_KHONG_GAN_CAMPAIGN"]);
    });

    it("[AWL-14] beacon: URL đúng ⇒ 1 click; URL ngoài danh sách ⇒ 0 click; link thu hồi ⇒ click mã lý do", async () => {
      const c = await chuan();
      const l = await phatOk(c);
      const bay = (landingUrl: string) => xuLyBeacon({ thanTho: JSON.stringify({ v: 1, token: l.token, landingUrl }), origin: `https://a.${HOST}`, ip: "9.9.9.9", cookiePhien: null }, deps());
      const ok = await bay(`https://a.${HOST}/khoa-hoc/robot?aff=${l.token}`);
      expect(ok).toEqual({ acao: `https://a.${HOST}`, ketCuc: "OK" });
      await bay("https://evil.com/khoa-hoc/robot");
      await bay(`https://a.${HOST}/admin`);
      expect(await db.referralClick.count({ where: { assetId: l.id } })).toBe(1);
      const t = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } });
      await thuHoiLink({ nguoi: NGUOI, id: l.id, updatedAtDaThay: t.updatedAt, lyDo: "Một lý do đủ dài để thu hồi", now: NOW });
      expect((await bay(`https://a.${HOST}/khoa-hoc/robot`)).ketCuc).toBe("KHONG_HOP_LE");
      expect((await db.referralClick.findMany({ where: { assetId: l.id }, orderBy: { occurredAt: "asc" } })).map((x) => x.outcome).sort()).toEqual(["LINK_DA_THU_HOI", "OK"]);
    });
  });

  // ── TRIGGER + CHECK của migration, đi vòng qua tầng ứng dụng ───────────────────────────────────────
  describe("[AWL-15] TRIGGER / CHECK cắn thật khi đi vòng qua tầng ứng dụng bằng SQL trực tiếp", () => {
    /** INSERT thô (không qua hàm ghi). Mặc định hợp lệ; `over` ghi đè từng cột để kích đúng một CHECK. */
    async function chenTho(c: Chuoi, over: { id?: string; publicToken?: string; landingPath?: string; status?: string; revokedAt?: Date | null; revokedReason?: string | null; rotatedFromId?: string | null } = {}) {
      const id = over.id ?? `fxawl${Math.random().toString(36).slice(2, 12)}`;
      await db.$executeRaw`
        INSERT INTO "AffiliateTrackingAsset" ("id","partyId","membershipId","campaignId","siteId","landingPath","publicToken","type","status","revokedAt","revokedReason","rotatedFromId","updatedAt")
        VALUES (${id}, ${c.partyId}, ${c.membershipId}, ${c.campaignId}, ${c.siteId}, ${over.landingPath ?? "/khoa-hoc/x"}, ${over.publicToken ?? sinhToken()},
                'LINK'::"AffiliateAssetType", ${over.status ?? "ACTIVE"}::"AffiliateAssetStatus", ${over.revokedAt ?? null}, ${over.revokedReason ?? null}, ${over.rotatedFromId ?? null}, now())`;
      return id;
    }

    it("[AWL-15a] đối chứng dương: INSERT thô hợp lệ thành công (hàm chenTho không tự gây lỗi)", async () => {
      const c = await chuan();
      await expect(chenTho(c)).resolves.toBeTruthy();
    });

    it.each([
      ["quá ngắn", "ABC"],
      ["chữ thường", "k8f29xq47m"],
      ["chứa chữ I (ngoài bảng Crockford)", "K8F29XQ47I"],
      ["chứa chữ U", "K8F29XQ47U"],
      ["11 ký tự", "K8F29XQ47MM"],
      ["có dấu gạch", "K8F2-9XQ47"],
    ])("[AWL-15b] token %s ⇒ CHECK AffiliateTrackingAsset_token_chk", async (_t, publicToken) => {
      const c = await chuan();
      await expect(chenTho(c, { publicToken })).rejects.toThrow(/AffiliateTrackingAsset_token_chk/);
    });

    it.each([
      ["thiếu dấu /", "khoa-hoc"],
      ["có ?", "/khoa-hoc?x=1"],
      ["có #", "/khoa-hoc#a"],
      ["có khoảng trắng", "/khoa hoc"],
    ])("[AWL-15c] landingPath %s ⇒ CHECK duong_dan_chk", async (_t, landingPath) => {
      const c = await chuan();
      await expect(chenTho(c, { landingPath })).rejects.toThrow(/AffiliateTrackingAsset_duong_dan_chk/);
    });

    it("[AWL-15d] trạng thái ↔ cột thu hồi: REVOKED thiếu mốc/lý do, ACTIVE mang dấu vết thu hồi ⇒ CHECK thu_hoi_chk", async () => {
      const c = await chuan();
      await expect(chenTho(c, { status: "REVOKED" })).rejects.toThrow(/AffiliateTrackingAsset_thu_hoi_chk/);
      await expect(chenTho(c, { status: "REVOKED", revokedAt: NOW })).rejects.toThrow(/AffiliateTrackingAsset_thu_hoi_chk/);
      await expect(chenTho(c, { status: "ACTIVE", revokedReason: "lý do lạc chỗ" })).rejects.toThrow(/AffiliateTrackingAsset_thu_hoi_chk/);
      await expect(chenTho(c, { status: "REVOKED", revokedAt: NOW, revokedReason: "đủ cả hai" })).resolves.toBeTruthy();
    });

    it("[AWL-15e] tự xoay chính mình ⇒ CHECK khong_tu_xoay_chk", async () => {
      const c = await chuan();
      await expect(chenTho(c, { id: "fxawl-tu-xoay", rotatedFromId: "fxawl-tu-xoay" })).rejects.toThrow(/AffiliateTrackingAsset_khong_tu_xoay_chk/);
    });

    it.each([
      ["publicToken", (id: string) => db.$executeRaw`UPDATE "AffiliateTrackingAsset" SET "publicToken" = 'ZZZZZZZZZZ' WHERE "id" = ${id}`],
      ["landingPath", (id: string) => db.$executeRaw`UPDATE "AffiliateTrackingAsset" SET "landingPath" = '/trang-khac' WHERE "id" = ${id}`],
      ["type", (id: string) => db.$executeRaw`UPDATE "AffiliateTrackingAsset" SET "type" = 'QR'::"AffiliateAssetType" WHERE "id" = ${id}`],
      ["partyId", (id: string) => db.$executeRaw`UPDATE "AffiliateTrackingAsset" SET "partyId" = (SELECT "id" FROM "Affiliate" WHERE "code" = ${`${MA}_PB`}) WHERE "id" = ${id}`],
      ["membershipId", (id: string) => db.$executeRaw`UPDATE "AffiliateTrackingAsset" SET "membershipId" = (SELECT "id" FROM "AffiliateMembership" WHERE "partyId" = (SELECT "id" FROM "Affiliate" WHERE "code" = ${`${MA}_PB`})) WHERE "id" = ${id}`],
      ["campaignId", (id: string) => db.$executeRaw`UPDATE "AffiliateTrackingAsset" SET "campaignId" = (SELECT "id" FROM "AffiliateCampaign" WHERE "code" = ${`${MA}_CB`}) WHERE "id" = ${id}`],
      ["siteId", (id: string) => db.$executeRaw`UPDATE "AffiliateTrackingAsset" SET "siteId" = (SELECT "id" FROM "AffiliateSite" WHERE "code" = ${`${MA}_SB`}) WHERE "id" = ${id}`],
    ])("[AWL-15f] TRIGGER bất biến: đổi %s của link đã phát ⇒ LỖI, giá trị cũ còn nguyên", async (_cot, sua) => {
      const a = await chuan("A");
      await chuan("B");
      const l = await phatOk(a);
      await expect(sua(l.id)).rejects.toThrow(/định danh của link không đổi được/);
      const dong = await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } });
      expect(dong).toMatchObject({ publicToken: l.token, landingPath: "/khoa-hoc/robot", type: "LINK", partyId: a.partyId, membershipId: a.membershipId, campaignId: a.campaignId, siteId: a.siteId });
    });

    it("[AWL-15g] ĐỐI CHỨNG DƯƠNG cho trigger: đổi NHÃN và THU HỒI qua SQL thô vẫn được phép", async () => {
      const c = await chuan();
      const l = await phatOk(c);
      await expect(db.$executeRaw`UPDATE "AffiliateTrackingAsset" SET "label" = 'nhãn mới' WHERE "id" = ${l.id}`).resolves.toBe(1);
      await expect(
        db.$executeRaw`UPDATE "AffiliateTrackingAsset" SET "status" = 'REVOKED'::"AffiliateAssetStatus", "revokedAt" = now(), "revokedReason" = 'thu hồi qua SQL thô' WHERE "id" = ${l.id}`,
      ).resolves.toBe(1);
    });

    it("[AWL-15h] link đã THU HỒI không bật lại được dù xoá sạch dấu vết thu hồi", async () => {
      const c = await chuan();
      const l = await phatOk(c);
      await db.$executeRaw`UPDATE "AffiliateTrackingAsset" SET "status" = 'REVOKED'::"AffiliateAssetStatus", "revokedAt" = now(), "revokedReason" = 'thu hồi' WHERE "id" = ${l.id}`;
      await expect(
        db.$executeRaw`UPDATE "AffiliateTrackingAsset" SET "status" = 'ACTIVE'::"AffiliateAssetStatus", "revokedAt" = NULL, "revokedReason" = NULL WHERE "id" = ${l.id}`,
      ).rejects.toThrow(/không bật lại được/);
      expect((await db.affiliateTrackingAsset.findUniqueOrThrow({ where: { id: l.id } })).status).toBe("REVOKED");
    });

    it("[AWL-15i] ReferralClick CHỈ-THÊM: UPDATE và DELETE đều LỖI, dòng còn nguyên", async () => {
      const c = await chuan();
      const l = await phatOk(c);
      const click = await db.referralClick.create({ data: { assetId: l.id, campaignId: c.campaignId, partyId: c.partyId, outcome: "OK" } });
      await expect(db.$executeRaw`UPDATE "ReferralClick" SET "outcome" = 'LINK_DA_THU_HOI' WHERE "id" = ${click.id}`).rejects.toThrow(/chỉ-thêm/);
      await expect(db.$executeRaw`DELETE FROM "ReferralClick" WHERE "id" = ${click.id}`).rejects.toThrow(/chỉ-thêm/);
      await expect(db.referralClick.update({ where: { id: click.id }, data: { sessionKey: "x" } })).rejects.toThrow(/chỉ-thêm/);
      await expect(db.referralClick.deleteMany({ where: { assetId: l.id } })).rejects.toThrow(/chỉ-thêm/);
      expect(await db.referralClick.count({ where: { id: click.id, outcome: "OK" } })).toBe(1);
    });

    it.each([
      ["chữ thường", "ok"],
      ["một ký tự", "X"],
      ["có số", "OK1"],
      ["có khoảng trắng", "LINK DA THU HOI"],
    ])("[AWL-15j] ReferralClick.outcome %s ⇒ CHECK outcome_chk; đối chứng dương: OK / LINK_DA_THU_HOI", async (_t, outcome) => {
      const c = await chuan();
      const l = await phatOk(c);
      await expect(db.referralClick.create({ data: { assetId: l.id, campaignId: c.campaignId, partyId: c.partyId, outcome } })).rejects.toThrow(/ReferralClick_outcome_chk/);
      await expect(db.referralClick.create({ data: { assetId: l.id, campaignId: c.campaignId, partyId: c.partyId, outcome: "LINK_DA_THU_HOI" } })).resolves.toBeTruthy();
    });
  });
});
