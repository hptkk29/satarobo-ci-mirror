// tests/hoa-hong/_affiliate-so-fx.ts — FIXTURE DÙNG CHUNG cho `affiliate-bao-cao.spec.ts` và `affiliate-portal.spec.ts` (AFF-P3).
//
// Dựng thẳng những thứ mà bài kiểm tra cần có hình dạng THẬT mà không cần chạy cả engine hoa hồng: một chuỗi Affiliate (nguồn → website → campaign → loại → đối tác → thành viên → link),
// kỳ + dòng sổ, referral, lượt bấm. KHÔNG `resetDb()`: mọi bản ghi mang tiền tố `AFRX` (mã) và được dọn THEO TIỀN TỐ; riêng sổ bất biến nên dọn bằng `donSoCai` (cắt bảng) ở NƠI GỌI.
// Ngày TUYỆT ĐỐI (luật 19) — `Date.now()` chỉ làm hậu tố mã duy nhất.
import type { CommissionPayoutStatus, Prisma } from "@prisma/client";

import { db } from "../../lib/db";
import { sinhToken } from "../../lib/affiliate/token";

export const TIEN_TO = "AFRX";
let dem = 0;
export const hau = () => `${Date.now().toString(36).toUpperCase()}${(dem += 1)}`;

export type Chuoi = Awaited<ReturnType<typeof dungChuoi>>;

/** Chuỗi link ĐẦY ĐỦ: nguồn → website(+trang đích) → campaign → loại → đối tác → thành viên → link (mã duy nhất mỗi lần). */
export async function dungChuoi(p: { tenCampaign?: string; tenDoiTac?: string; userId?: string | null; nhomId?: string } = {}) {
  const h = hau();
  const nhom =
    p.nhomId !== undefined
      ? { id: p.nhomId }
      : await db.leadSourceGroup.create({
          data: { code: `${TIEN_TO}_S${h}`, name: `Nguồn ${TIEN_TO} ${h}`, sourceType: "PARTNER", referrerRequirement: "NONE", sortOrder: 900, status: "ACTIVE", selectable: true, commissionEnabled: true },
        });
  const site = await db.affiliateSite.create({
    data: {
      code: `${TIEN_TO}_W${h}`,
      name: `Web ${TIEN_TO} ${h}`,
      baseUrl: `https://${h.toLowerCase()}.afrx.test`,
      allowedDomains: [`${h.toLowerCase()}.afrx.test`],
      status: "ACTIVE",
      trackingEnabled: true,
      landingPages: { create: { pathPattern: "/khoa-robot" } },
    },
  });
  const campaign = await db.affiliateCampaign.create({
    data: {
      code: `${TIEN_TO}_C${h}`,
      name: p.tenCampaign ?? `Campaign ${TIEN_TO} ${h}`,
      status: "ACTIVE",
      cookieWindowDays: 30,
      protectWindowDays: 90,
      defaultSourceGroupId: nhom.id,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      sites: { create: { siteId: site.id } },
    },
  });
  const loai = await db.affiliateType.create({ data: { code: `${TIEN_TO}_T${h}`, name: `Loại ${TIEN_TO} ${h}` } });
  const doiTac = await taoDoiTac({ campaign, loai: loai.id, ten: p.tenDoiTac, userId: p.userId ?? null, site });
  return { h, nhomId: nhom.id, site, campaign, loai, ...doiTac };
}

