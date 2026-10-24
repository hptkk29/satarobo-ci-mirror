// lib/affiliate/campaign-cho-hoa-hong.ts — CAMPAIGN · THÀNH VIÊN · REFERRAL của một khoản thu, cho ENGINE HOA HỒNG (AFF-P2, docs/source-commission/12 §8). CHỈ ĐỌC.
//
// Engine tính tiền cần biết "khoản này đến từ campaign Affiliate nào" để (a) chọn rule phạm vi CAMPAIGN và (b) CHỤP ba id vào sổ bất biến (`affiliateCampaignId` ·
// `affiliateMembershipId` · `affiliateReferralId`). Bản chụp `LeadAttribution.signals.affiliate` chỉ mang MÃ (không id) nên id được tra LÚC QUÉT bằng ĐÚNG MỘT luật tất định, ở đây:
//
//   · CỔNG — chỉ khi attribution thật sự là của Affiliate: `referrerKind = AFFILIATE` ∧ có `referrerAffiliateId` ∧ bản chụp mang `affiliateCode` KHỚP mã của đối tác đang là
//     người giới thiệu. Vế cuối chặn ca "đổi nguồn thủ công sang người khác mà `signals.affiliate` còn nguyên" (`doi-nguon-lead.ts` chép `...conLai`): campaign cũ của người cũ
//     không được dán sang người mới. Trượt cổng ⇒ cả ba id NULL (không đoán).
//   · CAMPAIGN  = `AffiliateCampaign.code = signals.affiliate.campaignCode` (code UNIQUE, KHÔNG có đường sửa sau khi tạo — `ghi-campaign-dau-vao.ts`).
//   · MEMBERSHIP = (đối tác, campaign) — UNIQUE.
//   · REFERRAL   = dòng `VALID` của (lead, đối tác, CAMPAIGN VỪA TRA), mới nhất: `createdAt DESC, id DESC`. Lọc theo campaign để ba id không bao giờ trỏ về ba campaign khác nhau.
//
// ⚠️ KHÔNG lọc theo TRẠNG THÁI của campaign / thành viên / đối tác: kết thúc campaign hay ngưng thành viên SAU khi khách đã vào là chuyện của TƯƠNG LAI, không được làm
// `campaignId` của khoản đã quy nguồn rơi về NULL ở lượt quét lại (hash đổi ⇒ drift giả ⇒ dòng điều chỉnh giả). Hiệu lực ở thời điểm GHI NHẬN do P1 đã quyết.
//
// Nằm ở `lib/affiliate/` chứ không `lib/nguon/`: bảng Affiliate* không thuộc lưới `[QN-W11]` (chỉ `LeadAttribution`/`LeadTouchpoint`). Phần đọc `signals` (bảng nguồn) vẫn ở `lib/nguon/**`.
import type { Prisma, PrismaClient } from "@prisma/client";

import type { SnapshotAffiliate } from "./snapshot-referral";

type Khach = PrismaClient | Prisma.TransactionClient;

/**
 * ẢNH CHỤP cấu hình campaign LÚC TÍNH (AFF-L2, D-C): phần cấu hình có ảnh hưởng tới việc "ai sở hữu referral" và "tính theo mô hình nào". Chỉ vào `resolverBasis.affiliate.campaign` của dòng sổ — KHÔNG vào
 * `inputHash` (`updatedAt` đổi mỗi lần admin sửa campaign: đưa vào băm là mọi lần sửa thành INPUT_DRIFT giả cho mọi ô đã khớp).
 */
export type ChupCampaign = {
  status: string;
  attributionModel: string;
  cookieWindowDays: number;
  protectWindowDays: number;
  defaultSourceGroupId: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  updatedAt: Date;
};

