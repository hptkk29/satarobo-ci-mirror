// lib/affiliate/nhan-referral.ts — NHẬN MỘT LƯỢT GỬI BIỂU MẫU QUA LINK/QR/MÃ GIỚI THIỆU (AFF-P1, docs/source-commission/12 §2.4–§2.6; đặc tả §22–§30, §50–§52).
//
// Hai bước, đúng khuôn `chuanBiQuyNguon` → ghi sau của module Nguồn:
//   1. `chuanBiReferral` (TRƯỚC giao dịch, đọc bằng `db` KHÔNG scope): tra token → chuỗi link/đối tác/campaign/website → danh tính khách → quyết định (thuần, `quyet-dinh-referral.ts`).
//      Trả `tinHieu` cho resolver quy nguồn (`TinHieuNguonDauVao.affiliate`) và `ghi` cho bước 2. KHÔNG ghi gì.
//   2. `ghiReferralSauKhiTaoLead` (SAU commit của lead): đọc luật quy nguồn đã thắng rồi ghi dòng `AffiliateReferral`. Ngoài giao dịch có chủ đích (T4: lỗi referral không được làm mất khách).
//      Khách TRÙNG (lead cũ trong cửa sổ chống trùng) không tạo lead mới: `ghiReferralChoLeadCu` ghi dòng REJECTED_DUPLICATE trỏ về lead cũ (người ghi nhận đầu tiên giữ công).
//
// ⚠️ KHÔNG BAO GIỜ tin client: biểu mẫu chỉ mang TOKEN công khai (+ id lượt bấm tuỳ chọn). Đối tác, membership, campaign, nguồn, tỉ lệ, thời hạn bảo vệ đều ĐỌC LẠI ở đây từ DB.
// Token lạ / sai định dạng ⇒ KHÔNG tạo dòng nào (không có đối tác để gắn) và không phân biệt «chưa từng có» với «đã thu hồi» ra ngoài.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { docKetQuaQuyNguonCuaLead } from "@/lib/nguon/doc-ket-qua-quy-nguon";
import type { AffiliateReferralDauVao } from "@/lib/nguon/tin-hieu";
import { CLICK_ID_RE } from "./dung-url-theo-doi";
import { kiemChuoiLink, type ChuoiLink } from "./ghi-link-dau-vao";
import { CHON_RANG_BUOC_CAMPAIGN, CHON_TRANG_DICH, rangBuocCuaCampaign, trangDichHieuLuc } from "./trang-dich-hieu-luc";
import { hostCuaBaseUrl } from "./website-hop-le";
import { danhTinhDoiTacDeChan } from "./danh-tinh-doi-tac";
import { giaiNguonCuaDoiTac } from "./giai-nguon";
import { dungSnapshotReferral } from "./snapshot-referral";
import { acaoChoOrigin } from "./theo-doi-cong-khai";
import { doTinCayReferral, quyetDinhReferral, trangThaiSauQuyNguon, type QuyetDinhReferral, type TinHieuClick } from "./quyet-dinh-referral";
import { chuanHoaToken } from "./token";
import { kiemTuGioiThieu } from "./tu-gioi-thieu";

const NGAY_MS = 24 * 60 * 60 * 1000;

export type KhachGuiBieuMau = { phone: string | null; email: string | null };

/** Thứ cần để GHI dòng referral — chỉ id/chuỗi/JSON, không PII khách. */
export type GhiReferral = {
  partyId: string;
  membershipId: string;
  campaignId: string;
  assetId: string;
  clickId: string | null;
  method: "LINK" | "QR" | "CODE";
  protectWindowDays: number;
  quyetDinh: QuyetDinhReferral;
  /** Nguồn ghi vào dòng: nguồn đã giải nếu hợp lệ, ngược lại nhóm UNKNOWN (cột NOT NULL; trạng thái mới là thứ nói «chưa quy được»). */
  sourceGroupId: string;
  snapshot: Record<string, unknown>;
  idempotencyKey: string;
};

export type KetQuaChuanBiReferral =
  | {
      ok: true;
      tinHieu: AffiliateReferralDauVao | null;
      ghi: GhiReferral;
      /** Giá trị `Access-Control-Allow-Origin` được phép phản chiếu (origin nằm trong `allowedDomains` của website của link), hoặc null. Không bao giờ `*`. */
      acao: string | null;
    }
  | { ok: false; lyDo: "TOKEN_KHONG_HOP_LE" | "KHONG_TIM_THAY" | "THIEU_NHOM_UNKNOWN" };