/** Thêm MỘT đối tác (+ thành viên + link) vào campaign đã có. */
export async function taoDoiTac(p: { campaign: { id: string }; loai: string; ten?: string; userId?: string | null; site: { id: string } }) {
  const h = hau();
  const doiTac = await db.affiliate.create({
    data: {
      code: `${TIEN_TO}_D${h}`,
      name: p.ten ?? `Đối tác ${TIEN_TO} ${h}`,
      status: "ACTIVE",
      isActive: true,
      typeId: p.loai,
      userId: p.userId ?? null,
      phone: "0988777666",
      email: `doitac.${h.toLowerCase()}@afrx.example.com`,
    },
  });
  const mem = await db.affiliateMembership.create({ data: { partyId: doiTac.id, campaignId: p.campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  const token = sinhToken();
  const asset = await db.affiliateTrackingAsset.create({
    data: { partyId: doiTac.id, membershipId: mem.id, campaignId: p.campaign.id, siteId: p.site.id, landingPath: "/khoa-robot", publicToken: token, type: "LINK", status: "ACTIVE" },
  });
  return { doiTac, mem, asset, token };
}

/** Thêm một campaign nữa cho CÙNG đối tác. */
export async function themCampaignChoDoiTac(ch: Chuoi, ten: string) {
  const h = hau();
  const campaign = await db.affiliateCampaign.create({
    data: { code: `${TIEN_TO}_C${h}`, name: ten, status: "ACTIVE", defaultSourceGroupId: ch.nhomId, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), sites: { create: { siteId: ch.site.id } } },
  });
  const mem = await db.affiliateMembership.create({ data: { partyId: ch.doiTac.id, campaignId: campaign.id, status: "ACTIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  const token = sinhToken();
  const asset = await db.affiliateTrackingAsset.create({
    data: { partyId: ch.doiTac.id, membershipId: mem.id, campaignId: campaign.id, siteId: ch.site.id, landingPath: "/khoa-robot", publicToken: token, type: "LINK", status: "ACTIVE" },
  });
  return { campaign, mem, asset, token };
}

export const SN = { affiliateCode: "X", campaignCode: "Y", method: "LINK", typeCode: null, tagCodes: [], tu: "MAC_DINH_CAMPAIGN", tuNhan: "Nguồn mặc định của campaign", origin: "KHOP" };

/** Lead fixture. `daDangKy` ⇒ `convertedAt` (dấu «đã chốt» thật của convert-lead). Tên/SĐT/email ĐẶC TRƯNG để test PII tìm chuỗi. */
export const KHACH = { ten: "Nguyễn Thị AfrxKhach", sdt: "0907555123", sdt84: "84907555123", email: "afrx.khach@example.com" };
export function taoLead(p: { centerId: string | null; daDangKy?: boolean; xoaMem?: boolean }) {
  return db.lead.create({
    data: {
      parentName: KHACH.ten,
      phone: KHACH.sdt,
      email: KHACH.email,
      ...(p.centerId ? { centerId: p.centerId } : {}),
      ...(p.daDangKy ? { convertedAt: new Date("2026-10-20T03:00:00.000Z"), status: "DA_DANG_KY" as const } : {}),
      ...(p.xoaMem ? { deletedAt: new Date("2026-10-21T03:00:00.000Z") } : {}),
    },
  });
}

export type TrangThaiRf = "VALID" | "MANUAL_REVIEW" | "REJECTED" | "REJECTED_DUPLICATE" | "DISPUTED";

/** MỘT referral (tuân CHECK: VALID luôn có lead; REJECTED* luôn có `rejectedAt`). `luc` là thời điểm TUYỆT ĐỐI. */
export async function taoReferral(p: {
  partyId: string;
  campaignId: string;
  membershipId: string;
  assetId: string;
  nhomId: string;
  status: TrangThaiRf;
  luc: Date;
  centerId: string | null;
  orgUnitId?: string | null;
  leadId?: string | null;
}) {
  return db.affiliateReferral.create({
    data: {
      partyId: p.partyId,
      campaignId: p.campaignId,
      membershipId: p.membershipId,
      assetId: p.assetId,
      method: "LINK",
      status: p.status,
      rejectedAt: p.status === "REJECTED" || p.status === "REJECTED_DUPLICATE" ? p.luc : null,
      sourceGroupId: p.nhomId,
      sourceSnapshot: SN as Prisma.InputJsonValue,
      leadId: p.leadId ?? null,
      resolutionReason: p.status === "REJECTED" ? "TU_GIOI_THIEU" : null,
      centerId: p.centerId,
      orgUnitId: p.orgUnitId ?? null,
      createdAt: p.luc,
    },
  });
}

export function taoClick(p: { assetId: string; campaignId: string; partyId: string; outcome: string; luc: Date }) {
  return db.referralClick.create({ data: { assetId: p.assetId, campaignId: p.campaignId, partyId: p.partyId, outcome: p.outcome, occurredAt: p.luc } });
}

// ── Sổ hoa hồng ─────────────────────────────────────────────────────────────────────────────────────

export async function kyCua(centerId: string, orgUnitId: string, period = "2026-10") {
  return (
    (await db.commissionPeriod.findUnique({ where: { period_centerId: { period, centerId } } })) ??
    db.commissionPeriod.create({ data: { period, centerId, orgUnitId, status: "OPEN" } })
  );
}

let nhomUnknown: string | null = null;
const vaiId = new Map<string, string>();

/**
 * Quên các id đã nhớ (nhóm nguồn `UNKNOWN`, vai nhận hoa hồng). BẮT BUỘC gọi sau mỗi lần TRUNCATE (`resetDb`) khi cùng một tiến trình chạy nhiều bộ nối tiếp — Playwright a0 dùng MỘT worker cho mọi spec:
 * id cũ trỏ vào dòng đã bị xoá nên `themDongSo` ném lỗi khoá ngoại. Bộ vitest không TRUNCATE (dọn theo tiền tố) nên không cần.
 */
export function quenIdDaNho(): void {
  nhomUnknown = null;
  vaiId.clear();
}

export type DongSoFx = {
  centerId: string;
  orgUnitId: string;
  period?: string;
  campaignId: string | null;
  vai: "AFFILIATE" | "SALE";
  /** AFFILIATE ⇒ id đối tác; SALE ⇒ id user. */
  nguoiId: string;
  ten: string;
  amount: number;
  payout?: CommissionPayoutStatus;
  /**
   * Mặc định `PERIOD_BONUS` (nhóm «ghi mới» của `tongHopTheoKy`). KHÔNG dùng `ORIGINAL`: CHECK `loai_dong_chk` đòi `paymentId` (một khoản thu thật), mà bộ này chỉ cần dòng sổ có hình dạng
   * đủ cho PHẦN ĐỌC. `DISPUTE_ADJUSTMENT` = nhóm «điều chỉnh» (số âm).
   */
  entryKind?: "PERIOD_BONUS" | "DISPUTE_ADJUSTMENT";
  luc?: Date;
};

/** Chèn THẲNG một dòng sổ (bất biến ⇒ điền đủ lúc INSERT). Hình dạng khớp dòng engine ghi: cột campaign chụp trên MỌI vai của khoản. */
export async function themDongSo(p: DongSoFx) {
  nhomUnknown ??= (await db.leadSourceGroup.findFirstOrThrow({ where: { code: "UNKNOWN" }, select: { id: true } })).id;
  if (!vaiId.has(p.vai)) vaiId.set(p.vai, (await db.beneficiaryRole.findFirstOrThrow({ where: { code: p.vai }, select: { id: true } })).id);
  const ky = await kyCua(p.centerId, p.orgUnitId, p.period ?? "2026-10");
  const h = hau();
  return db.commissionTransaction.create({
    data: {
      idempotencyKey: `${TIEN_TO.toLowerCase()}-${h}`,
      entryKind: p.entryKind ?? "PERIOD_BONUS",
      periodId: ky.id,
      naturalPeriod: p.period ?? "2026-10",
      rateDate: new Date("2026-10-12T03:00:00.000Z"),
      transactionTypeCode: "NEW",
      revenueComponent: "TUITION",
      sourceGroupId: nhomUnknown,
      sourceGroupCode: "UNKNOWN",
      beneficiaryRoleId: vaiId.get(p.vai)!,
      roleCode: p.vai,
      beneficiaryKind: p.vai === "AFFILIATE" ? "AFFILIATE" : "USER",
      ...(p.vai === "AFFILIATE" ? { beneficiaryAffiliateId: p.nguoiId } : { beneficiaryUserId: p.nguoiId }),
      beneficiaryName: p.ten,
      resolverType: "DIRECT_PERSON",
      affiliateCampaignId: p.campaignId,
      reason: "fixture AFRX",
      grossAmount: 10_000_000,
      vatRate: "0.0000",
      netBase: 10_000_000,
      rate: "0.010000",
      amount: p.amount,
      capRate: "0.0900",
      equivalentRate: "0.010000",
      inputHash: `afrx-${h}`,
      payoutStatus: p.payout ?? "PENDING",
      centerId: p.centerId,
      orgUnitId: p.orgUnitId,
      ...(p.luc ? { createdAt: p.luc } : {}),
    },
  });
}

/** Dọn mọi bản ghi Affiliate mang tiền tố `AFRX` (sổ phải đã dọn trước — nơi gọi cắt bảng sổ). */
export async function donAffiliateFx(): Promise<void> {
  const ds = await db.affiliate.findMany({ where: { code: { startsWith: TIEN_TO } }, select: { id: true } });
  const ids = ds.map((x) => x.id);
  const camp = await db.affiliateCampaign.findMany({ where: { code: { startsWith: TIEN_TO } }, select: { id: true } });
  const cid = camp.map((c) => c.id);
  await db.affiliateReferral.deleteMany({ where: { OR: [{ partyId: { in: ids } }, { campaignId: { in: cid } }] } });
  // `ReferralClick` là sổ CHỈ-THÊM (trigger chặn sửa/xoá): tắt trigger trong MỘT transaction rồi bật lại — cùng cách `affiliate-link.spec.ts`.
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`ALTER TABLE "ReferralClick" DISABLE TRIGGER "ReferralClick_chi_them"`;
    await tx.referralClick.deleteMany({ where: { OR: [{ partyId: { in: ids } }, { campaignId: { in: cid } }] } });
    await tx.$executeRaw`ALTER TABLE "ReferralClick" ENABLE TRIGGER "ReferralClick_chi_them"`;
  });
  await db.lead.deleteMany({ where: { parentName: KHACH.ten } });
  await db.affiliateTrackingAsset.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliateMembership.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliateCampaignRule.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaignSite.deleteMany({ where: { campaignId: { in: cid } } });
  await db.affiliateCampaign.deleteMany({ where: { id: { in: cid } } });
  await db.affiliateSite.deleteMany({ where: { code: { startsWith: TIEN_TO } } });
  await db.affiliatePartyTag.deleteMany({ where: { partyId: { in: ids } } });
  // L3a: bảng nối tài khoản truy cập là FK Restrict tới Affiliate — phải dọn trước khi xoá đối tác.
  await db.affiliatePartyUser.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliate.deleteMany({ where: { id: { in: ids } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: TIEN_TO } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: TIEN_TO } } });
}
