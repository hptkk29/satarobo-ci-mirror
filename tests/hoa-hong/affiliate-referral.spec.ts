// @vitest-environment node
/**
 * [RFD-DB-*] — TAB REFERRAL trên Postgres THẬT (`lib/affiliate/doc-referral.ts`; AFF-P1). Mọi dòng do test TẠO mang tiền tố `FXAFR` / `fxafr`.
 *
 *   [RFD-DB-01] CÁCH LY: actor cấp CS1 chỉ thấy referral của CS1 — KHÔNG thấy CS2, KHÔNG thấy dòng `centerId NULL`; Hội sở thấy cả ba (đối chứng dương); không có cơ sở nào ⇒ không thấy gì
 *   [RFD-DB-02] CHI TIẾT cách ly (IDOR): dòng cơ sở khác / dòng NULL ⇒ null với actor cấp CS; Hội sở mở được cả hai
 *   [RFD-DB-03] ĐẾM CHIP khớp danh sách: theoTrangThai[t] = tổng khi lọc t, mọi t; Σ chip = tổng không lọc; đếm CÓ scope (không phải tổng toàn hệ thống) — dòng CÙNG trạng thái ở cơ sở khác
 *   [RFD-DB-04] `demReferralCanXemTay` = đếm MANUAL_REVIEW trong tầm nhìn (cùng số với chip); Hội sở thấy nhiều hơn
 *   [RFD-DB-05] KHÔNG RÒ PII: toàn bộ JSON của danh sách + chi tiết không chứa tên/SĐT (dạng 0… lẫn 84…)/email khách, không chứa evidence, không chứa khoá lạ trong snapshot, không chứa token
 *   [RFD-DB-06] `leadId` chỉ xuống khi MỞ ĐƯỢC phiếu: coTheMoLead=false ⇒ null; phiếu ở cơ sở ngoài tầm (lead đã chuyển cơ sở) ⇒ null; phiếu đã xoá mềm ⇒ null; đối chứng dương ⇒ có id
 *   [RFD-DB-07] «Nguồn đã giải» nói thật: có bậc quyết định ⇒ tên nhóm (kể cả REJECTED_DUPLICATE); không có ⇒ null dù cột trỏ vào một nhóm có tên thật
 *   [RFD-DB-08] phân trang: 27 dòng ⇒ 25 + 2, mới nhất trước, trang vượt biên rỗng nhưng tổng đúng; lọc trạng thái + phân trang cùng nhau
 *   [RFD-DB-09] `phamVi`: Hội sở TAT_CA, cấp cơ sở GIOI_HAN
 *   [RFD-DB-10] page.tsx dựng bằng dữ liệu thật: chip + số, nút CHỈ khi có `:manage` (AFF-L3b), chú thích «chưa quy được cơ sở» CHỈ cho cấp cơ sở, liên kết phiếu theo quyền, thiếu quyền, bộ lọc rác, kẹp trang, rỗng; HTML không chứa PII
 *   [RFD-DB-11] trang chi tiết dựng bằng dữ liệu thật: nội dung đủ bốn mục, 404 cho dòng cơ sở khác / dòng NULL (cấp cơ sở) / id rác / `%` hỏng; Hội sở mở được dòng NULL
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng fixture, chạy ĐƯỢC MỘT MÌNH. LUẬT 19: ngày TUYỆT ĐỐI; `Date.now()` chỉ để tạo hậu tố mã duy nhất, không bao giờ để so sánh.
 * AN TOÀN DB: không `resetDb()` — dọn THEO TIỀN TỐ. Cổng địa chỉ riêng (`assertDbThu`): Postgres trên máy này, không phải tunnel VPS, không phải DB của dev server.
 * Số tuyệt đối chỉ dùng cho actor cấp CS trên cơ sở fixture (id duy nhất); với Hội sở / dòng NULL chỉ khẳng định SỰ CÓ MẶT của id fixture — DB dùng chung có thể còn referral của bộ khác.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

// [RFD-DB-10/11] dựng CHÍNH page.tsx bằng dữ liệu Postgres thật: cổng vào (vaoTab), hàng chờ của khung và câu hỏi «mở được phiếu khách không» được thay bằng bản giả có kiểm soát; hàm đọc, scopedDb, component chạy thật.
const TRANG = vi.hoisted(() => ({ vaoTab: vi.fn(), coTheMoLead: true }));
vi.mock("../../app/(admin)/admin/nguon-hoa-hong/_lib/vao-tab", () => ({ vaoTab: (...a: unknown[]) => TRANG.vaoTab(...a) }));
vi.mock("@/lib/nguon-hoa-hong/hang-cho", () => ({ docSoHangChoTheoTab: async () => ({}) }));
vi.mock("@/lib/auth/check-permission", () => ({ checkAnyPermission: async () => TRANG.coTheMoLead }));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    throw new Error(`REDIRECT:${u}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => React.createElement("a", { href, ...rest }, children),
}));

import ReferralPage from "../../app/(admin)/admin/nguon-hoa-hong/referral/page";
import ChiTietReferralPage from "../../app/(admin)/admin/nguon-hoa-hong/referral/[id]/page";
import type { Actor } from "../../lib/auth/actor";
import { dungNguonHoaHongScope, type ModuleKey } from "../../lib/nguon-hoa-hong/scope";
import { db } from "../../lib/db";
import { laDbCucBo } from "../../lib/security/url-db-cuc-bo";
import { LY_DO_BO_QUA, RUN_DB_TESTS } from "../_helpers/db-gate";
import { sinhToken } from "../../lib/affiliate/token";
import { KICH_THUOC_TRANG_REFERRAL, demReferralCanXemTay, docChiTietReferral, docDanhSachReferral } from "../../lib/affiliate/doc-referral";
import { TRANG_THAI_REFERRAL, tongCacTrangThai, type TrangThaiReferral } from "../../lib/affiliate/ghi-referral-dau-vao";

if (!RUN_DB_TESTS) console.warn(`[RFD-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "fxafr";
const MA = "FXAFR";
const GOC = new Date("2026-10-13T03:00:00.000Z");

// Thông tin khách — chuỗi ĐẶC TRƯNG, không được xuất hiện ở bất kỳ payload hay HTML nào của màn.
const KHACH = { ten: `${P}-ph-Nguyễn Thị Khách`, sdt: "0907111222", sdt84: "84907111222", sdtCach: "0907 111 222", email: `khach.${P}@example.com`, bangChung: "BANG-CHUNG-RIENG-TU-0907111222" };

let dem = 0;
const hau = () => `${Date.now().toString(36).toUpperCase()}${(dem += 1)}`;

async function assertDbThu(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!laDbCucBo(url)) throw new Error("[RFD-DB] TỪ CHỐI: DATABASE_URL không trỏ Postgres cục bộ (hoặc là tunnel VPS).");
  const r = await db.$queryRaw<{ ten: string }[]>`select current_database() as ten`;
  const ten = r[0]?.ten ?? "";
  if (/^(satarobo_local|satarobo_dev)/.test(ten)) throw new Error(`[RFD-DB] TỪ CHỐI: database "${ten}" là DB đang phục vụ dev server.`);
}

async function don(): Promise<void> {
  const ds = await db.affiliate.findMany({ where: { code: { startsWith: MA } }, select: { id: true } });
  const ids = ds.map((x) => x.id);
  await db.affiliateReferral.deleteMany({ where: { partyId: { in: ids } } }); // Restrict ⇒ xoá TRƯỚC lead / đối tác / campaign
  await db.lead.deleteMany({ where: { parentName: { startsWith: P } } });
  await db.affiliateTrackingAsset.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliateMembership.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliate.deleteMany({ where: { id: { in: ids } } });
  await db.affiliateCampaign.deleteMany({ where: { code: { startsWith: MA } } });
  await db.affiliateSite.deleteMany({ where: { code: { startsWith: MA } } });
  await db.affiliateTag.deleteMany({ where: { code: { startsWith: MA } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: MA } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: MA } } });
  await db.center.deleteMany({ where: { id: { startsWith: P } } });
}

// ── fixture ─────────────────────────────────────────────────────────────────────────────────────────
const taoCoSo = (ten: string) => db.center.create({ data: { id: `${P}-${ten}-${hau()}`.toLowerCase(), name: `Cơ sở ${ten}`, slug: `${P}-${ten}-${hau()}`.toLowerCase(), address: "x", isActive: true } });

type Nen = { assetId: string; partyId: string; membershipId: string; campaignId: string; nguonId: string; giuId: string; tenNguon: string; tenDoiTac: string; tenCampaign: string; maCampaign: string };
/** Một đối tác + campaign + membership + hai nhóm nguồn (một «đã giải» có tên thật, một «giữ chỗ» cũng có tên thật). */
async function taoNen(nhan: string): Promise<Nen> {
  const h = hau();
  const tenNguon = `Nguồn ${P} ${nhan} ${h}`;
  const nguon = await db.leadSourceGroup.create({ data: { code: `${MA}_G${h}`, name: tenNguon, sourceType: "PARTNER", referrerRequirement: "NONE", sortOrder: 900, status: "ACTIVE", selectable: true } });
  const giu = await db.leadSourceGroup.create({ data: { code: `${MA}_K${h}`, name: `Giữ chỗ ${P} ${nhan} ${h}`, sourceType: "OTHER", referrerRequirement: "NONE", sortOrder: 901, status: "ACTIVE", selectable: false } });
  const tenDoiTac = `Đối tác ${P} ${nhan} ${h}`;
  const party = await db.affiliate.create({ data: { code: `${MA}_P${h}`, name: tenDoiTac, phone: "0988000111", email: `doitac.${P}@example.com` } });
  const tenCampaign = `Campaign ${P} ${nhan} ${h}`;
  const campaign = await db.affiliateCampaign.create({ data: { code: `${MA}_C${h}`, name: tenCampaign, status: "ACTIVE", effectiveFrom: new Date("2026-10-01T00:00:00.000Z") } });
  const membership = await db.affiliateMembership.create({ data: { partyId: party.id, campaignId: campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-10-01T00:00:00.000Z") } });
  const site = await db.affiliateSite.create({ data: { code: `${MA}_S${h}`, name: `Website ${P} ${h}`, baseUrl: `https://${h.toLowerCase()}.fxafr.test`, allowedDomains: [`${h.toLowerCase()}.fxafr.test`], status: "ACTIVE", trackingEnabled: true } });
  const asset = await db.affiliateTrackingAsset.create({ data: { partyId: party.id, membershipId: membership.id, campaignId: campaign.id, siteId: site.id, landingPath: "/khoa-hoc/robot", publicToken: sinhToken(), type: "LINK", status: "ACTIVE" } });
  return { assetId: asset.id, partyId: party.id, membershipId: membership.id, campaignId: campaign.id, nguonId: nguon.id, giuId: giu.id, tenNguon, tenDoiTac, tenCampaign, maCampaign: campaign.code };
}

const taoLead = (centerId: string | null, ghi: Partial<{ deletedAt: Date }> = {}) =>
  db.lead.create({ data: { parentName: KHACH.ten, phone: KHACH.sdt, email: KHACH.email, ...(centerId ? { centerId } : {}), ...ghi } });

const SN_CO_BAC = { affiliateCode: "X", campaignCode: "Y", method: "LINK", typeCode: null, tagCodes: [], tu: "MAC_DINH_CAMPAIGN", tuNhan: "Nguồn mặc định của campaign", origin: "KHOP" };
const SN_KHONG_BAC = { affiliateCode: "X", campaignCode: "Y", method: "LINK", typeCode: null, tagCodes: [], origin: "VANG" };

type Hat = Partial<{ status: TrangThaiReferral; centerId: string | null; leadId: string | null; snapshot: Record<string, unknown>; lyDo: string | null; evidence: Record<string, unknown>; phut: number; dungNguon: boolean }>;
/** Tạo MỘT dòng referral bằng Prisma trực tiếp. `phut` lùi `createdAt` so với mốc GOC (ngày tuyệt đối). */
async function taoRf(nen: Nen, h: Hat = {}) {
  const status = h.status ?? "VALID";
  // CHECK của migration: VALID luôn có lead; REJECTED/REJECTED_DUPLICATE luôn có `rejectedAt` (và ngược lại). Fixture tuân thủ như đường ghi thật.
  const leadId = h.leadId !== undefined ? h.leadId : status === "VALID" ? (await taoLead(h.centerId ?? null)).id : null;
  const luc = new Date(GOC.getTime() - (h.phut ?? 0) * 60_000);
  return db.affiliateReferral.create({
    data: {
      partyId: nen.partyId,
      membershipId: nen.membershipId,
      campaignId: nen.campaignId,
      assetId: nen.assetId,
      method: "LINK",
      status,
      rejectedAt: status === "REJECTED" || status === "REJECTED_DUPLICATE" ? luc : null,
      // «giữ chỗ» = nhóm mà cột NOT NULL buộc phải trỏ vào khi lượt không được quyết hợp lệ
      sourceGroupId: h.dungNguon ? nen.nguonId : nen.giuId,
      sourceSnapshot: (h.snapshot ?? SN_CO_BAC) as Prisma.InputJsonValue,
      ...(h.evidence ? { evidence: h.evidence as Prisma.InputJsonValue } : {}),
      leadId,
      resolutionReason: h.lyDo ?? null,
      centerId: h.centerId === undefined ? null : h.centerId,
      createdAt: luc,
    },
  });
}

const actorCoSo = (centerIds: string[]): Actor =>
  ({
    userId: `${P}-actor`,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: centerIds,
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as Actor;
const actorHoiSo = (): Actor => ({ ...actorCoSo([]), isSuperAdmin: true }) as Actor;
const actorHoLevel = (): Actor => ({ ...actorCoSo([]), isHoLevel: true }) as Actor;

const LOC = { trang: 1, kichThuoc: KICH_THUOC_TRANG_REFERRAL, trangThai: null, coTheMoLead: true } as const;
const idsCua = (r: { dong: { id: string }[] }) => r.dong.map((d) => d.id);

describe.skipIf(!RUN_DB_TESTS)("[RFD-DB] tab Referral — Postgres thật", () => {
  beforeEach(async () => {
    await assertDbThu();
    await don();
    TRANG.coTheMoLead = true;
  }, 60_000);
  afterAll(async () => {
    await don();
  }, 60_000);

  it("[RFD-DB-01] CÁCH LY: CS1 chỉ thấy CS1 (không CS2, không dòng NULL); Hội sở thấy cả ba; CS1+CS2 thấy hai; không cơ sở nào thấy 0", async () => {
    const cs1 = await taoCoSo("a1");
    const cs2 = await taoCoSo("a2");
    const nen = await taoNen("cl");
    const r1 = await taoRf(nen, { centerId: cs1.id });
    const r2 = await taoRf(nen, { centerId: cs2.id });
    const rNull = await taoRf(nen, { centerId: null });

    const c1 = await docDanhSachReferral(actorCoSo([cs1.id]), LOC);
    expect(idsCua(c1)).toEqual([r1.id]);
    expect(c1.tong).toBe(1);
    const c2 = await docDanhSachReferral(actorCoSo([cs2.id]), LOC);
    expect(idsCua(c2)).toEqual([r2.id]);
    const ca2 = await docDanhSachReferral(actorCoSo([cs1.id, cs2.id]), LOC);
    expect([...idsCua(ca2)].sort()).toEqual([r1.id, r2.id].sort());
    expect(idsCua(ca2)).not.toContain(rNull.id);
    expect((await docDanhSachReferral(actorCoSo([]), LOC)).tong).toBe(0);

    // đối chứng dương: Hội sở (siêu quản trị) và vai cấp Hội sở thấy ĐỦ ba, kể cả dòng NULL — chỉ khẳng định SỰ CÓ MẶT (DB dùng chung)
    for (const ho of [actorHoiSo(), actorHoLevel()]) {
      const r = await docDanhSachReferral(ho, { ...LOC, kichThuoc: 500 });
      for (const id of [r1.id, r2.id, rNull.id]) expect(idsCua(r)).toContain(id);
    }
    // đọc thẳng không scope thấy cả ba — vì sao scopedDb tồn tại
    expect(await db.affiliateReferral.count({ where: { id: { in: [r1.id, r2.id, rNull.id] } } })).toBe(3);
  });

  it("[RFD-DB-02] CHI TIẾT cách ly (IDOR): dòng cơ sở khác và dòng NULL ⇒ null với actor cấp CS; dòng của mình mở được; Hội sở mở cả hai", async () => {
    const cs1 = await taoCoSo("b1");
    const cs2 = await taoCoSo("b2");
    const nen = await taoNen("ct");
    const r1 = await taoRf(nen, { centerId: cs1.id });
    const r2 = await taoRf(nen, { centerId: cs2.id });
    const rNull = await taoRf(nen, { centerId: null });
    const o = { coTheMoLead: true };

    const a1 = actorCoSo([cs1.id]);
    expect((await docChiTietReferral(a1, r1.id, o))?.id).toBe(r1.id); // đối chứng dương
    expect(await docChiTietReferral(a1, r2.id, o)).toBeNull();
    expect(await docChiTietReferral(a1, rNull.id, o)).toBeNull();
    expect(await docChiTietReferral(a1, "khong-ton-tai-0123456789", o)).toBeNull();
    for (const id of [r1.id, r2.id, rNull.id]) expect((await docChiTietReferral(actorHoiSo(), id, o))?.id).toBe(id);
  });

  it("[RFD-DB-03] ĐẾM CHIP khớp danh sách ở mọi trạng thái, và đếm CÓ scope (cơ sở khác cùng trạng thái không lọt vào số)", async () => {
    const cs1 = await taoCoSo("c1");
    const cs2 = await taoCoSo("c2");
    const nen = await taoNen("dc");
    // CS1: VALID×3, MANUAL×2, REJECTED×1, DUP×1, DISPUTED×1 · CS2: cùng trạng thái, SỐ KHÁC (để đếm không-scope lệch khỏi danh sách) · NULL: MANUAL×2
    const mau: [string | null, TrangThaiReferral, number][] = [
      [cs1.id, "VALID", 3], [cs1.id, "MANUAL_REVIEW", 2], [cs1.id, "REJECTED", 1], [cs1.id, "REJECTED_DUPLICATE", 1], [cs1.id, "DISPUTED", 1],
      [cs2.id, "VALID", 5], [cs2.id, "MANUAL_REVIEW", 4], [cs2.id, "REJECTED", 2], [cs2.id, "REJECTED_DUPLICATE", 3], [cs2.id, "DISPUTED", 2],
      [null, "MANUAL_REVIEW", 2],
    ];
    for (const [centerId, status, n] of mau) for (let i = 0; i < n; i++) await taoRf(nen, { centerId, status, phut: i });

    for (const [cs, mong] of [[cs1, { VALID: 3, MANUAL_REVIEW: 2, REJECTED: 1, REJECTED_DUPLICATE: 1, DISPUTED: 1 }], [cs2, { VALID: 5, MANUAL_REVIEW: 4, REJECTED: 2, REJECTED_DUPLICATE: 3, DISPUTED: 2 }]] as const) {
      const actor = actorCoSo([cs.id]);
      const tatCa = await docDanhSachReferral(actor, LOC);
      expect(tatCa.theoTrangThai).toEqual(mong);
      expect(tongCacTrangThai(tatCa.theoTrangThai)).toBe(tatCa.tong); // «Tất cả» = Σ chip
      for (const t of TRANG_THAI_REFERRAL) {
        const loc = await docDanhSachReferral(actor, { ...LOC, trangThai: t, kichThuoc: 100 });
        expect(loc.tong, `lọc ${t}`).toBe(tatCa.theoTrangThai[t]); // bấm chip nào ra đúng chừng ấy dòng
        expect(loc.dong).toHaveLength(tatCa.theoTrangThai[t]);
        expect(loc.dong.every((d) => d.trangThai === t)).toBe(true);
      }
    }
    // Hội sở: các chip cộng đủ ít nhất mọi dòng fixture (>=, DB dùng chung)
    const ho = await docDanhSachReferral(actorHoiSo(), LOC);
    expect(ho.theoTrangThai.MANUAL_REVIEW).toBeGreaterThanOrEqual(2 + 4 + 2);
    expect(ho.theoTrangThai.VALID).toBeGreaterThanOrEqual(3 + 5);
  });

  it("[RFD-DB-04] demReferralCanXemTay = đếm MANUAL_REVIEW trong tầm nhìn, đúng số của chip; Hội sở thấy nhiều hơn cấp CS", async () => {
    const cs1 = await taoCoSo("d1");
    const cs2 = await taoCoSo("d2");
    const nen = await taoNen("xt");
    for (const [centerId, status, n] of [[cs1.id, "MANUAL_REVIEW", 2], [cs1.id, "VALID", 4], [cs2.id, "MANUAL_REVIEW", 3], [null, "MANUAL_REVIEW", 1]] as const) {
      for (let i = 0; i < n; i++) await taoRf(nen, { centerId, status });
    }
    const a1 = actorCoSo([cs1.id]);
    expect(await demReferralCanXemTay(a1)).toBe(2);
    expect((await docDanhSachReferral(a1, LOC)).theoTrangThai.MANUAL_REVIEW).toBe(2);
    expect(await demReferralCanXemTay(actorCoSo([cs2.id]))).toBe(3);
    expect(await demReferralCanXemTay(actorCoSo([cs1.id, cs2.id]))).toBe(5);
    expect(await demReferralCanXemTay(actorCoSo([]))).toBe(0);
    expect(await demReferralCanXemTay(actorHoiSo())).toBeGreaterThanOrEqual(6); // 2+3+1 fixture (+ dòng bộ khác nếu có)
  });

  it("[RFD-DB-05] KHÔNG RÒ PII: JSON của danh sách + chi tiết không chứa tên/SĐT/email khách, evidence, khoá lạ trong snapshot, hay SĐT/email của đối tác", async () => {
    const cs1 = await taoCoSo("e1");
    const nen = await taoNen("pii");
    const lead = await taoLead(cs1.id);
    const snapBan = { ...SN_CO_BAC, phone: KHACH.sdt, parentName: KHACH.ten, email: KHACH.email, leadName: KHACH.ten, token: "TOKEN_RIENG_TU_ABCDEF" };
    const rf = await taoRf(nen, { centerId: cs1.id, leadId: lead.id, snapshot: snapBan, evidence: { ghiChu: KHACH.bangChung, sdt: KHACH.sdt }, lyDo: "TU_GIOI_THIEU:SDT, EMAIL", dungNguon: true });
    const a1 = actorCoSo([cs1.id]);

    const ds = JSON.stringify(await docDanhSachReferral(a1, LOC));
    const ct = JSON.stringify(await docChiTietReferral(a1, rf.id, { coTheMoLead: true }));
    for (const [ten, json] of [["danh sách", ds], ["chi tiết", ct]] as const) {
      for (const rò of [KHACH.ten, KHACH.sdt, KHACH.sdt84, KHACH.sdtCach, KHACH.email, KHACH.bangChung, "TOKEN_RIENG_TU_ABCDEF", "0988000111", `doitac.${P}@example.com`, "evidence", "parentName", "publicToken"]) {
        expect(json, `${ten} lộ «${rò}»`).not.toContain(rò);
      }
    }
    // đối chứng dương: payload CÓ dữ liệu hữu ích (không rỗng vì lỡ tay lọc hết)
    expect(ds).toContain(nen.tenDoiTac);
    expect(ct).toContain(nen.tenCampaign);
    expect(ct).toContain("Tự giới thiệu");
  });

  it("[RFD-DB-06] `leadId` chỉ xuống khi MỞ ĐƯỢC phiếu: không quyền ⇒ null; phiếu ngoài tầm cơ sở ⇒ null; đã xoá mềm ⇒ null; đối chứng dương ⇒ có id; mã rút gọn luôn có", async () => {
    const cs1 = await taoCoSo("f1");
    const cs2 = await taoCoSo("f2");
    const nen = await taoNen("ld");
    const leadOk = await taoLead(cs1.id);
    const leadChuyen = await taoLead(cs2.id); // referral còn ghi CS1 nhưng phiếu đã chuyển sang CS2
    const leadXoa = await taoLead(cs1.id, { deletedAt: new Date("2026-10-02T00:00:00.000Z") });
    const rOk = await taoRf(nen, { centerId: cs1.id, leadId: leadOk.id, phut: 1 });
    const rChuyen = await taoRf(nen, { centerId: cs1.id, leadId: leadChuyen.id, phut: 2 });
    const rXoa = await taoRf(nen, { centerId: cs1.id, leadId: leadXoa.id, phut: 3 });
    const rKhong = await taoRf(nen, { centerId: cs1.id, status: "MANUAL_REVIEW", leadId: null, phut: 4 });
    const a1 = actorCoSo([cs1.id]);

    const co = await docDanhSachReferral(a1, { ...LOC, coTheMoLead: true });
    const theo = new Map(co.dong.map((d) => [d.id, d.phieu]));
    expect(theo.get(rOk.id)).toEqual({ coPhieu: true, maRutGon: leadOk.id.slice(-6).toUpperCase(), leadId: leadOk.id }); // đối chứng dương
    expect(theo.get(rChuyen.id)?.leadId).toBeNull();
    expect(theo.get(rChuyen.id)?.maRutGon).toBe(leadChuyen.id.slice(-6).toUpperCase());
    expect(theo.get(rXoa.id)?.leadId).toBeNull();
    expect(theo.get(rKhong.id)).toEqual({ coPhieu: false, maRutGon: null, leadId: null });

    const khong = await docDanhSachReferral(a1, { ...LOC, coTheMoLead: false });
    for (const d of khong.dong) expect(d.phieu.leadId, `${d.id} lộ leadId khi không có quyền`).toBeNull();
    expect(khong.dong.find((d) => d.id === rOk.id)?.phieu.maRutGon).toBe(leadOk.id.slice(-6).toUpperCase());
    expect(JSON.stringify(khong)).not.toContain(leadOk.id);

    expect((await docChiTietReferral(a1, rOk.id, { coTheMoLead: true }))?.phieu.leadId).toBe(leadOk.id);
    expect((await docChiTietReferral(a1, rOk.id, { coTheMoLead: false }))?.phieu.leadId).toBeNull();
  });

  it("[RFD-DB-07] «Nguồn đã giải» nói thật: có bậc quyết định ⇒ tên nhóm (kể cả REJECTED_DUPLICATE); không có ⇒ null dù cột trỏ vào nhóm có tên thật", async () => {
    const cs1 = await taoCoSo("g1");
    const nen = await taoNen("ng");
    const rHopLe = await taoRf(nen, { centerId: cs1.id, status: "VALID", snapshot: SN_CO_BAC, dungNguon: true });
    const rTrung = await taoRf(nen, { centerId: cs1.id, status: "REJECTED_DUPLICATE", snapshot: SN_CO_BAC, dungNguon: true });
    const rTuChoi = await taoRf(nen, { centerId: cs1.id, status: "REJECTED", snapshot: SN_KHONG_BAC, dungNguon: false, lyDo: "LINK_KHONG_HOP_LE:LINK_DA_THU_HOI" });
    // cột trỏ vào nhóm có tên THẬT nhưng snapshot không có bậc ⇒ vẫn «chưa quy được» (không tin tên nhóm khi không có bậc)
    const rGiuCoTen = await taoRf(nen, { centerId: cs1.id, status: "MANUAL_REVIEW", snapshot: SN_KHONG_BAC, dungNguon: true });
    const r = await docDanhSachReferral(actorCoSo([cs1.id]), LOC);
    const nguon = new Map(r.dong.map((d) => [d.id, d.nguon]));
    expect(nguon.get(rHopLe.id)).toBe(nen.tenNguon);
    expect(nguon.get(rTrung.id)).toBe(nen.tenNguon);
    expect(nguon.get(rTuChoi.id)).toBeNull();
    expect(nguon.get(rGiuCoTen.id)).toBeNull();
    // lý do đã dịch ra tiếng Việt, mã máy không lộ
    expect(r.dong.find((d) => d.id === rTuChoi.id)?.lyDo.ngan).toBe("Link không còn hợp lệ: Link đã bị thu hồi.");
    expect(JSON.stringify(r)).not.toContain("LINK_DA_THU_HOI");
    // chi tiết: bậc quyết định đọc ra
    const ct = await docChiTietReferral(actorCoSo([cs1.id]), rHopLe.id, { coTheMoLead: true });
    expect(ct?.snapshot.tuNhan).toBe("Nguồn mặc định của campaign");
    expect((await docChiTietReferral(actorCoSo([cs1.id]), rTuChoi.id, { coTheMoLead: true }))?.snapshot.tuNhan).toBeNull();
  });

  it("[RFD-DB-08] phân trang: 27 dòng ⇒ 25 + 2, mới nhất trước, trang vượt biên rỗng nhưng tổng đúng; lọc trạng thái + phân trang cùng nhau", async () => {
    const cs1 = await taoCoSo("h1");
    const nen = await taoNen("pt");
    const ids: string[] = [];
    for (let i = 0; i < 27; i++) ids.push((await taoRf(nen, { centerId: cs1.id, status: i % 3 === 0 ? "MANUAL_REVIEW" : "VALID", phut: i })).id); // phut tăng ⇒ cũ dần
    const a1 = actorCoSo([cs1.id]);

    const t1 = await docDanhSachReferral(a1, { ...LOC, trang: 1 });
    expect(t1.dong).toHaveLength(25);
    expect(t1.tong).toBe(27);
    expect(idsCua(t1)).toEqual(ids.slice(0, 25)); // mới nhất trước
    const t2 = await docDanhSachReferral(a1, { ...LOC, trang: 2 });
    expect(idsCua(t2)).toEqual(ids.slice(25));
    const t3 = await docDanhSachReferral(a1, { ...LOC, trang: 3 });
    expect([t3.dong.length, t3.tong]).toEqual([0, 27]);

    const xt = await docDanhSachReferral(a1, { ...LOC, trangThai: "MANUAL_REVIEW", kichThuoc: 4, trang: 2 });
    expect(xt.tong).toBe(9); // i = 0,3,…,24
    expect(xt.dong).toHaveLength(4);
    expect(xt.dong.every((d) => d.trangThai === "MANUAL_REVIEW")).toBe(true);
    // rác tham số kích thước/trang không ném
    expect((await docDanhSachReferral(a1, { ...LOC, trang: -5, kichThuoc: 0 })).dong).toHaveLength(1);
  });

  it("[RFD-DB-09] phamVi: Hội sở TAT_CA, cấp cơ sở GIOI_HAN", async () => {
    const cs1 = await taoCoSo("i1");
    expect((await docDanhSachReferral(actorHoiSo(), LOC)).phamVi).toBe("TAT_CA");
    expect((await docDanhSachReferral(actorHoLevel(), LOC)).phamVi).toBe("TAT_CA");
    expect((await docDanhSachReferral(actorCoSo([cs1.id]), LOC)).phamVi).toBe("GIOI_HAN");
    expect((await docDanhSachReferral(actorCoSo([]), LOC)).phamVi).toBe("GIOI_HAN");
  });

  // ═══ [RFD-DB-10] page.tsx dựng bằng dữ liệu thật ═══════════════════════════════════════════════════
  const scopeFx = (quyen: ModuleKey[]) =>
    dungNguonHoaHongScope({
      quyen: new Set(quyen),
      co: { nguon: true, engine: false, affiliate: true },
      centerIds: { Lead: "ALL", CommissionPeriod: "ALL", CommissionTransaction: "ALL", CommissionDispute: "ALL" },
      cacCoSo: [],
    });
  const QUYEN_XEM: ModuleKey[] = ["affiliate_referrals:view-org"];
  const dungTrang = async (p: { actor: Actor; quyen?: ModuleKey[]; sp?: Record<string, string> }): Promise<string> => {
    TRANG.vaoTab.mockResolvedValue({ userId: "u", actor: p.actor, scope: scopeFx(p.quyen ?? QUYEN_XEM) });
    return renderToStaticMarkup(await ReferralPage({ searchParams: Promise.resolve(p.sp ?? {}) }));
  };
  const dungChiTiet = async (p: { actor: Actor; id: string; quyen?: ModuleKey[] }): Promise<string> => {
    TRANG.vaoTab.mockResolvedValue({ userId: "u", actor: p.actor, scope: scopeFx(p.quyen ?? QUYEN_XEM) });
    return renderToStaticMarkup(await ChiTietReferralPage({ params: Promise.resolve({ id: p.id }) }));
  };

  it("[RFD-DB-10] page.tsx trên dữ liệu thật: chip + số khớp, dòng chỉ-đọc, chú thích «chưa quy được cơ sở» CHỈ cho cấp CS, liên kết phiếu theo quyền, thiếu quyền, bộ lọc rác, kẹp trang, rỗng; không PII", async () => {
    const cs1 = await taoCoSo("p1");
    const cs2 = await taoCoSo("p2");
    const nen1 = await taoNen("trang1");
    const nen2 = await taoNen("trang2");
    const lead1 = await taoLead(cs1.id);
    const lead2 = await taoLead(cs2.id);
    await taoRf(nen1, { centerId: cs1.id, status: "MANUAL_REVIEW", leadId: lead1.id, lyDo: "Biểu mẫu gửi từ tên miền ngoài danh sách website của link giới thiệu.", phut: 1 });
    await taoRf(nen1, { centerId: cs1.id, status: "MANUAL_REVIEW", phut: 2 });
    await taoRf(nen1, { centerId: cs1.id, status: "VALID", snapshot: SN_CO_BAC, dungNguon: true, phut: 3 });
    await taoRf(nen2, { centerId: cs2.id, status: "MANUAL_REVIEW", leadId: lead2.id, phut: 4 });
    await taoRf(nen2, { centerId: null, status: "MANUAL_REVIEW", phut: 5 });

    // CẤP CS1 (có quyền mở phiếu): thấy 3 dòng của CS1, KHÔNG thấy đối tác nen2; chip khớp; chú thích; liên kết phiếu
    TRANG.coTheMoLead = true;
    const cs = await dungTrang({ actor: actorCoSo([cs1.id]) });
    // AFF-L3b: màn KHÔNG còn «chỉ đọc» — nhưng người chỉ có quyền XEM không thấy nút nào (nút vẽ bằng ĐÚNG khoá `affiliate_referrals:manage`).
    expect(cs).toContain("Bạn xem được các lượt giới thiệu");
    expect(cs).not.toContain("Màn chỉ đọc");
    expect(cs).not.toContain("Khai tay referral");
    // đối chứng dương: có `:manage` ⇒ thấy nút «Khai tay referral»
    const quanLy = await dungTrang({ actor: actorCoSo([cs1.id]), quyen: ["affiliate_referrals:view-org", "affiliate_referrals:manage"] });
    expect(quanLy).toContain("Khai tay referral");
    expect(quanLy).toContain("Mở một lượt để duyệt, từ chối hoặc xin thêm bằng chứng");
    expect(cs).toContain("Tất cả (3)");
    expect(cs).toContain("Cần xem tay (2)");
    expect(cs).toContain("Hợp lệ (1)");
    expect(cs).toContain("Từ chối (0)");
    expect(cs).toContain(nen1.tenDoiTac);
    expect(cs).not.toContain(nen2.tenDoiTac); // cơ sở khác
    expect(cs).toContain("Lượt chưa quy được về cơ sở nào chỉ hiện ở cấp Hội sở");
    expect(cs).toContain(`href="/leads/${lead1.id}"`); // có quyền ∧ phiếu trong tầm nhìn
    expect(cs).not.toContain(lead2.id);
    expect(cs).toContain("Biểu mẫu gửi từ tên miền ngoài danh sách website của link giới thiệu.");
    for (const rò of [KHACH.ten, KHACH.sdt, KHACH.sdt84, KHACH.email, "0988000111"]) expect(cs, rò).not.toContain(rò);
    // mỗi dòng có liên kết chi tiết (vùng bấm)
    expect(cs.match(/href="\/nguon-hoa-hong\/referral\/[A-Za-z0-9]+"/g)).toHaveLength(3);

    // CÙNG actor, KHÔNG có quyền mở phiếu: không còn liên kết /leads/, không lộ id; mã rút gọn vẫn có
    TRANG.coTheMoLead = false;
    const khongPhieu = await dungTrang({ actor: actorCoSo([cs1.id]) });
    expect(khongPhieu).not.toContain("/leads/");
    expect(khongPhieu).not.toContain(lead1.id);
    expect(khongPhieu).toContain(`#${lead1.id.slice(-6).toUpperCase()}`);
    TRANG.coTheMoLead = true;

    // ĐỐI CHỨNG DƯƠNG của chú thích: Hội sở KHÔNG có dòng đó; Hội sở thấy cả đối tác nen2 (kể cả dòng NULL)
    const ho = await dungTrang({ actor: actorHoiSo(), sp: { trangthai: "MANUAL_REVIEW" } });
    expect(ho).not.toContain("Lượt chưa quy được về cơ sở nào chỉ hiện ở cấp Hội sở");
    expect(ho).toContain(nen1.tenDoiTac);
    expect(ho).toContain(nen2.tenDoiTac);

    // lọc theo chip: chỉ dòng Cần xem tay; chip đang chọn có aria-current
    const loc = await dungTrang({ actor: actorCoSo([cs1.id]), sp: { trangthai: "MANUAL_REVIEW" } });
    expect(loc).toMatch(/aria-current="page"[^>]*>Cần xem tay \(2\)/);
    expect(loc).toContain("Tất cả (3)"); // «Tất cả» là Σ chip, KHÔNG phải số dòng của bộ lọc đang chọn
    expect(loc).toContain("Hợp lệ (1)");
    expect(loc.match(/href="\/nguon-hoa-hong\/referral\/[A-Za-z0-9]+"/g)).toHaveLength(2);

    // bộ lọc rác ⇒ như không lọc
    const rac = await dungTrang({ actor: actorCoSo([cs1.id]), sp: { trangthai: "VALID';DROP", trang: "abc" } });
    expect(rac).toMatch(/aria-current="page"[^>]*>Tất cả \(3\)/);

    // kẹp trang: quá biên ⇒ redirect về trang hợp lệ (giữ bộ lọc)
    await expect(dungTrang({ actor: actorCoSo([cs1.id]), sp: { trang: "9", trangthai: "VALID" } })).rejects.toThrow("REDIRECT:/nguon-hoa-hong/referral?trangthai=VALID");

    // THIẾU QUYỀN: không có khoá nào của cổng ⇒ NoPermission nêu khoá, không có dữ liệu
    const thieu = await dungTrang({ actor: actorCoSo([cs1.id]), quyen: ["affiliates:view"] });
    expect(thieu).toContain("affiliate_referrals:view-org");
    expect(thieu).not.toContain(nen1.tenDoiTac);

    // RỖNG: cơ sở không có dòng nào + bộ lọc rỗng ⇒ câu rỗng đúng; chip 0
    const rong = await dungTrang({ actor: actorCoSo([(await taoCoSo("p3")).id]) });
    expect(rong).toContain("Chưa có lượt giới thiệu nào");
    expect(rong).toContain("Tất cả (0)");
    const rongLoc = await dungTrang({ actor: actorCoSo([cs1.id]), sp: { trangthai: "DISPUTED" } });
    expect(rongLoc).toContain("Không có lượt nào “Tranh chấp”");
  });

  it("[RFD-DB-11] trang chi tiết trên dữ liệu thật: đủ bốn mục + không PII; 404 cho dòng cơ sở khác / dòng NULL (cấp CS) / id rác / `%` hỏng; Hội sở mở được dòng NULL", async () => {
    const cs1 = await taoCoSo("q1");
    const cs2 = await taoCoSo("q2");
    const nen = await taoNen("chitiet");
    const lead = await taoLead(cs1.id);
    const loai = await db.affiliateType.create({ data: { code: `${MA}_L${hau()}`, name: `Loại ${P} phụ huynh`, requiresApproval: false, isActive: true, sortOrder: 100 } });
    const nhan = await db.affiliateTag.create({ data: { code: `${MA}_N${hau()}`, name: `Nhãn ${P} thân thiết`, isActive: true } });
    const snap = { ...SN_CO_BAC, typeCode: loai.code, tagCodes: [nhan.code], canCuTuGioiThieu: ["SDT"], origin: "LECH", phone: KHACH.sdt };
    const rf = await taoRf(nen, { centerId: cs1.id, status: "MANUAL_REVIEW", leadId: lead.id, snapshot: snap, dungNguon: true, lyDo: "Biểu mẫu gửi từ tên miền ngoài danh sách website của link giới thiệu." });
    const rKhac = await taoRf(nen, { centerId: cs2.id });
    const rNull = await taoRf(nen, { centerId: null });
    const a1 = actorCoSo([cs1.id]);

    const html = await dungChiTiet({ actor: a1, id: rf.id });
    for (const muc of ["Kết quả", "Người giới thiệu", "Nguồn đã giải", "Phiếu khách"]) expect(html).toContain(muc);
    // AFF-L3b: có «Lịch sử xử lý» (rỗng nói thật); người chỉ XEM không thấy panel xử lý; đối chứng dương: có `:manage` ⇒ thấy panel + các nút theo trạng thái.
    expect(html).not.toContain("Màn chỉ đọc");
    expect(html).toContain("Lịch sử xử lý");
    expect(html).toContain("Chưa có thao tác xử lý tay nào với lượt này.");
    expect(html).not.toContain("Xử lý lượt giới thiệu");
    expect(html).not.toContain("id=\"xu-ly\""); // cả mục «Xử lý» cũng không vẽ (không để lại tiêu đề rỗng cho người chỉ xem)
    const htmlQl = await dungChiTiet({ actor: a1, id: rf.id, quyen: ["affiliate_referrals:view-org", "affiliate_referrals:manage"] });
    expect(htmlQl).toContain("Xử lý lượt giới thiệu");
    expect(htmlQl).toContain("id=\"xu-ly\"");
    for (const nut of ["Duyệt", "Từ chối", "Đánh dấu tranh chấp", "Xin bằng chứng", "Bổ sung bằng chứng"]) expect(htmlQl).toContain(nut);
    expect(html).toContain("Cần xem tay");
    expect(html).toContain(nen.tenDoiTac);
    expect(html).toContain(nen.tenNguon);
    expect(html).toContain(`Loại ${P} phụ huynh`);
    expect(html).toContain(`Nhãn ${P} thân thiết`);
    expect(html).toContain("Nguồn mặc định của campaign");
    expect(html).toContain("Lệch — biểu mẫu gửi từ tên miền ngoài danh sách website của link.");
    expect(html).toContain("trùng số điện thoại");
    expect(html).toContain(`href="/leads/${lead.id}"`);
    for (const rò of [KHACH.ten, KHACH.sdt, KHACH.sdt84, KHACH.email, "0988000111"]) expect(html, rò).not.toContain(rò);
    // không quyền xem campaign ⇒ tên campaign KHÔNG là liên kết; có quyền ⇒ là liên kết (đối chứng dương)
    expect(html).not.toContain(`/nguon-hoa-hong/campaign/`);
    const coCamp = await dungChiTiet({ actor: a1, id: rf.id, quyen: ["affiliate_referrals:view-org", "affiliate_campaigns:view"] });
    expect(coCamp).toContain(`href="/nguon-hoa-hong/campaign/${nen.maCampaign}"`);

    await expect(dungChiTiet({ actor: a1, id: rKhac.id })).rejects.toThrow("NOT_FOUND");
    await expect(dungChiTiet({ actor: a1, id: rNull.id })).rejects.toThrow("NOT_FOUND");
    await expect(dungChiTiet({ actor: a1, id: "x" })).rejects.toThrow("NOT_FOUND");
    await expect(dungChiTiet({ actor: a1, id: "%E0%A4%A" })).rejects.toThrow("NOT_FOUND");
    expect(await dungChiTiet({ actor: actorHoiSo(), id: rNull.id })).toContain("Kết quả"); // đối chứng dương
    expect(await dungChiTiet({ actor: actorHoiSo(), id: rKhac.id })).toContain("Kết quả");
  });
});
