// @vitest-environment node
/**
 * [RXT-DB-*] — XỬ LÝ TAY REFERRAL AFFILIATE trên Postgres THẬT: duyệt · từ chối · tranh chấp · xin/bổ sung bằng chứng · khai tay (AFF-L3b).
 *
 *   [RXT-DB-01] máy trạng thái qua DB: từ chối ⇒ REJECTED + rejectedAt; REJECTED→DUYỆT bị chặn và KHÔNG đổi gì (status, updatedAt, số sự kiện, attribution)
 *   [RXT-DB-02] DUYỆT lead CHƯA có nguồn ⇒ ghi attribution đúng đường (đối tác · campaign · nguồn giải từ cấu hình · AFFILIATE_REFERRAL); VALID + protectedUntil = duyệt + cửa sổ bảo vệ; cổng engine đọc được
 *   [RXT-DB-03] DUYỆT lead đang ở nhóm «chờ» (UNKNOWN) ⇒ thay nhóm chờ, giữ nguồn gốc ban đầu, gỡ cờ xem tay, giữ vết cũ
 *   [RXT-DB-04] DUYỆT lead ĐÃ có nguồn khác ⇒ KHÔNG ghi đè (đối tác khác · nhóm thật · nhân sự): từ chối, attribution y nguyên, referral y nguyên, 0 sự kiện
 *   [RXT-DB-05] nhóm «chờ» nhưng lead ĐÃ có khoản thu ⇒ từ chối, không đổi gì (đổi người hưởng của hoa hồng đã tính ⇒ qua Đổi nguồn)
 *   [RXT-DB-06] đã đúng đối tác + campaign từ trước ⇒ VALID mà KHÔNG ghi lại attribution; đúng đối tác nhưng campaign khác ⇒ từ chối
 *   [RXT-DB-07] ĐẦU–CUỐI: khai tay → duyệt → thanh toán thật → quét engine ⇒ dòng sổ cho ĐỐI TÁC mang cả ba cột referral; đối chứng âm: chưa duyệt thì quét KHÔNG ra dòng AFFILIATE
 *   [RXT-DB-08] khoá lạc quan: mốc cũ ⇒ «vừa được xử lý»; hai lượt DUYỆT đồng thời ⇒ đúng một thắng, đúng một sự kiện
 *   [RXT-DB-09] khai tay: khoá lạ (soTien · tiLe · nguồn · trạng thái) bị từ chối KHÔNG tạo dòng; cách đến LINK bị từ chối; vào MANUAL_REVIEW; KHÔNG chạm attribution
 *   [RXT-DB-10] khai tay chống trùng: lượt sống ⇒ từ chối; hai lượt đồng thời ⇒ một dòng; sau khi lượt cũ bị từ chối ⇒ khai lại được (khoá mới)
 *   [RXT-DB-11] khai tay chặn: tự giới thiệu · thành viên không hoạt động · campaign hết hạn · chưa là thành viên · campaign chưa cấu hình nguồn
 *   [RXT-DB-12] tách nhiệm: người khai ≠ người duyệt khi còn người khác giữ quyền; không còn ai ⇒ tự duyệt có dấu vết; chính đối tác không tự duyệt
 *   [RXT-DB-13] cách ly cơ sở: CS1 không xử lý / khai tay / đọc lịch sử của CS2; `centerId NULL` chỉ Hội sở; đối chứng dương: CS1 xử lý được CS1
 *   [RXT-DB-13b] duyệt khi phiếu khách đã chuyển cơ sở khác ⇒ từ chối, không ghi nguồn ngoài tầm
 *   [RXT-DB-14] nhật ký + audit: mỗi hành động đúng 1 sự kiện + 1 AuditLog; `previousReason` giữ lý do cũ; sự kiện BẤT BIẾN (UPDATE/DELETE bị trigger chặn); FK Restrict
 *   [RXT-DB-15] xin / bổ sung bằng chứng GIỮ trạng thái, đẩy mốc `updatedAt`, `dangChoBangChung` đúng
 *   [RXT-DB-16] lượt TỰ ĐỘNG cần xem tay (nguồn là chỗ giữ UNKNOWN, Origin lệch) ⇒ duyệt giải LẠI nguồn từ cấu hình, giữ Origin gốc trong bản chụp
 *   [RXT-DB-17] duyệt FAIL-CLOSED khi chuỗi hết hợp lệ: campaign đã hết hạn / thành viên ngừng / chưa cấu hình nguồn ⇒ từ chối, y nguyên
 *   [RXT-DB-18] ô tìm phiếu: theo mã ai cũng tìm; tên cần xem khách; SĐT cần xem PII; luôn che; cách ly cơ sở
 *   [RXT-DB-19] lý do / ghi chú: < 10 ký tự và PII bị từ chối KHÔNG ghi gì
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng hiện trường (mã duy nhất). LUẬT 19: ngày TUYỆT ĐỐI; `Date.now()` chỉ làm hậu tố mã.
 * AN TOÀN DB: không `resetDb()`; dọn THEO TIỀN TỐ (`AFRX` của fixture chung); nhật ký chỉ-thêm nên tắt trigger MỘT giao dịch rồi bật lại khi dọn.
 */
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.setConfig({ testTimeout: 90_000 });

import type { Actor } from "../../lib/auth/actor";
import { db } from "../../lib/db";
import { laDbCucBo } from "../../lib/security/url-db-cuc-bo";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { docAffiliateChoHoaHong } from "../../lib/affiliate/campaign-cho-hoa-hong";
import { dungSnapshotReferral, docSnapshotAffiliate } from "../../lib/affiliate/snapshot-referral";
import { docLichSuReferral, timPhieuKhaiTay } from "../../lib/affiliate/doc-xu-ly-referral";
import { demReferralCanXemTay } from "../../lib/affiliate/doc-referral";
import { khaiTayReferral, xuLyReferral, type KetQuaXuLyReferral } from "../../lib/affiliate/ghi-referral-xu-ly";
import { dangChoBangChung, type HanhDongXuLy } from "../../lib/affiliate/xu-ly-referral";
import { taoNguonBanDau } from "../../lib/nguon/ghi-nguon";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon, duLieuNguon } from "../lead-intake/_nguon-fixture";
import { boiCanh, D, datMocCutover, donKichBan, dongSoCuaKhoan, dungBe, dungKichBan, tienVe, type KichBan } from "./_kich-ban";
import { TIEN_TO, dungChuoi, donAffiliateFx, hau, type Chuoi } from "./_affiliate-so-fx";