export type AffiliateChoHoaHong = {
  campaignId: string;
  campaignCode: string;
  campaignName: string;
  /** Đối tác (AffiliateParty) đang giữ công — chính là `referrerAffiliateId` đã qua cổng mã. */
  partyId: string;
  membershipId: string | null;
  referralId: string | null;
  /** Hiệu lực của thành viên (đo ĐÚNG ngày sự kiện, không đo hôm nay). `null` = chưa có thành viên. */
  thanhVien: { effectiveFrom: Date; effectiveTo: Date | null } | null;
  /** Referral VALID đã tra: hạn bảo vệ + nguồn đã giải lúc ghi nhận. `null` = không có referral VALID. */
  referral: { protectedUntil: Date | null; sourceGroupId: string } | null;
  chup: ChupCampaign;
  partyKind: "PERSON" | "ORGANIZATION";
  /** Cá nhân đại diện thuộc một tổ chức (`Affiliate.parentPartyId`) — CHỈ để ghi lại; tiền KHÔNG cuộn lên tổ chức (câu hỏi mở, doc 12 §8). */
  parentPartyId: string | null;
  typeCode: string | null;
  tu: string | null;
  tuNhan: string | null;
};

/** Đầu vào CỔNG — tách riêng để ca thuần đo được mà không cần DB. THUẦN. */
export function quaCongAffiliate(p: {
  referrerKind: "PARENT" | "EMPLOYEE" | "AFFILIATE" | null;
  referrerAffiliateId: string | null;
  snapshot: SnapshotAffiliate | null;
}): p is { referrerKind: "AFFILIATE"; referrerAffiliateId: string; snapshot: SnapshotAffiliate } {
  return p.referrerKind === "AFFILIATE" && p.referrerAffiliateId !== null && p.snapshot !== null;
}

export async function docAffiliateChoHoaHong(
  client: Khach,
  p: {
    leadId: string;
    referrerKind: "PARENT" | "EMPLOYEE" | "AFFILIATE" | null;
    referrerAffiliateId: string | null;
    snapshot: SnapshotAffiliate | null;
  },
): Promise<AffiliateChoHoaHong | null> {
  if (!quaCongAffiliate(p)) return null;
  const { referrerAffiliateId: partyId, snapshot } = p;

  const party = await client.affiliate.findUnique({
    where: { id: partyId },
    select: { code: true, partyKind: true, parentPartyId: true, type: { select: { code: true } } },
  });
  // Mã trong bản chụp phải là mã CỦA ĐỐI TÁC đang giữ công — không thì bản chụp là của người giới thiệu trước đó.
  if (!party || party.code !== snapshot.affiliateCode) return null;

  const campaign = await client.affiliateCampaign.findUnique({
    where: { code: snapshot.campaignCode },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      attributionModel: true,
      cookieWindowDays: true,
      protectWindowDays: true,
      defaultSourceGroupId: true,
      effectiveFrom: true,
      effectiveTo: true,
      updatedAt: true,
    },
  });
  if (!campaign) return null;

  const [membership, referral] = await Promise.all([
    client.affiliateMembership.findUnique({ where: { partyId_campaignId: { partyId, campaignId: campaign.id } }, select: { id: true, effectiveFrom: true, effectiveTo: true } }),
    client.affiliateReferral.findFirst({
      where: { leadId: p.leadId, partyId, campaignId: campaign.id, status: "VALID" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, protectedUntil: true, sourceGroupId: true },
    }),
  ]);

  return {
    campaignId: campaign.id,
    campaignCode: campaign.code,
    campaignName: campaign.name,
    partyId,
    membershipId: membership?.id ?? null,
    referralId: referral?.id ?? null,
    thanhVien: membership ? { effectiveFrom: membership.effectiveFrom, effectiveTo: membership.effectiveTo } : null,
    referral: referral ? { protectedUntil: referral.protectedUntil, sourceGroupId: referral.sourceGroupId } : null,
    chup: {
      status: campaign.status,
      attributionModel: campaign.attributionModel,
      cookieWindowDays: campaign.cookieWindowDays,
      protectWindowDays: campaign.protectWindowDays,
      defaultSourceGroupId: campaign.defaultSourceGroupId,
      effectiveFrom: campaign.effectiveFrom,
      effectiveTo: campaign.effectiveTo,
      updatedAt: campaign.updatedAt,
    },
    partyKind: party.partyKind,
    parentPartyId: party.parentPartyId,
    typeCode: party.type?.code ?? snapshot.typeCode,
    tu: snapshot.tu,
    tuNhan: snapshot.tuNhan,
  };
}