/**
 * Chỉ đọc `Access-Control-Allow-Origin` được phép cho một token: origin của request có nằm trong `allowedDomains` của website của link không. KHÔNG xét chuỗi hợp lệ, KHÔNG ghi gì.
 * Dùng khi cờ Affiliate TẮT (biểu mẫu vẫn lưu khách thường — cần header để trình duyệt của website đối tác đọc được câu «đã nhận»). Token hỏng/lạ ⇒ null (không phản chiếu gì).
 */
export async function docAcaoTheoToken(tokenTho: unknown, origin: string | null): Promise<string | null> {
  const token = chuanHoaToken(tokenTho);
  if (token === null) return null;
  const asset = await db.affiliateTrackingAsset.findUnique({ where: { publicToken: token }, select: { site: { select: { allowedDomains: true } } } });
  return asset ? acaoChoOrigin(origin, asset.site.allowedDomains) : null;
}

export async function chuanBiReferral(p: {
  token: unknown;
  clickId?: unknown;
  khach: KhachGuiBieuMau;
  /** Header Origin của request (hoặc null). Chỉ là tín hiệu PHỤ — xem `quyetDinhReferral`. */
  origin: string | null;
  idempotencyKey: string;
  now: Date;
}): Promise<KetQuaChuanBiReferral> {
  const token = chuanHoaToken(p.token);
  if (token === null) return { ok: false, lyDo: "TOKEN_KHONG_HOP_LE" };

  const asset = await db.affiliateTrackingAsset.findUnique({
    where: { publicToken: token },
    select: {
      id: true,
      status: true,
      type: true,
      landingPath: true,
      landingHost: true,
      partyId: true,
      membershipId: true,
      campaignId: true,
      party: {
        select: {
          code: true,
          status: true,
          typeId: true,
          phone: true,
          email: true,
          userId: true,
          employeeId: true,
          type: { select: { code: true, defaultSourceGroupId: true } },
          tags: { select: { tagId: true, tag: { select: { code: true } } } },
          employee: { select: { phone: true, email: true } },
        },
      },
      membership: { select: { status: true, effectiveFrom: true, effectiveTo: true } },
      campaign: {
        select: {
          code: true,
          status: true,
          effectiveFrom: true,
          effectiveTo: true,
          cookieWindowDays: true,
          protectWindowDays: true,
          allowSelfReferral: true,
          defaultSourceGroupId: true,
          rules: { select: { typeId: true, tagId: true, sourceGroupId: true } },
          sites: { select: { siteId: true } },
          landings: CHON_RANG_BUOC_CAMPAIGN,
        },
      },
      site: {
        select: {
          id: true,
          baseUrl: true,
          allowedDomains: true,
          status: true,
          trackingEnabled: true,
          landingPages: { select: CHON_TRANG_DICH },
        },
      },
    },
  });
  if (!asset) return { ok: false, lyDo: "KHONG_TIM_THAY" };

  // L3a: một đối tác có NHIỀU tài khoản (bảng nối `AffiliatePartyUser`; cột cũ `Affiliate.userId` chỉ là người đại diện). Tự giới thiệu so theo SĐT/email của MỌI tài khoản còn gắn với đối tác
  // (đang truy cập được HOẶC bị tạm ngừng cổng — tạm ngừng không biến họ thành người ngoài), không chỉ người đại diện.

  const unknown = await db.leadSourceGroup.findUnique({ where: { code: "UNKNOWN" }, select: { id: true } });
  if (!unknown) return { ok: false, lyDo: "THIEU_NHOM_UNKNOWN" };

  // Lần bấm: chỉ tin id lượt bấm khi nó THUỘC đúng link này (id lạ/của link khác ⇒ không có mốc click để đo cửa sổ cookie, không ném).
  const clickId = typeof p.clickId === "string" && CLICK_ID_RE.test(p.clickId) ? p.clickId : null;
  const click = clickId ? await db.referralClick.findFirst({ where: { id: clickId, assetId: asset.id }, select: { id: true, occurredAt: true } }) : null;
  // R9 · T2 — tín hiệu lượt bấm cho cổng quyết định: VẮNG (không gửi) · KHÔNG_HỢP_LỆ (gửi mà sai/không thuộc link/không thấy) · ĐÃ_DÙNG (gắn với biểu mẫu KHÁC) · HỢP_LỆ.
  // Tra theo (assetId, clickId) để đi bằng chỉ mục `assetId`; gửi lại CHÍNH biểu mẫu này (cùng `idempotencyKey`) không phải phát lại.
  const coGuiClick = p.clickId !== undefined && p.clickId !== null && p.clickId !== "";
  let tinHieuClick: TinHieuClick = "VANG";
  if (coGuiClick) {
    if (!click) tinHieuClick = "KHONG_HOP_LE";
    else {
      const daDung = await db.affiliateReferral.findFirst({ where: { assetId: asset.id, clickId: click.id, NOT: { idempotencyKey: p.idempotencyKey } }, select: { id: true } });
      tinHieuClick = daDung ? "DA_DUNG" : "HOP_LE";
    }
  }

  const chuoi: ChuoiLink = {
    // Link cũ (trước AFF-L6) chưa chụp tên miền đích ⇒ tên miền của `baseUrl` — cùng quy tắc với `chuoiTuDong` (doc-link.ts).
    taiSan: { status: asset.status, landingPath: asset.landingPath, landingHost: asset.landingHost ?? hostCuaBaseUrl(asset.site.baseUrl) ?? "" },
    doiTac: { status: asset.party.status },
    thanhVien: asset.membership,
    campaign: {
      code: asset.campaign.code,
      status: asset.campaign.status,
      effectiveFrom: asset.campaign.effectiveFrom,
      effectiveTo: asset.campaign.effectiveTo,
      cookieWindowDays: asset.campaign.cookieWindowDays,
    },
    campaignGanSite: asset.campaign.sites.some((s) => s.siteId === asset.site.id),
    site: { baseUrl: asset.site.baseUrl, allowedDomains: asset.site.allowedDomains, status: asset.site.status, trackingEnabled: asset.site.trackingEnabled },
    // Cùng MỘT hàm giải host + thu hẹp theo campaign với /r, beacon và phát link — intake không được chấp nhận thứ mà /r từ chối.
    trangDich: trangDichHieuLuc({ baseUrl: asset.site.baseUrl, trangDich: asset.site.landingPages, rangBuoc: rangBuocCuaCampaign(asset.campaign.landings, asset.site.id) }),
  };

  const tuGioiThieu = kiemTuGioiThieu(
    await danhTinhDoiTacDeChan({ ...asset.party, id: asset.partyId }),
    { phones: [p.khach.phone], emails: [p.khach.email] },
    asset.campaign.allowSelfReferral,
  );

  const nguon = giaiNguonCuaDoiTac({
    quyTac: asset.campaign.rules,
    campaignMacDinh: asset.campaign.defaultSourceGroupId,
    doiTacLoaiId: asset.party.typeId,
    doiTacNhanIds: asset.party.tags.map((t) => t.tagId),
    loaiMacDinh: asset.party.type?.defaultSourceGroupId ?? null,
  });

  const acao = acaoChoOrigin(p.origin, asset.site.allowedDomains);
  const tinHieuOrigin: "VANG" | "KHOP" | "LECH" = p.origin === null || p.origin === "" ? "VANG" : acao !== null ? "KHOP" : "LECH";
  const quyetDinh = quyetDinhReferral({
    chuoi: kiemChuoiLink(chuoi, p.now),
    cookie: { clickAt: click?.occurredAt ?? null, cookieWindowDays: asset.campaign.cookieWindowDays },
    tuGioiThieu,
    nguon,
    origin: tinHieuOrigin,
    click: tinHieuClick,
    now: p.now,
  });

  // Snapshot KHÔNG PII: mã công khai của đối tác/campaign, bậc quyết định nguồn, loại/nhãn. Đổi cấu hình về sau không viết lại lịch sử (đặc tả §25).
  // Dựng ở MỘT nơi (`dungSnapshotReferral`) — đường duyệt tay dùng đúng hàm này, nên hai đường không thể lệch tên khoá.
  const snapshot: Record<string, unknown> = dungSnapshotReferral({
    affiliateCode: asset.party.code,
    campaignCode: asset.campaign.code,
    method: asset.type,
    typeCode: asset.party.type?.code ?? null,
    tagCodes: asset.party.tags.map((t) => t.tag.code),
    tu: quyetDinh.loai === "HOP_LE" ? quyetDinh.tuDau : null,
    origin: tinHieuOrigin,
    click: tinHieuClick,
    doTinCay: doTinCayReferral({ origin: tinHieuOrigin, click: tinHieuClick }),
    canCuTuGioiThieu: quyetDinh.canCuTuGioiThieu,
  });

  const sourceGroupId = quyetDinh.loai === "HOP_LE" ? quyetDinh.sourceGroupId : unknown.id;
  const tinHieu: AffiliateReferralDauVao | null =
    quyetDinh.loai === "HOP_LE" ? { affiliateId: asset.partyId, sourceGroupId: quyetDinh.sourceGroupId, snapshot } : null;

  return {
    ok: true,
    tinHieu,
    acao,
    ghi: {
      partyId: asset.partyId,
      membershipId: asset.membershipId,
      campaignId: asset.campaignId,
      assetId: asset.id,
      clickId: click?.id ?? null,
      method: asset.type,
      protectWindowDays: asset.campaign.protectWindowDays,
      quyetDinh,
      sourceGroupId,
      snapshot,
      idempotencyKey: p.idempotencyKey,
    },
  };
}