if (!RUN_DB_TESTS) console.warn(`[RXT-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = new Date("2026-10-13T03:00:00.000Z");
const LY_DO = "Khách xác nhận chị An giới thiệu tại sự kiện";
const GHI_CHU = "Biên nhận sự kiện BN-0042 do cán bộ Lan ký";

/** Tên khách của CHÍNH bộ này (fixture chung `KHACH` bị `donAffiliateFx` xoá theo tên — mà lead có đơn thì không xoá được). */
const LEAD_TEN = "Nguyễn Thị RxtKhach";
const cuaToi: KichBan[] = [];
const userIds: string[] = [];

// ── hạ tầng ──────────────────────────────────────────────────────────────────────────────────────

async function assertDbThu(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!laDbCucBo(url)) throw new Error("[RXT-DB] TỪ CHỐI: DATABASE_URL không trỏ Postgres cục bộ (hoặc là tunnel VPS).");
  const r = await db.$queryRaw<{ ten: string }[]>`select current_database() as ten`;
  const ten = r[0]?.ten ?? "";
  if (/^(satarobo_local|satarobo_dev)/.test(ten)) throw new Error(`[RXT-DB] TỪ CHỐI: database "${ten}" là DB đang phục vụ dev server.`);
}

/** Dọn: sự kiện CHỈ-THÊM nên tắt trigger MỘT giao dịch; rồi dọn chuỗi Affiliate của fixture chung. */
async function don(): Promise<void> {
  const ds = await db.affiliate.findMany({ where: { code: { startsWith: TIEN_TO } }, select: { id: true } });
  const ids = ds.map((x) => x.id);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`ALTER TABLE "AffiliateReferralEvent" DISABLE TRIGGER "AffiliateReferralEvent_chi_them"`;
    await tx.affiliateReferralEvent.deleteMany({ where: { referral: { partyId: { in: ids } } } });
    await tx.$executeRaw`ALTER TABLE "AffiliateReferralEvent" ENABLE TRIGGER "AffiliateReferralEvent_chi_them"`;
  });
  await db.leadAttribution.deleteMany({ where: { lead: { parentName: LEAD_TEN } } });
  await donAffiliateFx(); // xoá referral TRƯỚC (FK Restrict tới Lead)
  // Lead đã có đơn / học viên thì KHÔNG xoá được (FK) — để lại có chủ đích, mang tên riêng của bộ này; chỉ xoá lead không ai tham chiếu.
  await db.$executeRaw`DELETE FROM "Lead" l WHERE l."parentName" = ${LEAD_TEN}
    AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."leadId" = l."id")
    AND NOT EXISTS (SELECT 1 FROM "Student" s WHERE s."leadId" = l."id")`.catch(() => undefined);
}

const base = (): Actor =>
  ({
    userId: "rxt-actor",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as Actor;
const actorHo = (): Actor => ({ ...base(), isSuperAdmin: true });
const actorCoSo = (ids: string[]): Actor => ({ ...base(), visibleCenterIds: ids });

const nguoi = (id = "rxt-nguoi-a", ten = "Người Xử Lý A") => ({ userId: id, ten });

type Hien = { ch: Chuoi; k: KichBan };
let heSo = 0;
/** Hiện trường: chuỗi Affiliate + kịch bản (cơ sở + OrgUnit). `rules` AFFILIATE để quét được tiền khi cần. */
async function dung(tien: string, p: { tienRule?: boolean } = {}): Promise<Hien> {
  heSo += 1;
  const k = await dungKichBan(`rx${tien}${heSo}`, { coLead: false, rules: p.tienRule ? [{ vai: "SALE", rate: 0.04 }, { vai: "AFFILIATE", rate: 0.01 }] : undefined });
  cuaToi.push(k);
  const ch = await dungChuoi();
  return { ch, k };
}

/** Lead của cơ sở kịch bản. `chu` ⇒ có người chốt (để SALE có người nhận khi quét tiền). */
async function taoLead(h: Hien, ghi: Partial<{ centerId: string | null; phone: string; email: string; deletedAt: Date; chu: boolean }> = {}) {
  return db.lead.create({
    data: {
      parentName: LEAD_TEN,
      phone: ghi.phone ?? `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      email: ghi.email ?? `rxt.${hau().toLowerCase()}@example.com`,
      ...(ghi.centerId === null ? {} : { centerId: ghi.centerId ?? h.k.centerId }),
      ...(ghi.deletedAt ? { deletedAt: ghi.deletedAt } : {}),
      ...(ghi.chu ? { status: "DA_DANG_KY" as const, convertedById: h.k.sale.id, adminId: h.k.saleAdmin.id } : {}),
    },
  });
}

/** Khai tay bằng đường THẬT; trả id referral. */
async function khai(h: Hien, leadId: string, ghi: Partial<{ actor: Actor; nguoi: { userId: string; ten: string }; method: "MANUAL" | "OFFLINE" }> = {}) {
  const r = await khaiTayReferral({
    actor: ghi.actor ?? actorHo(),
    nguoi: ghi.nguoi ?? nguoi(),
    vao: { partyId: h.ch.doiTac.id, campaignId: h.ch.campaign.id, leadId, method: ghi.method ?? "OFFLINE", lyDo: LY_DO, ghiChu: GHI_CHU },
    now: NOW,
  });
  if (!r.ok) throw new Error(`khai tay thất bại: ${r.loi}`);
  return r.id;
}

const xuLy = async (id: string, hanhDong: HanhDongXuLy, ghi: Partial<{ actor: Actor; nguoi: { userId: string; ten: string }; lyDo: unknown; ghiChu: unknown; moc: Date; now: Date }> = {}): Promise<KetQuaXuLyReferral> => {
  const hien = await db.affiliateReferral.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } });
  return xuLyReferral({
    actor: ghi.actor ?? actorHo(),
    nguoi: ghi.nguoi ?? nguoi("rxt-nguoi-b", "Người Duyệt B"),
    referralId: id,
    hanhDong,
    updatedAtDaThay: ghi.moc ?? hien.updatedAt,
    lyDo: ghi.lyDo ?? LY_DO,
    ghiChu: "ghiChu" in ghi ? ghi.ghiChu : GHI_CHU, // null là GIÁ TRỊ (thiếu ghi chú), không phải «dùng mặc định»
    now: ghi.now ?? NOW,
  });
};

const rf = (id: string) => db.affiliateReferral.findUniqueOrThrow({ where: { id } });
const nSuKien = (id: string) => db.affiliateReferralEvent.count({ where: { referralId: id } });
const attr = (leadId: string) => db.leadAttribution.findUnique({ where: { leadId }, include: { group: { select: { code: true } } } });
const nhomChoId = async () => (await db.leadSourceGroup.findFirstOrThrow({ where: { code: "UNKNOWN" }, select: { id: true } })).id;

/** Bản chụp `signals.affiliate` đúng hình dạng thật (cùng hàm dựng với đường tự động và đường duyệt tay). */
const snJson = (v: Parameters<typeof dungSnapshotReferral>[0]) => dungSnapshotReferral(v) as Prisma.InputJsonObject;

/** Ghi sẵn một dòng quy nguồn (đường THẬT của lớp nguồn). */
async function ghiNguonSan(leadId: string, groupId: string, ghi: Parameters<typeof duLieuNguon>[1] = {}) {
  await db.$transaction((tx) => taoNguonBanDau(tx, leadId, duLieuNguon(groupId, ghi), null));
}

const bc = describe.skipIf(!RUN_DB_TESTS);