const DA_TU_CHOI = new Set(["REJECTED", "REJECTED_DUPLICATE"]);

/**
 * SAU KHI lead mới đã commit: ghi dòng referral theo luật quy nguồn đã thắng. NGOÀI giao dịch tạo lead có chủ đích — lỗi ở đây không được làm mất khách (T4).
 * Idempotent theo `idempotencyKey` (gọi lại không đẻ dòng thứ hai).
 */
export async function ghiReferralSauKhiTaoLead(p: { ghi: GhiReferral; leadId: string; centerId: string | null; now: Date }): Promise<{ status: string }> {
  const cu = await db.affiliateReferral.findUnique({ where: { idempotencyKey: p.ghi.idempotencyKey }, select: { status: true } });
  if (cu) return { status: cu.status };
  const attribution = await docKetQuaQuyNguonCuaLead(db, p.leadId);
  const kq = trangThaiSauQuyNguon({ quyetDinh: p.ghi.quyetDinh, attribution, partyId: p.ghi.partyId });
  await db.affiliateReferral.create({
    data: {
      partyId: p.ghi.partyId,
      membershipId: p.ghi.membershipId,
      campaignId: p.ghi.campaignId,
      assetId: p.ghi.assetId,
      clickId: p.ghi.clickId,
      leadId: p.leadId,
      method: p.ghi.method,
      status: kq.status,
      sourceGroupId: p.ghi.sourceGroupId,
      sourceSnapshot: p.ghi.snapshot as Prisma.InputJsonValue,
      protectedUntil: kq.status === "VALID" ? new Date(p.now.getTime() + p.ghi.protectWindowDays * NGAY_MS) : null,
      rejectedAt: DA_TU_CHOI.has(kq.status) ? p.now : null,
      resolutionReason: kq.lyDo,
      idempotencyKey: p.ghi.idempotencyKey,
      centerId: p.centerId,
    },
  });
  return { status: kq.status };
}

/**
 * Khách TRÙNG SĐT (không tạo lead mới): người ghi nhận đầu tiên giữ công. Quyết định TỪ CHỐI vẫn giữ nguyên lý do gốc (link hỏng / tự giới thiệu quan trọng hơn «trùng»).
 * Idempotent theo `idempotencyKey` (gửi lại cùng biểu mẫu không đẻ dòng thứ hai).
 */
export async function ghiReferralChoLeadCu(p: { ghi: GhiReferral; leadId: string; now: Date }): Promise<{ status: string }> {
  const cu = await db.affiliateReferral.findUnique({ where: { idempotencyKey: p.ghi.idempotencyKey }, select: { status: true } });
  if (cu) return { status: cu.status };
  const lead = await db.lead.findUnique({ where: { id: p.leadId }, select: { centerId: true } });
  const q = p.ghi.quyetDinh;
  const lyDo = q.loai === "TU_CHOI" ? `${q.ma}:${q.chiTiet}` : "Khách đã có hồ sơ trong cửa sổ chống trùng — giữ người ghi nhận đầu tiên.";
  const status = q.loai === "TU_CHOI" ? "REJECTED" : "REJECTED_DUPLICATE";
  await db.affiliateReferral.create({
    data: {
      partyId: p.ghi.partyId,
      membershipId: p.ghi.membershipId,
      campaignId: p.ghi.campaignId,
      assetId: p.ghi.assetId,
      clickId: p.ghi.clickId,
      leadId: p.leadId,
      method: p.ghi.method,
      status,
      sourceGroupId: p.ghi.sourceGroupId,
      sourceSnapshot: p.ghi.snapshot as Prisma.InputJsonValue,
      rejectedAt: p.now,
      resolutionReason: lyDo,
      idempotencyKey: p.ghi.idempotencyKey,
      centerId: lead?.centerId ?? null,
    },
  });
  return { status };
}