bc("[RXT-DB] xử lý tay referral Affiliate — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await assertDbThu();
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["HO_ACCOUNTANT", "CENTER_SALES_CSM"] });
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await datMocCutover("2026-10");
    await don().catch(() => undefined);
  }, 180_000);

  afterAll(async () => {
    await donKichBan(cuaToi);
    await don();
    if (userIds.length > 0) {
      await db.userOrgRole.deleteMany({ where: { userId: { in: userIds } } });
    }
    await db.roleDef.deleteMany({ where: { code: { startsWith: "RXT_" } } });
    await datMocCutover(null);
  }, 180_000);

  it("[RXT-DB-01] từ chối ⇒ REJECTED + rejectedAt + 1 sự kiện; REJECTED→DUYỆT bị chặn và KHÔNG đổi gì (status · updatedAt · sự kiện · attribution)", async () => {
    const h = await dung("a1");
    const lead = await taoLead(h);
    const id = await khai(h, lead.id);
    expect((await rf(id)).status).toBe("MANUAL_REVIEW");

    const r = await xuLy(id, "TU_CHOI");
    expect(r).toMatchObject({ ok: true, den: "REJECTED", nhanhGhiNguon: null });
    const sau = await rf(id);
    expect(sau.status).toBe("REJECTED");
    expect(sau.rejectedAt).not.toBeNull();
    expect(sau.resolutionReason).toContain("Từ chối tay");
    expect(await nSuKien(id)).toBe(2); // KHAI_TAY + TU_CHOI

    const truoc = { status: sau.status, updatedAt: sau.updatedAt.getTime(), nSk: await nSuKien(id) };
    const lai = await xuLy(id, "DUYET");
    expect(lai.ok).toBe(false);
    if (!lai.ok) expect(lai.loi).toContain("đã được chốt");
    const cuoi = await rf(id);
    expect({ status: cuoi.status, updatedAt: cuoi.updatedAt.getTime(), nSk: await nSuKien(id) }).toEqual(truoc);
    expect(await attr(lead.id)).toBeNull(); // từ chối/duyệt-bị-chặn KHÔNG đụng nguồn
  });

  it("[RXT-DB-02] DUYỆT lead chưa có nguồn ⇒ attribution đúng đường; VALID + bảo vệ; cổng engine đọc được ba id", async () => {
    const h = await dung("a2");
    const lead = await taoLead(h);
    const id = await khai(h, lead.id);
    expect(await attr(lead.id)).toBeNull(); // khai tay KHÔNG chiếm nguồn

    const r = await xuLy(id, "DUYET");
    expect(r).toMatchObject({ ok: true, den: "VALID", nhanhGhiNguon: "TAO_MOI", tuDuyet: false });

    const a = (await attr(lead.id))!;
    expect(a).toMatchObject({ referrerKind: "AFFILIATE", referrerAffiliateId: h.ch.doiTac.id, matchedRule: "AFFILIATE_REFERRAL", groupId: h.ch.nhomId, originalGroupId: h.ch.nhomId, identificationMethod: "AFFILIATE", referrerMissing: false });
    expect(docSnapshotAffiliate(a.signals)).toMatchObject({ affiliateCode: h.ch.doiTac.code, campaignCode: h.ch.campaign.code, tu: "MAC_DINH_CAMPAIGN" });
    expect(a.signals).toMatchObject({ duyetReferral: { referralId: id }, nguon: { cuaSoNgay: expect.any(Number) } });

    const v = await rf(id);
    expect(v.status).toBe("VALID");
    expect(v.leadId).toBe(lead.id);
    expect(v.sourceGroupId).toBe(h.ch.nhomId);
    expect(v.protectedUntil?.toISOString()).toBe(new Date(NOW.getTime() + 90 * 24 * 3600 * 1000).toISOString()); // cửa sổ bảo vệ 90 ngày của campaign
    expect(v.rejectedAt).toBeNull();

    // Cổng của engine (hoa hồng đọc attribution, không đọc referral): trả đủ campaign + thành viên + CHÍNH referral vừa duyệt.
    const eng = await docAffiliateChoHoaHong(db, { leadId: lead.id, referrerKind: a.referrerKind, referrerAffiliateId: a.referrerAffiliateId, snapshot: docSnapshotAffiliate(a.signals) });
    expect(eng).toMatchObject({ campaignId: h.ch.campaign.id, membershipId: h.ch.mem.id, referralId: id });
  });

  it("[RXT-DB-03] DUYỆT lead đang ở nhóm «chờ» ⇒ thay nhóm chờ; giữ nguồn gốc ban đầu; gỡ cờ xem tay; giữ vết cũ; audit đổi nguồn", async () => {
    const h = await dung("a3");
    const lead = await taoLead(h);
    const cho = await nhomChoId();
    await ghiNguonSan(lead.id, cho, { identificationMethod: "UNKNOWN", matchedRule: "UNKNOWN", signals: { duongVao: "facebook", nhanGoc: "ban-be", coXemTay: true, xemTay: ["PAGE_CHUA_MAP_NGUON"] }, conversionEntry: "facebook" });
    const truoc = (await attr(lead.id))!;
    const id = await khai(h, lead.id);

    const r = await xuLy(id, "DUYET");
    expect(r).toMatchObject({ ok: true, den: "VALID", nhanhGhiNguon: "DE_NHOM_CHO" });
    const a = (await attr(lead.id))!;
    expect(a).toMatchObject({ groupId: h.ch.nhomId, originalGroupId: cho, referrerKind: "AFFILIATE", referrerAffiliateId: h.ch.doiTac.id, matchedRule: "AFFILIATE_REFERRAL" });
    expect(a.attributedAt.getTime()).toBe(truoc.attributedAt.getTime()); // first-claim: giờ ghi nhận gốc KHÔNG đổi
    expect(a.signals).toMatchObject({ duongVao: "facebook", nhanGoc: "ban-be", daXemTay: true });
    expect(a.signals).not.toHaveProperty("coXemTay");
    expect(a.signals).not.toHaveProperty("xemTay");
    expect(a.changeReason).toBe(LY_DO);
    const kiem = await db.auditLog.findFirst({ where: { entityType: "Lead", entityId: lead.id, action: "DOI_NGUON" } });
    expect(kiem).not.toBeNull();
  });

  const CA_KHONG_GHI_DE: [string, (h: Hien, leadId: string) => Promise<void>][] = [
    [
      "đối tác KHÁC",
      async (h, leadId) => {
        const khac = await db.affiliate.create({ data: { code: `${TIEN_TO}_K${hau()}`, name: "Đối tác khác", status: "ACTIVE", isActive: true } });
        await ghiNguonSan(leadId, h.ch.nhomId, { referrerKind: "AFFILIATE", referrerAffiliateId: khac.id, identificationMethod: "AFFILIATE", matchedRule: "AFFILIATE_REFERRAL", signals: { affiliate: snJson({ affiliateCode: khac.code, campaignCode: h.ch.campaign.code, method: "LINK", typeCode: null, tagCodes: [], tu: "MAC_DINH_CAMPAIGN", origin: "KHOP", canCuTuGioiThieu: [] }) } });
      },
    ],
    [
      "nhóm thật (quảng cáo), không người",
      async (h, leadId) => {
        await ghiNguonSan(leadId, h.ch.nhomId, { identificationMethod: "AD_FORM_CAMPAIGN", matchedRule: "QUANG_CAO" });
      },
    ],
  ];
  for (const [ten, dung_] of CA_KHONG_GHI_DE) {
    it(`[RXT-DB-04] lead đã có nguồn «${ten}» ⇒ DUYỆT bị từ chối «đã có người ghi nhận trước»; attribution · referral · sự kiện Y NGUYÊN`, async () => {
      const h = await dung("a4");
      const lead = await taoLead(h);
      await dung_(h, lead.id);
      const id = await khai(h, lead.id);
      const aTruoc = (await attr(lead.id))!;
      const rTruoc = await rf(id);
      const nTruoc = await nSuKien(id);

      const r = await xuLy(id, "DUYET");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.loi).toContain("đã có người ghi nhận trước");
        expect(r.loi).toContain("Đổi nguồn");
      }
      const aSau = (await attr(lead.id))!;
      expect({ g: aSau.groupId, k: aSau.referrerKind, p: aSau.referrerAffiliateId, u: aSau.updatedAt.getTime(), m: aSau.matchedRule }).toEqual({ g: aTruoc.groupId, k: aTruoc.referrerKind, p: aTruoc.referrerAffiliateId, u: aTruoc.updatedAt.getTime(), m: aTruoc.matchedRule });
      const rSau = await rf(id);
      expect({ s: rSau.status, u: rSau.updatedAt.getTime(), p: rSau.protectedUntil }).toEqual({ s: rTruoc.status, u: rTruoc.updatedAt.getTime(), p: null });
      expect(await nSuKien(id)).toBe(nTruoc);
      // đối chứng dương: TỪ CHỐI vẫn làm được với lý do «đã có người ghi nhận trước» — đó là lối ra
      expect((await xuLy(id, "TU_CHOI", { lyDo: "Đã có người ghi nhận trước đó" })).ok).toBe(true);
    });
  }

  it("[RXT-DB-05] nhóm «chờ» nhưng lead ĐÃ có khoản thu ⇒ DUYỆT từ chối, không đổi gì; đối chứng dương: chưa thu thì duyệt được", async () => {
    const h = await dung("a5");
    const lead = await taoLead(h, { chu: true });
    const cho = await nhomChoId();
    await ghiNguonSan(lead.id, cho, { identificationMethod: "UNKNOWN", matchedRule: "UNKNOWN" });
    const k = { ...h.k, lead };
    const be = await dungBe(k, "a", { tongTien: 10_000_000 });
    await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-12") });
    const id = await khai(h, lead.id);
    const aTruoc = (await attr(lead.id))!;

    const r = await xuLy(id, "DUYET");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi).toContain("khoản thu");
    const aSau = (await attr(lead.id))!;
    expect({ g: aSau.groupId, k: aSau.referrerKind, u: aSau.updatedAt.getTime() }).toEqual({ g: aTruoc.groupId, k: aTruoc.referrerKind, u: aTruoc.updatedAt.getTime() });
    expect((await rf(id)).status).toBe("MANUAL_REVIEW");

    const h2 = await dung("a5b");
    const lead2 = await taoLead(h2);
    await ghiNguonSan(lead2.id, cho, { identificationMethod: "UNKNOWN", matchedRule: "UNKNOWN" });
    expect((await xuLy(await khai(h2, lead2.id), "DUYET")).ok).toBe(true);
  });

  it("[RXT-DB-06] đã đúng đối tác + campaign ⇒ VALID, KHÔNG ghi lại (updatedAt giữ); đúng đối tác nhưng campaign khác ⇒ từ chối", async () => {
    const h = await dung("a6");
    const lead = await taoLead(h);
    const sn = (campaignCode: string) => snJson({ affiliateCode: h.ch.doiTac.code, campaignCode, method: "LINK", typeCode: null, tagCodes: [], tu: "MAC_DINH_CAMPAIGN", origin: "KHOP", canCuTuGioiThieu: [] });
    await ghiNguonSan(lead.id, h.ch.nhomId, { referrerKind: "AFFILIATE", referrerAffiliateId: h.ch.doiTac.id, identificationMethod: "AFFILIATE", matchedRule: "AFFILIATE_REFERRAL", signals: { affiliate: sn(h.ch.campaign.code) } });
    const aTruoc = (await attr(lead.id))!;
    const id = await khai(h, lead.id);
    expect(await xuLy(id, "DUYET")).toMatchObject({ ok: true, den: "VALID", nhanhGhiNguon: "DA_DUNG_NGUOI" });
    expect((await attr(lead.id))!.updatedAt.getTime()).toBe(aTruoc.updatedAt.getTime());
    expect((await rf(id)).status).toBe("VALID");

    const h2 = await dung("a6b");
    const lead2 = await taoLead(h2);
    await ghiNguonSan(lead2.id, h2.ch.nhomId, { referrerKind: "AFFILIATE", referrerAffiliateId: h2.ch.doiTac.id, identificationMethod: "AFFILIATE", matchedRule: "AFFILIATE_REFERRAL", signals: { affiliate: snJson({ affiliateCode: h2.ch.doiTac.code, campaignCode: "CAMP_CU_KHAC", method: "LINK", typeCode: null, tagCodes: [], tu: null, origin: "KHOP", canCuTuGioiThieu: [] }) } });
    const id2 = await khai(h2, lead2.id);
    const r = await xuLy(id2, "DUYET");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi).toContain("campaign khác");
    expect((await rf(id2)).status).toBe("MANUAL_REVIEW");
  });

  it("[RXT-DB-07] ĐẦU–CUỐI: khai tay → duyệt → thanh toán thật → quét ⇒ dòng sổ cho ĐỐI TÁC có ba cột referral; chưa duyệt thì quét KHÔNG ra dòng AFFILIATE", async () => {
    const h = await dung("a7", { tienRule: true });
    const lead = await taoLead(h, { chu: true });
    const k: KichBan = { ...h.k, lead };
    const id = await khai(h, lead.id);

    // Đối chứng ÂM: referral MANUAL_REVIEW, lead chưa có nguồn ⇒ engine không có người hưởng Affiliate.
    let khoan1: string;
    {
      const bcQuet = await boiCanh(k, D("2026-11-20"));
      const be = await dungBe(k, "x", { tongTien: 10_000_000 });
      const khoan = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-12") });
      khoan1 = khoan;
      await quetKhoan(db, bcQuet, khoan);
      const dong = await dongSoCuaKhoan(khoan);
      expect(dong.filter((d) => d.roleCode === "AFFILIATE")).toHaveLength(0);
    }

    // Duyệt xong (lead đã có khoản thu nhưng CHƯA có dòng quy nguồn ⇒ TAO_MOI hợp lệ) ⇒ khoản mới được quét ra dòng AFFILIATE.
    expect(await xuLy(id, "DUYET")).toMatchObject({ ok: true, nhanhGhiNguon: "TAO_MOI" });
    // DB đặt `attributedAt` = giờ THẬT; ghim sang ngày tuyệt đối để khoản thu nằm trong cửa sổ ghi công (cùng cách `affiliate-hoa-hong.spec.ts`).
    await db.leadAttribution.update({ where: { leadId: lead.id }, data: { attributedAt: new Date("2026-10-01T03:00:00.000Z") } });
    const bcQuet2 = await boiCanh(k, D("2026-11-20"));
    const be2 = await dungBe(k, "y", { tongTien: 10_000_000 });
    const khoan2 = await tienVe(k, be2, { soTien: 10_000_000, ngay: D("2026-10-13") });
    const kq = await quetKhoan(db, bcQuet2, khoan2);
    expect(kq.loai).toBe("DA_GHI");
    // KHOẢN ĐÃ QUÉT TRƯỚC KHI lead có nguồn (khoản #1) — đây là lý do duyệt lead «chưa có dòng quy nguồn + đã thu» được phép (còn «nhóm chờ + đã thu» thì không):
    // đo thật (13/10/2026) cho thấy quét lại ra TRÔI (`LECH_TIEN`, chênh +100.000đ cho đối tác) và KHÔNG tự ghi dòng nào. Tiền chỉ đổi khi người có quyền xử lý chênh lệch.
    // Nếu engine đổi sang TỰ GHI (LATE_ARRIVAL) thì ca này đỏ ⇒ phải nối cổng «đã thu» vào nhánh TAO_MOI.
    const lai = await quetKhoan(db, bcQuet2, khoan1);
    expect(lai).toMatchObject({ loai: "TROI", lyDo: "LECH_TIEN" });
    expect((await dongSoCuaKhoan(khoan1)).filter((d) => d.roleCode === "AFFILIATE")).toHaveLength(0);
    const aff = (await dongSoCuaKhoan(khoan2)).find((d) => d.roleCode === "AFFILIATE");
    expect(aff).toBeDefined();
    expect(aff).toMatchObject({ beneficiaryKind: "AFFILIATE", beneficiaryAffiliateId: h.ch.doiTac.id, affiliateCampaignId: h.ch.campaign.id, affiliateMembershipId: h.ch.mem.id, affiliateReferralId: id });
    expect(aff!.amount).toBeGreaterThan(0);
  });

  it("[RXT-DB-08] khoá lạc quan: mốc cũ ⇒ «vừa được xử lý», không đổi gì; hai lượt DUYỆT đồng thời ⇒ đúng một thắng, đúng một sự kiện DUYET", async () => {
    const h = await dung("a8");
    const lead = await taoLead(h);
    const id = await khai(h, lead.id);
    const cu = (await rf(id)).updatedAt;
    expect((await xuLy(id, "XIN_BANG_CHUNG", { lyDo: "Cần biên nhận gốc của sự kiện" })).ok).toBe(true); // đẩy mốc
    const stale = await xuLy(id, "DUYET", { moc: cu });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.loi).toContain("vừa được người khác xử lý");
    expect((await rf(id)).status).toBe("MANUAL_REVIEW");
    expect(await attr(lead.id)).toBeNull();

    const moc = (await rf(id)).updatedAt;
    const song = await Promise.all([xuLy(id, "DUYET", { moc, nguoi: nguoi("rxt-b1", "B1") }), xuLy(id, "DUYET", { moc, nguoi: nguoi("rxt-b2", "B2") })]);
    expect(song.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.affiliateReferralEvent.count({ where: { referralId: id, kind: "DUYET" } })).toBe(1);
    expect(await db.leadAttribution.count({ where: { leadId: lead.id } })).toBe(1);
  });

  it("[RXT-DB-09] khai tay: khoá lạ bị từ chối KHÔNG tạo dòng; cách đến LINK bị từ chối; hợp lệ vào MANUAL_REVIEW, KHÔNG chạm attribution", async () => {
    const h = await dung("a9");
    const lead = await taoLead(h);
    const dau = { partyId: h.ch.doiTac.id, campaignId: h.ch.campaign.id, leadId: lead.id, method: "MANUAL", lyDo: LY_DO, ghiChu: GHI_CHU };
    const dem = () => db.affiliateReferral.count({ where: { leadId: lead.id } });
    for (const them of [{ soTien: 500_000 }, { tiLe: 0.05 }, { sourceGroupId: h.ch.nhomId }, { status: "VALID" }, { commissionPercent: 3 }]) {
      const r = await khaiTayReferral({ actor: actorHo(), nguoi: nguoi(), vao: { ...dau, ...them }, now: NOW });
      expect(r.ok, JSON.stringify(them)).toBe(false);
      if (!r.ok) expect(r.loi).toContain("không nhập tay");
    }
    expect((await khaiTayReferral({ actor: actorHo(), nguoi: nguoi(), vao: { ...dau, method: "LINK" }, now: NOW })).ok).toBe(false);
    expect(await dem()).toBe(0);

    const ok = await khaiTayReferral({ actor: actorHo(), nguoi: nguoi("rxt-khai", "Người Khai"), vao: dau, now: NOW });
    expect(ok.ok).toBe(true);
    const id = ok.ok ? ok.id : "";
    const v = await rf(id);
    expect(v).toMatchObject({ status: "MANUAL_REVIEW", method: "MANUAL", leadId: lead.id, partyId: h.ch.doiTac.id, campaignId: h.ch.campaign.id, membershipId: h.ch.mem.id, assetId: null, clickId: null, createdById: "rxt-khai", sourceGroupId: h.ch.nhomId, protectedUntil: null, centerId: h.k.centerId });
    expect(v.idempotencyKey).toMatch(/^kt:/);
    expect(v.evidence).toMatchObject({ ghiChu: GHI_CHU });
    expect(docSnapshotAffiliate({ affiliate: v.sourceSnapshot })).toMatchObject({ affiliateCode: h.ch.doiTac.code, campaignCode: h.ch.campaign.code });
    expect(await attr(lead.id)).toBeNull();
  });

  it("[RXT-DB-10] chống trùng: lượt sống ⇒ từ chối; hai lượt đồng thời ⇒ một dòng; sau khi lượt cũ bị TỪ CHỐI ⇒ khai lại được (khoá mới)", async () => {
    const h = await dung("b1");
    const lead = await taoLead(h);
    const dau = { partyId: h.ch.doiTac.id, campaignId: h.ch.campaign.id, leadId: lead.id, method: "OFFLINE", lyDo: LY_DO, ghiChu: GHI_CHU };
    const song = await Promise.all([0, 1].map((i) => khaiTayReferral({ actor: actorHo(), nguoi: nguoi(`rxt-k${i}`), vao: dau, now: NOW })));
    expect(song.filter((r) => r.ok)).toHaveLength(1);
    const thua = song.find((r) => !r.ok);
    expect(thua && !thua.ok ? thua.loi : "").toMatch(/đang chờ xử lý|vừa được người khác ghi/);
    expect(await db.affiliateReferral.count({ where: { leadId: lead.id } })).toBe(1);

    const r1 = song.find((r) => r.ok);
    const id1 = r1 && r1.ok ? r1.id : "";
    // mọi trạng thái SỐNG đều chặn: MANUAL_REVIEW (trên), DISPUTED và VALID (dưới)
    expect((await xuLy(id1, "DANH_DAU_TRANH_CHAP")).ok).toBe(true);
    expect((await khaiTayReferral({ actor: actorHo(), nguoi: nguoi(), vao: { ...dau, method: "MANUAL" }, now: NOW })).ok).toBe(false); // khác cách đến vẫn là cùng bộ ba
    expect((await xuLy(id1, "TU_CHOI")).ok).toBe(true);
    const lai = await khaiTayReferral({ actor: actorHo(), nguoi: nguoi(), vao: dau, now: NOW });
    expect(lai.ok).toBe(true);
    const keys = (await db.affiliateReferral.findMany({ where: { leadId: lead.id }, select: { idempotencyKey: true } })).map((x) => x.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  it("[RXT-DB-11] khai tay chặn: tự giới thiệu · thành viên ngừng · campaign hết hạn · chưa là thành viên · campaign chưa cấu hình nguồn", async () => {
    const chay = async (h: Hien, leadId: string, mong: RegExp) => {
      const r = await khaiTayReferral({ actor: actorHo(), nguoi: nguoi(), vao: { partyId: h.ch.doiTac.id, campaignId: h.ch.campaign.id, leadId, method: "OFFLINE", lyDo: LY_DO, ghiChu: GHI_CHU }, now: NOW });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.loi).toMatch(mong);
      expect(await db.affiliateReferral.count({ where: { leadId } })).toBe(0);
    };
    // tự giới thiệu: SĐT của đối tác = SĐT của khách (dạng khác nhau 0… / 84…) và campaign KHÔNG cho phép
    const a = await dung("c1");
    const la = await taoLead(a, { phone: "84988777666" });
    await chay(a, la.id, /cùng một người/);
    // đối chứng dương: campaign CHO PHÉP tự giới thiệu ⇒ khai được
    await db.affiliateCampaign.update({ where: { id: a.ch.campaign.id }, data: { allowSelfReferral: true } });
    expect((await khaiTayReferral({ actor: actorHo(), nguoi: nguoi(), vao: { partyId: a.ch.doiTac.id, campaignId: a.ch.campaign.id, leadId: la.id, method: "OFFLINE", lyDo: LY_DO, ghiChu: GHI_CHU }, now: NOW })).ok).toBe(true);

    const b = await dung("c2");
    await db.affiliateMembership.update({ where: { id: b.ch.mem.id }, data: { status: "SUSPENDED" } });
    await chay(b, (await taoLead(b)).id, /thành viên/);

    const c = await dung("c3");
    await db.affiliateCampaign.update({ where: { id: c.ch.campaign.id }, data: { effectiveTo: new Date("2026-10-01T00:00:00.000Z") } });
    await chay(c, (await taoLead(c)).id, /hết hạn/);

    const d = await dung("c4");
    await db.affiliateMembership.delete({ where: { id: d.ch.mem.id } }).catch(async () => {
      await db.affiliateTrackingAsset.deleteMany({ where: { membershipId: d.ch.mem.id } });
      await db.affiliateMembership.delete({ where: { id: d.ch.mem.id } });
    });
    await chay(d, (await taoLead(d)).id, /chưa là thành viên/);

    const e = await dung("c5");
    await db.affiliateCampaign.update({ where: { id: e.ch.campaign.id }, data: { defaultSourceGroupId: null } });
    await chay(e, (await taoLead(e)).id, /Chưa quy được nguồn/);
  });

  it("[RXT-DB-11b] tự giới thiệu qua TÀI KHOẢN PHỤ của đối tác (bảng nối L3a): khai tay + duyệt đều chặn như đường tự động; REVOKED hoặc không gắn ⇒ không chặn (đối chứng dương)", async () => {
    const SDT_PHU = `091${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`; // SĐT của tài khoản phụ — KHÁC SĐT đối tác (0988777666); ngẫu nhiên vì User.phone là duy nhất và người dùng thử không được dọn
    const phu = await seedUser({ email: `rxt-phu-${hau().toLowerCase()}@ci.test`, role: "PARENT", name: "Tài khoản phụ của đối tác", phone: SDT_PHU });
    const khaiTay = (h: Hien, leadId: string) =>
      khaiTayReferral({ actor: actorHo(), nguoi: nguoi(), vao: { partyId: h.ch.doiTac.id, campaignId: h.ch.campaign.id, leadId, method: "OFFLINE", lyDo: LY_DO, ghiChu: GHI_CHU }, now: NOW });

    // (1) KHAI TAY: tài khoản phụ ACTIVE trùng SĐT khách ⇒ chặn, không tạo dòng
    const a = await dung("p1");
    await db.affiliatePartyUser.create({ data: { partyId: a.ch.doiTac.id, userId: phu.id, role: "MEMBER", status: "ACTIVE" } });
    const la = await taoLead(a, { phone: SDT_PHU });
    const ra = await khaiTay(a, la.id);
    expect(ra.ok).toBe(false);
    if (!ra.ok) expect(ra.loi).toMatch(/cùng một người/);
    expect(await db.affiliateReferral.count({ where: { leadId: la.id } })).toBe(0);

    // đối chứng dương 1: tạm ngừng cổng vẫn là «người của đối tác» ⇒ vẫn chặn; đã GỠ (REVOKED) thì không còn liên quan ⇒ khai được
    await db.affiliatePartyUser.updateMany({ where: { partyId: a.ch.doiTac.id }, data: { status: "SUSPENDED", statusReason: "Tạm ngừng để kiểm thử RXT" } });
    expect((await khaiTay(a, la.id)).ok).toBe(false);
    await db.affiliatePartyUser.updateMany({ where: { partyId: a.ch.doiTac.id }, data: { status: "REVOKED", statusReason: "Gỡ để kiểm thử RXT", revokedAt: NOW } });
    expect((await khaiTay(a, la.id)).ok).toBe(true);

    // đối chứng dương 2: đối tác KHÔNG gắn tài khoản phụ nào + cùng SĐT khách ⇒ khai được
    const b = await dung("p2");
    expect((await khaiTay(b, (await taoLead(b, { phone: SDT_PHU })).id)).ok).toBe(true);

    // (2) DUYỆT: lượt khai khi chưa gắn tài khoản phụ (hợp lệ) → gắn tài khoản phụ → duyệt ⇒ chặn, KHÔNG ghi nguồn
    const c = await dung("p3");
    const lc = await taoLead(c, { phone: SDT_PHU });
    const idC = await khai(c, lc.id);
    await db.affiliatePartyUser.create({ data: { partyId: c.ch.doiTac.id, userId: phu.id, role: "MEMBER", status: "ACTIVE" } });
    const duyet = await xuLy(idC, "DUYET");
    expect(duyet.ok).toBe(false);
    expect(await attr(lc.id)).toBeNull();
    expect((await rf(idC)).status).toBe("MANUAL_REVIEW");
    // đối chứng dương 3: gỡ tài khoản phụ ⇒ duyệt được
    await db.affiliatePartyUser.updateMany({ where: { partyId: c.ch.doiTac.id }, data: { status: "REVOKED", statusReason: "Gỡ để kiểm thử RXT", revokedAt: NOW } });
    expect((await xuLy(idC, "DUYET")).ok).toBe(true);
  });

  it("[RXT-DB-12] tách nhiệm: người khai ≠ người duyệt khi còn người khác giữ quyền; không còn ai ⇒ tự duyệt có dấu vết; chính đối tác không tự duyệt", async () => {
    const h = await dung("d1");
    // một vai chỉ có quyền xử lý referral, gắn cho một người khác tại ĐÚNG đơn vị của cơ sở
    const vai = await db.roleDef.create({ data: { code: `RXT_${hau()}`, name: "RXT xử lý referral", permissions: { create: [{ action: "affiliate_referrals:manage", scopeType: "GLOBAL" }] } } });
    const nguoiKhac = await seedUser({ email: `rxt-khac-${hau().toLowerCase()}@ci.test`, role: "SALES_CSM", name: "Người khác", phone: null });
    userIds.push(nguoiKhac.id);

    const lead1 = await taoLead(h);
    const khai1 = nguoi("rxt-tu-khai", "Người Tự Khai");
    const id1 = await khai(h, lead1.id, { nguoi: khai1 });
    // CHƯA có ai khác giữ quyền tại cơ sở ⇒ cho tự duyệt, có dấu vết
    const tu = await xuLy(id1, "DUYET", { nguoi: khai1 });
    expect(tu).toMatchObject({ ok: true, tuDuyet: true });
    const sk = await db.affiliateReferralEvent.findFirstOrThrow({ where: { referralId: id1, kind: "DUYET" } });
    expect(sk.detail).toMatchObject({ tuDuyet: true });
    const kiem = await db.auditLog.findFirstOrThrow({ where: { entityType: "AffiliateReferral", entityId: id1, action: "REFERRAL_DUYET" } });
    expect(kiem.reason).toContain("tự duyệt");

    // CÓ người khác giữ quyền tại cơ sở ⇒ người khai KHÔNG tự duyệt được; người khác thì được
    await db.userOrgRole.create({ data: { userId: nguoiKhac.id, orgUnitId: h.k.ouId, roleId: vai.id, grantedById: nguoiKhac.id } });
    const lead2 = await taoLead(h);
    const id2 = await khai(h, lead2.id, { nguoi: khai1 });
    const chan = await xuLy(id2, "DUYET", { nguoi: khai1 });
    expect(chan.ok).toBe(false);
    if (!chan.ok) expect(chan.loi).toContain("do chính bạn khai");
    expect((await rf(id2)).status).toBe("MANUAL_REVIEW");
    expect(await attr(lead2.id)).toBeNull();
    expect((await xuLy(id2, "DUYET", { nguoi: nguoi(nguoiKhac.id, "Người khác") })).ok).toBe(true);
    // tách nhiệm CHỈ áp cho DUYỆT: người khai vẫn từ chối / xin bằng chứng được lượt của mình
    const lead3 = await taoLead(h);
    const id3 = await khai(h, lead3.id, { nguoi: khai1 });
    expect((await xuLy(id3, "XIN_BANG_CHUNG", { nguoi: khai1, lyDo: "Tự ghi nhớ cần thêm biên nhận" })).ok).toBe(true);

    // chính ĐỐI TÁC (tài khoản liên kết) không duyệt được lượt của mình, dù là người khác khai
    const taiKhoanDoiTac = await seedUser({ email: `rxt-dt-${hau().toLowerCase()}@ci.test`, role: "SALES_CSM", name: "Tài khoản đối tác", phone: null });
    userIds.push(taiKhoanDoiTac.id);
    await db.affiliate.update({ where: { id: h.ch.doiTac.id }, data: { userId: taiKhoanDoiTac.id } });
    const lead4 = await taoLead(h);
    const id4 = await khai(h, lead4.id, { nguoi: khai1 });
    const tuHuong = await xuLy(id4, "DUYET", { nguoi: nguoi(taiKhoanDoiTac.id, "Đối tác") });
    expect(tuHuong.ok).toBe(false);
    if (!tuHuong.ok) expect(tuHuong.loi).toContain("chính đối tác");
    expect(await attr(lead4.id)).toBeNull();
  });

  it("[RXT-DB-13] cách ly cơ sở: CS1 không xử lý / khai tay / đọc lịch sử của CS2; `centerId NULL` chỉ Hội sở; đối chứng dương CS1 xử lý được CS1", async () => {
    const h1 = await dung("e1");
    const h2 = await dung("e2");
    const cs1 = actorCoSo([h1.k.centerId]);
    const lead1 = await taoLead(h1);
    const lead2 = await taoLead(h2);
    const leadNull = await taoLead(h1, { centerId: null });
    const id1 = await khai(h1, lead1.id);
    const id2 = await khai(h2, lead2.id);
    const idNull = await khai(h1, leadNull.id);
    expect((await rf(idNull)).centerId).toBeNull();

    // CS1 KHÔNG xử lý được CS2 và dòng NULL; câu trả lời y hệt «không tìm thấy», 0 thay đổi
    for (const id of [id2, idNull]) {
      const truoc = await rf(id);
      const nTruoc = await nSuKien(id);
      for (const hd of ["DUYET", "TU_CHOI", "XIN_BANG_CHUNG"] as const) {
        const r = await xuLy(id, hd, { actor: cs1 });
        expect(r.ok, `${id}/${hd}`).toBe(false);
        if (!r.ok) expect(r.loi).toBe("Không tìm thấy lượt giới thiệu này.");
      }
      expect({ s: (await rf(id)).status, u: (await rf(id)).updatedAt.getTime(), n: await nSuKien(id) }).toEqual({ s: truoc.status, u: truoc.updatedAt.getTime(), n: nTruoc });
    }
    expect(await docLichSuReferral(cs1, id2)).toEqual([]);
    expect((await docLichSuReferral(actorHo(), id2)).length).toBe(1); // đối chứng: Hội sở thấy
    expect(await docLichSuReferral(cs1, idNull)).toEqual([]);

    // khai tay cho phiếu của cơ sở khác ⇒ PHIEU_KHONG_TIM_THAY, không dòng nào
    const r = await khaiTayReferral({ actor: cs1, nguoi: nguoi(), vao: { partyId: h2.ch.doiTac.id, campaignId: h2.ch.campaign.id, leadId: lead2.id, method: "OFFLINE", lyDo: LY_DO, ghiChu: GHI_CHU }, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi).toContain("phiếu khách");
    expect(await db.affiliateReferral.count({ where: { leadId: lead2.id } })).toBe(1); // chỉ dòng Hội sở khai ở trên

    // số chờ «Cần xem tay» (pill + chip) là CON SỐ của chính cơ sở này: 1 lượt đang chờ; duyệt xong thì tụt về 0 (R4: sau hành động, số chờ cập nhật)
    expect(await demReferralCanXemTay(cs1)).toBe(1);
    // đối chứng dương: CS1 xử lý được lượt của CS1 (cả khai tay lẫn duyệt) và đọc được lịch sử của nó
    expect((await xuLy(id1, "DUYET", { actor: cs1 })).ok).toBe(true);
    expect((await docLichSuReferral(cs1, id1)).map((d) => d.loai)).toEqual(["KHAI_TAY", "DUYET"]);
    expect(await demReferralCanXemTay(cs1)).toBe(0);
    const lead1b = await taoLead(h1);
    expect((await khaiTayReferral({ actor: cs1, nguoi: nguoi(), vao: { partyId: h1.ch.doiTac.id, campaignId: h1.ch.campaign.id, leadId: lead1b.id, method: "OFFLINE", lyDo: LY_DO, ghiChu: GHI_CHU }, now: NOW })).ok).toBe(true);
    // Hội sở xử lý được dòng NULL
    expect((await xuLy(idNull, "TU_CHOI", { actor: actorHo() })).ok).toBe(true);
  });

  it("[RXT-DB-13b] DUYỆT khi phiếu khách đã chuyển sang cơ sở KHÁC ⇒ từ chối, KHÔNG ghi nguồn vào phiếu của cơ sở khác (scopedDb không che write); đối chứng dương: Hội sở duyệt được", async () => {
    const h1 = await dung("e3");
    const h2 = await dung("e4");
    const cs1 = actorCoSo([h1.k.centerId]);
    const lead = await taoLead(h1);
    const id = await khai(h1, lead.id); // referral.centerId = cơ sở 1 (chép từ phiếu lúc khai)
    expect((await rf(id)).centerId).toBe(h1.k.centerId);
    await db.lead.update({ where: { id: lead.id }, data: { centerId: h2.k.centerId } }); // phiếu CHUYỂN sang cơ sở 2

    const r = await xuLy(id, "DUYET", { actor: cs1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi).toContain("ngoài cơ sở");
    expect(await attr(lead.id)).toBeNull();
    expect({ s: (await rf(id)).status, n: await nSuKien(id) }).toEqual({ s: "MANUAL_REVIEW", n: 1 });
    // từ chối / xin bằng chứng KHÔNG đụng phiếu khách ⇒ cơ sở 1 vẫn xử lý được lượt của mình
    expect((await xuLy(id, "XIN_BANG_CHUNG", { actor: cs1, lyDo: "Cần xác nhận phiếu đã chuyển cơ sở" })).ok).toBe(true);
    // đối chứng dương: Hội sở thấy cả hai cơ sở ⇒ duyệt được
    expect((await xuLy(id, "DUYET")).ok).toBe(true);
    expect((await attr(lead.id))?.referrerAffiliateId).toBe(h1.ch.doiTac.id);
  });

  it("[RXT-DB-14] mỗi hành động đúng 1 sự kiện + 1 AuditLog; previousReason giữ lý do cũ; sự kiện BẤT BIẾN; FK Restrict giữ referral", async () => {
    const h = await dung("f1");
    const lead = await taoLead(h);
    const id = await khai(h, lead.id, { nguoi: nguoi("rxt-khai", "Người Khai") });
    const lyDoTruoc = (await rf(id)).resolutionReason;
    expect(lyDoTruoc).toContain("Khai tay, chờ duyệt");

    await xuLy(id, "DANH_DAU_TRANH_CHAP", { lyDo: "Hai đối tác cùng nhận là người giới thiệu" });
    await xuLy(id, "TU_CHOI", { lyDo: "Không đủ căn cứ sau khi đối chiếu", nguoi: nguoi("rxt-duyet", "Người Duyệt") });
    const ls = await docLichSuReferral(actorHo(), id);
    expect(ls.map((d) => [d.loai, d.tu, d.den])).toEqual([
      ["KHAI_TAY", null, "MANUAL_REVIEW"],
      ["DANH_DAU_TRANH_CHAP", "MANUAL_REVIEW", "DISPUTED"],
      ["TU_CHOI", "DISPUTED", "REJECTED"],
    ]);
    expect(ls[1]).toMatchObject({ lyDo: "Hai đối tác cùng nhận là người giới thiệu", lyDoTruoc: lyDoTruoc, ghiChu: GHI_CHU, nguoi: "Người Duyệt B" });
    expect(ls[2]!.lyDoTruoc).toContain("Tranh chấp");

    const audits = await db.auditLog.findMany({ where: { entityType: "AffiliateReferral", entityId: id }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => a.action)).toEqual(["REFERRAL_KHAI_TAY", "REFERRAL_DANH_DAU_TRANH_CHAP", "REFERRAL_TU_CHOI"]);
    expect(audits[1]).toMatchObject({ actorId: "rxt-nguoi-b", reason: "Hai đối tác cùng nhận là người giới thiệu", module: "nguon-hoa-hong" });

    // Cột cơ sở của sự kiện = của referral, ĐỦ cả hai (bảng chỉ-thêm không để script backfill UPDATE orgUnitId đụng trigger)
    const goc = await rf(id);
    expect(goc.orgUnitId).not.toBeNull();
    const dongSk = await db.affiliateReferralEvent.findMany({ where: { referralId: id }, select: { centerId: true, orgUnitId: true } });
    expect(dongSk).toHaveLength(3);
    for (const d of dongSk) expect(d).toEqual({ centerId: goc.centerId, orgUnitId: goc.orgUnitId });

    // Bất biến: trigger chặn UPDATE / DELETE; FK Restrict giữ referral; CHECK lý do ≥ 10 ký tự.
    const sk = ls[0]!.id;
    await expect(db.affiliateReferralEvent.update({ where: { id: sk }, data: { reason: "đã sửa im lặng nhé" } })).rejects.toThrow(/chỉ-thêm/);
    await expect(db.affiliateReferralEvent.delete({ where: { id: sk } })).rejects.toThrow(/chỉ-thêm/);
    await expect(db.affiliateReferral.delete({ where: { id } })).rejects.toThrow();
    await expect(
      db.affiliateReferralEvent.create({ data: { referralId: id, kind: "DUYET", toStatus: "VALID", reason: "ngắn", actorId: "x", actorName: "x" } }),
    ).rejects.toThrow(/ly_do_chk/);
    expect(await nSuKien(id)).toBe(3);
  });

  it("[RXT-DB-15] xin / bổ sung bằng chứng GIỮ trạng thái, đẩy mốc updatedAt; `dangChoBangChung` đúng theo nhật ký; bổ sung đòi ghi chú", async () => {
    const h = await dung("g1");
    const lead = await taoLead(h);
    const id = await khai(h, lead.id);
    const m0 = (await rf(id)).updatedAt.getTime();
    const loai = async () => (await docLichSuReferral(actorHo(), id)).map((d) => ({ loai: d.loai }));

    expect(dangChoBangChung(await loai())).toBe(false);
    // XIN cũng đòi ghi chú bằng chứng (căn cứ của lời xin) — thiếu thì chặn và KHÔNG đổi gì
    expect((await xuLy(id, "XIN_BANG_CHUNG", { lyDo: "Cần biên nhận gốc của sự kiện", ghiChu: null })).ok).toBe(false);
    expect(await nSuKien(id)).toBe(1);
    expect(dangChoBangChung(await loai())).toBe(false);
    expect(await xuLy(id, "XIN_BANG_CHUNG", { lyDo: "Cần biên nhận gốc của sự kiện" })).toMatchObject({ ok: true, den: "MANUAL_REVIEW" });
    expect((await rf(id)).status).toBe("MANUAL_REVIEW");
    expect((await rf(id)).updatedAt.getTime()).toBeGreaterThan(m0);
    expect((await rf(id)).resolutionReason).toContain("Khai tay, chờ duyệt"); // XIN không ghi đè lý do hiện tại
    expect(dangChoBangChung(await loai())).toBe(true);

    const thieu = await xuLy(id, "BO_SUNG_BANG_CHUNG", { ghiChu: null });
    expect(thieu.ok).toBe(false);
    expect(await xuLy(id, "BO_SUNG_BANG_CHUNG", { lyDo: "Đã nhận biên nhận gốc từ cán bộ Lan" })).toMatchObject({ ok: true, den: "MANUAL_REVIEW" });
    expect(dangChoBangChung(await loai())).toBe(false);
    // tranh chấp không tự đóng yêu cầu bằng chứng: xin lại → tranh chấp → vẫn chờ
    await xuLy(id, "XIN_BANG_CHUNG", { lyDo: "Cần thêm xác nhận của người tổ chức" });
    await xuLy(id, "DANH_DAU_TRANH_CHAP", { lyDo: "Có hai bên cùng nhận giới thiệu" });
    expect(dangChoBangChung(await loai())).toBe(true);
  });

  it("[RXT-DB-16] lượt TỰ ĐỘNG cần xem tay (nguồn là chỗ giữ, Origin lệch) ⇒ duyệt giải LẠI nguồn từ cấu hình, giữ Origin gốc trong bản chụp", async () => {
    const h = await dung("h1");
    const lead = await taoLead(h);
    const cho = await nhomChoId();
    const sn = { affiliateCode: h.ch.doiTac.code, campaignCode: h.ch.campaign.code, method: "LINK", typeCode: null, tagCodes: [], origin: "LECH" };
    const r = await db.affiliateReferral.create({
      data: { partyId: h.ch.doiTac.id, membershipId: h.ch.mem.id, campaignId: h.ch.campaign.id, assetId: h.ch.asset.id, method: "LINK", status: "MANUAL_REVIEW", sourceGroupId: cho, sourceSnapshot: sn, leadId: lead.id, resolutionReason: "Biểu mẫu gửi từ tên miền ngoài danh sách website của link giới thiệu.", idempotencyKey: `rxt-auto-${hau().toLowerCase()}-x`, centerId: h.k.centerId },
    });
    expect(await xuLy(r.id, "DUYET")).toMatchObject({ ok: true, den: "VALID", nhanhGhiNguon: "TAO_MOI" });
    const v = await rf(r.id);
    expect(v.sourceGroupId).toBe(h.ch.nhomId); // KHÔNG còn là chỗ giữ
    expect(docSnapshotAffiliate({ affiliate: v.sourceSnapshot })).toMatchObject({ tu: "MAC_DINH_CAMPAIGN" });
    expect((v.sourceSnapshot as Record<string, unknown>).origin).toBe("LECH");
    expect((await attr(lead.id))!.groupId).toBe(h.ch.nhomId);
    const sk = (await docLichSuReferral(actorHo(), r.id))[0]!;
    expect(sk.loai).toBe("DUYET");
    expect(sk.lyDoTruoc).toContain("tên miền ngoài");
  });

  it("[RXT-DB-17] duyệt FAIL-CLOSED khi chuỗi hết hợp lệ hôm nay: campaign hết hạn / thành viên ngừng / chưa cấu hình nguồn ⇒ từ chối, y nguyên", async () => {
    const mau: [string, (h: Hien) => Promise<unknown>, RegExp][] = [
      ["campaign hết hạn", (h) => db.affiliateCampaign.update({ where: { id: h.ch.campaign.id }, data: { effectiveTo: new Date("2026-10-01T00:00:00.000Z") } }), /hết hạn/],
      ["thành viên ngừng", (h) => db.affiliateMembership.update({ where: { id: h.ch.mem.id }, data: { status: "SUSPENDED" } }), /thành viên/],
      ["chưa cấu hình nguồn", (h) => db.affiliateCampaign.update({ where: { id: h.ch.campaign.id }, data: { defaultSourceGroupId: null } }), /Chưa quy được nguồn/],
    ];
    for (const [ten, hong, mong] of mau) {
      const h = await dung("i1");
      const lead = await taoLead(h);
      const id = await khai(h, lead.id);
      await hong(h);
      const r = await xuLy(id, "DUYET");
      expect(r.ok, ten).toBe(false);
      if (!r.ok) expect(r.loi, ten).toMatch(mong);
      expect((await rf(id)).status, ten).toBe("MANUAL_REVIEW");
      expect(await attr(lead.id), ten).toBeNull();
      expect(await nSuKien(id), ten).toBe(1);
    }
  });

  it("[RXT-DB-18] ô tìm phiếu: theo MÃ ai cũng tìm (chỉ mã); tên cần xem khách; SĐT cần xem PII; luôn che; cách ly cơ sở", async () => {
    const h1 = await dung("j1");
    const h2 = await dung("j2");
    const phone = "0907555123";
    const lead1 = await taoLead(h1, { phone });
    const lead2 = await taoLead(h2, { phone });
    const ma = lead1.id.slice(-6);
    const cs1 = actorCoSo([h1.k.centerId]);

    // chỉ có quyền xử lý (không xem khách): tìm theo MÃ → thấy mã, KHÔNG tên/SĐT; tìm theo tên/SĐT → rỗng
    const q0 = { xemKhach: false, xemPii: false };
    const theoMa = await timPhieuKhaiTay(cs1, ma, q0);
    expect(theoMa.map((x) => x.id)).toContain(lead1.id);
    expect(theoMa.find((x) => x.id === lead1.id)).toMatchObject({ ten: null, sdt: null });
    expect(await timPhieuKhaiTay(cs1, "Nguyễn Thị", q0)).toEqual([]);
    expect(await timPhieuKhaiTay(cs1, phone, q0)).toEqual([]);

    // xem được khách: tìm theo tên → thấy, ĐÃ CHE; SĐT vẫn rỗng (cần PII)
    const q1 = { xemKhach: true, xemPii: false };
    const theoTen = await timPhieuKhaiTay(cs1, "Nguyễn Thị", q1);
    expect(theoTen.map((x) => x.id)).toContain(lead1.id);
    expect(theoTen.every((x) => x.ten !== LEAD_TEN)).toBe(true); // tên đã che
    expect(JSON.stringify(theoTen)).not.toContain(phone);
    expect(await timPhieuKhaiTay(cs1, phone, q1)).toEqual([]);

    // xem PII: tìm SĐT được; hiển thị đầy đủ theo quyền
    const q2 = { xemKhach: true, xemPii: true };
    const theoSdt = await timPhieuKhaiTay(cs1, phone, q2);
    expect(theoSdt.map((x) => x.id)).toContain(lead1.id);
    expect(theoSdt.find((x) => x.id === lead1.id)?.ten).toBe(LEAD_TEN);
    // xemPii mà KHÔNG xem khách ⇒ không có chuyện tìm SĐT (bất biến một chỗ)
    expect(await timPhieuKhaiTay(cs1, phone, { xemKhach: false, xemPii: true })).toEqual([]);

    // cách ly: CS1 không thấy phiếu của CS2 dù cùng SĐT; Hội sở thấy cả hai (đối chứng dương)
    expect(theoSdt.map((x) => x.id)).not.toContain(lead2.id);
    expect((await timPhieuKhaiTay(actorHo(), phone, q2)).map((x) => x.id)).toEqual(expect.arrayContaining([lead1.id, lead2.id]));
    // q ngắn ⇒ rỗng
    expect(await timPhieuKhaiTay(actorHo(), "ab", q2)).toEqual([]);
  });

  it("[RXT-DB-19] lý do / ghi chú: < 10 ký tự và PII bị từ chối, KHÔNG ghi gì (cả xử lý lẫn khai tay)", async () => {
    const h = await dung("k1");
    const lead = await taoLead(h);
    const id = await khai(h, lead.id);
    const truoc = { r: (await rf(id)).updatedAt.getTime(), n: await nSuKien(id) };
    for (const [lyDo, ghiChu] of [
      ["ngắn", GHI_CHU],
      [LY_DO, "ngắn"],
      [LY_DO, "Khách gọi từ số 0907 111 222 xác nhận"],
      ["Email khach@example.com xác nhận", GHI_CHU],
    ] as const) {
      const r = await xuLy(id, "DUYET", { lyDo, ghiChu });
      expect(r.ok, `${lyDo}|${ghiChu}`).toBe(false);
    }
    expect({ r: (await rf(id)).updatedAt.getTime(), n: await nSuKien(id) }).toEqual(truoc);
    expect(await attr(lead.id)).toBeNull();

    const lead2 = await taoLead(h);
    const kt = await khaiTayReferral({ actor: actorHo(), nguoi: nguoi(), vao: { partyId: h.ch.doiTac.id, campaignId: h.ch.campaign.id, leadId: lead2.id, method: "OFFLINE", lyDo: LY_DO, ghiChu: "Số 0907111222 của khách" }, now: NOW });
    expect(kt.ok).toBe(false);
    expect(await db.affiliateReferral.count({ where: { leadId: lead2.id } })).toBe(0);
  });
});
