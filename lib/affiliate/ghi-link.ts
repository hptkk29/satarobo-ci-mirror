/**
 * lib/affiliate/ghi-link.ts — MỘT NƠI GHI link / QR / mã giới thiệu: `phatLink` · `thuHoiLink` · `xoayLink` (AFF-P1, docs/source-commission/12). Luật ĐƯỢC / KHÔNG ĐƯỢC ở `ghi-link-dau-vao.ts`
 * (thuần); tệp này đọc DB rồi ghi.
 *
 * ── Khuôn (chép `ghi-website.ts` / `ghi-membership.ts`) ──────────────────────────────────────────────────────────
 *  · Quyền do NƠI GỌI kiểm (Server Action): `affiliate_links:manage`. Link là danh mục TOÀN HỆ (không `centerId`).
 *  · THỨ TỰ KHOÁ chung với `ghi-campaign` / `ghi-membership` / `ghi-website`: campaign (`FOR SHARE`) → website (`FOR SHARE`) → membership (`FOR UPDATE`) → (xoay/thu hồi) link (`FOR UPDATE`).
 *    `FOR SHARE` ở campaign/website chặn người SỬA chúng (họ lấy `FOR UPDATE`) trong lúc ta đọc trạng thái để quyết định, mà không chặn hai người phát link song song cho hai đối tác.
 *    Hạn mức link đếm SAU khi khoá hàng membership (`FOR UPDATE`): hai người phát cùng lúc cho cùng một (đối tác × campaign) phải xếp hàng, người sau thấy số của người trước.
 *  · KHOÁ LẠC QUAN theo `updatedAt` mà người sửa ĐÃ THẤY, so `getTime()` trong JS SAU khi khoá hàng (không `updateMany({ where: { updatedAt } })`). `updatedAtDaThay` BẮT BUỘC, không mặc định (luật 7).
 *  · MỌI cổng đứng TRƯỚC phép ghi đầu tiên; từ chối trong transaction là `throw LoiGhiAffiliate` (`return` KHÔNG rollback).
 *  · `kiemPhatLink` → `kiemChuoiLink` → `kiemLienKet`: CÙNG hàm với lúc khách bấm link. Không viết lại điều kiện ở đây.
 *  · TOKEN: `sinhToken()` (hoặc hàm TIÊM — để test ép đụng khoá). P2002 ⇒ thử lại với token mới, TỐI ĐA `SO_LAN_THU_TOKEN` lần rồi báo lỗi. Vòng thử lại bao QUANH cả `$transaction`: một câu lệnh lỗi
 *    làm Postgres huỷ cả transaction (25P02) nên không thể thử lại bên trong nó.
 *  · AUDIT cùng transaction; KHÔNG ghi token đầy đủ vào audit (nhật ký xem được rộng hơn quyền quản lý link) — chỉ 4 ký tự đầu.
 *  · Link đã thu hồi KHÔNG sống lại (TRIGGER của migration) ⇒ không có hàm «bật lại»; muốn dùng tiếp thì phát link mới / xoay.
 */
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { MODULE_AUDIT_AFFILIATE, LoiGhiAffiliate, aud, laLoiTrungKhoa, type KetQuaGhi, type NguoiGhi } from "./chung";
import {
  SO_LAN_THU_TOKEN,
  anToken,
  kiemDuongDanLink,
  kiemPhatLink,
  kiemThuHoi,
  phatLinkSchema,
  type ChuoiLink,
  type LoaiLink,
  type NguonCuaLink,
} from "./ghi-link-dau-vao";
import { dungDauVaoXemTruoc, xemTruocNguon } from "./ghi-campaign-dau-vao";
import { sinhToken } from "./token";
import { CHON_RANG_BUOC_CAMPAIGN, CHON_TRANG_DICH, rangBuocCuaCampaign, trangDichHieuLuc } from "./trang-dich-hieu-luc";
import { chonTrangKhop } from "./website-hop-le";

type Tx = Prisma.TransactionClient;

const ENTITY_LINK = "AffiliateTrackingAsset";

const khongTimThayLink = () => new LoiGhiAffiliate("Không tìm thấy link này.", "khongTimThay");
const vuaDoiLink = () => new LoiGhiAffiliate("Link vừa được người khác thay đổi — hãy tải lại rồi thử lại.", "vuaDoi");

export type KetQuaPhatLink = KetQuaGhi<{ id: string; token: string; updatedAt: string }>;
export type KetQuaThuHoiLink = KetQuaGhi<{ updatedAt: string }>;
export type KetQuaXoayLink = KetQuaGhi<{ id: string; token: string; updatedAt: string; thuHoiId: string }>;

function loiTuZod(e: { issues: readonly { path: PropertyKey[]; message: string }[] }): { ok: false; loi: string; truong: string } {
  const i = e.issues[0];
  return { ok: false, loi: i?.message ?? "Dữ liệu không hợp lệ.", truong: typeof i?.path[0] === "string" ? i.path[0] : "chung" };
}

function dich(e: unknown): { ok: false; loi: string; truong?: string } | null {
  if (e instanceof LoiGhiAffiliate) return { ok: false, loi: e.message, truong: e.truong };
  return null;
}

const HET_LAN = Symbol("het-lan-thu-token");

/** Chạy `lam(token)` — mỗi lần MỘT token mới; đụng khoá duy nhất (P2002) thì thử lại. Đủ `SO_LAN_THU_TOKEN` lần vẫn đụng ⇒ `HET_LAN`. Lỗi khác ném ra ngay. */
async function voiTokenMoi<T>(sinh: () => string, lam: (token: string) => Promise<T>): Promise<T | typeof HET_LAN> {
  for (let lan = 0; lan < SO_LAN_THU_TOKEN; lan += 1) {
    try {
      return await lam(sinh());
    } catch (e) {
      if (laLoiTrungKhoa(e)) continue;
      throw e;
    }
  }
  return HET_LAN;
}

const LOI_HET_LAN = { ok: false, loi: `Không sinh được mã link duy nhất sau ${SO_LAN_THU_TOKEN} lần thử — hãy thử lại sau ít giây.`, truong: "chung" } as const;

// ── Khoá ────────────────────────────────────────────────────────────────────────────────────────────────────

async function khoaChiaCampaign(tx: Tx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "AffiliateCampaign" WHERE "id" = ${id} FOR SHARE`;
}
async function khoaChiaWebsite(tx: Tx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "AffiliateSite" WHERE "id" = ${id} FOR SHARE`;
}
async function khoaMembership(tx: Tx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "AffiliateMembership" WHERE "id" = ${id} FOR UPDATE`;
}
async function khoaLink(tx: Tx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "AffiliateTrackingAsset" WHERE "id" = ${id} FOR UPDATE`;
}

type ChuoiPhat = { partyId: string; campaignId: string; chuoi: Omit<ChuoiLink, "taiSan">; nguon: NguonCuaLink };

/** Đọc (SAU khi đã khoá) chuỗi cần cho `kiemPhatLink`: membership + đối tác + campaign + website + trang đích. */
async function docChuoiPhat(tx: Tx, membershipId: string, siteId: string, now: Date): Promise<ChuoiPhat> {
  const m = await tx.affiliateMembership.findUnique({
    where: { id: membershipId },
    select: {
      partyId: true,
      campaignId: true,
      status: true,
      effectiveFrom: true,
      effectiveTo: true,
      party: { select: { status: true, typeId: true, type: { select: { defaultSourceGroupId: true } }, tags: { select: { tagId: true } } } },
      campaign: {
        select: {
          code: true,
          status: true,
          effectiveFrom: true,
          effectiveTo: true,
          cookieWindowDays: true,
          defaultSourceGroupId: true,
          rules: { select: { typeId: true, tagId: true, sourceGroupId: true } },
          sites: { select: { siteId: true } },
          landings: CHON_RANG_BUOC_CAMPAIGN,
        },
      },
    },
  });
  if (!m) throw new LoiGhiAffiliate("Không tìm thấy chương trình (membership) của đối tác.", "membershipId");
  const s = await tx.affiliateSite.findUnique({
    where: { id: siteId },
    select: { baseUrl: true, allowedDomains: true, status: true, trackingEnabled: true, landingPages: { select: CHON_TRANG_DICH } },
  });
  if (!s) throw new LoiGhiAffiliate("Không tìm thấy website này.", "siteId");
  // Nguồn khách của (đối tác × campaign): CHÍNH `giaiNguonCuaDoiTac` (qua `xemTruocNguon`) — cùng phép nối đầu vào với màn xem trước, với `nhan-referral.ts` và với đường duyệt tay.
  const idNguon = [...new Set([...m.campaign.rules.map((r) => r.sourceGroupId), ...(m.campaign.defaultSourceGroupId ? [m.campaign.defaultSourceGroupId] : []), ...(m.party.type?.defaultSourceGroupId ? [m.party.type.defaultSourceGroupId] : [])])];
  const nguonDb =
    idNguon.length > 0
      ? await tx.leadSourceGroup.findMany({ where: { id: { in: idNguon } }, select: { id: true, code: true, name: true, status: true, selectable: true, effectiveFrom: true, effectiveTo: true } })
      : [];
  const nguon = xemTruocNguon({
    dauVao: dungDauVaoXemTruoc({
      quyTac: m.campaign.rules,
      campaignMacDinh: m.campaign.defaultSourceGroupId,
      doiTac: { loaiId: m.party.typeId, nhanIds: m.party.tags.map((t) => t.tagId) },
      loaiMacDinh: m.party.type?.defaultSourceGroupId ?? null,
    }),
    nguon: new Map(nguonDb.map((n) => [n.id, { id: n.id, code: n.code, ten: n.name, status: n.status, selectable: n.selectable, effectiveFrom: n.effectiveFrom, effectiveTo: n.effectiveTo }])),
    now,
  });
  return {
    partyId: m.partyId,
    campaignId: m.campaignId,
    nguon: nguon.loai === "XEM_TAY" ? { loai: "XEM_TAY", lyDo: nguon.lyDo } : { loai: "NGUON", canhBao: nguon.canhBao },
    chuoi: {
      doiTac: { status: m.party.status },
      thanhVien: { status: m.status, effectiveFrom: m.effectiveFrom, effectiveTo: m.effectiveTo },
      campaign: { code: m.campaign.code, status: m.campaign.status, effectiveFrom: m.campaign.effectiveFrom, effectiveTo: m.campaign.effectiveTo, cookieWindowDays: m.campaign.cookieWindowDays },
      campaignGanSite: m.campaign.sites.some((x) => x.siteId === siteId),
      site: { baseUrl: s.baseUrl, allowedDomains: s.allowedDomains, status: s.status, trackingEnabled: s.trackingEnabled },
      // MỘT hàm giải host + thu hẹp theo campaign cho mọi nơi dựng chuỗi (`trang-dich-hieu-luc.ts`) — phát link phải thấy ĐÚNG những trang mà lúc khách bấm cổng cũng thấy.
      trangDich: trangDichHieuLuc({ baseUrl: s.baseUrl, trangDich: s.landingPages, rangBuoc: rangBuocCuaCampaign(m.campaign.landings, siteId) }),
    },
  };
}

// ── PHÁT ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function phatLink(p: {
  nguoi: NguoiGhi;
  vao: unknown;
  /** Đồng hồ (luật 19). BẮT BUỘC. */
  now: Date;
  /** Nguồn token — mặc định `sinhToken` (ngẫu nhiên mật mã). Test TIÊM để ép đụng khoá. */
  sinh?: () => string;
}): Promise<KetQuaPhatLink> {
  const kq = phatLinkSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  const dd = kiemDuongDanLink(v.landingPath);
  if (!dd.ok) return dd;
  try {
    // Cần campaign của membership để khoá nó TRƯỚC (campaign → website → membership). `campaignId` là bất biến của dòng membership.
    const truoc = await db.affiliateMembership.findUnique({ where: { id: v.membershipId }, select: { campaignId: true } });
    if (!truoc) return { ok: false, loi: "Không tìm thấy chương trình (membership) của đối tác.", truong: "membershipId" };

    const ra = await voiTokenMoi(p.sinh ?? sinhToken, (token) =>
      db.$transaction(async (tx) => {
        await khoaChiaCampaign(tx, truoc.campaignId);
        await khoaChiaWebsite(tx, v.siteId);
        await khoaMembership(tx, v.membershipId);
        const c = await docChuoiPhat(tx, v.membershipId, v.siteId, p.now);
        // Đếm SAU khoá membership: người phát song song cho cùng (đối tác × campaign) đã xếp hàng.
        const soLinkDangChay = await tx.affiliateTrackingAsset.count({ where: { membershipId: v.membershipId, status: "ACTIVE" } });
        const kiem = kiemPhatLink({ partyId: v.partyId, membershipPartyId: c.partyId, chuoi: c.chuoi, duongDan: dd.duongDan, landingPageId: v.landingPageId ?? null, soLinkDangChay, laXoay: false, nguon: c.nguon }, p.now);
        if (!kiem.ok) throw new LoiGhiAffiliate(kiem.loi, kiem.truong);

        const r = await tx.affiliateTrackingAsset.create({
          data: {
            partyId: c.partyId,
            membershipId: v.membershipId,
            campaignId: c.campaignId,
            siteId: v.siteId,
            landingPath: kiem.landingPath,
            // Ảnh chụp trang đích LÚC PHÁT (AFF-L6): tên miền + id trang đích, suy ở máy chủ từ dòng DB — không từ client.
            landingHost: kiem.landingHost,
            landingPageId: kiem.landingPageId,
            publicToken: token,
            type: v.type,
            label: v.label,
            createdById: p.nguoi.userId,
          },
        });
        await writeAudit({
          tx,
          actor: aud(p.nguoi),
          module: MODULE_AUDIT_AFFILIATE,
          entityType: ENTITY_LINK,
          entityId: r.id,
          action: "AFFILIATE_LINK_PHAT",
          newValues: { partyId: r.partyId, membershipId: r.membershipId, campaignId: r.campaignId, siteId: r.siteId, landingPath: r.landingPath, landingHost: r.landingHost, landingPageId: r.landingPageId, type: r.type, label: r.label, token: anToken(r.publicToken) },
          reason: `Phát ${v.type === "QR" ? "QR" : v.type === "CODE" ? "mã" : "link"} giới thiệu cho đối tác trong campaign ${c.chuoi.campaign.code}`,
        });
        return r;
      }),
    );
    if (ra === HET_LAN) return LOI_HET_LAN;
    return { ok: true, id: ra.id, token: ra.publicToken, updatedAt: ra.updatedAt.toISOString() };
  } catch (e) {
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

// ── THU HỒI ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function thuHoiLink(p: {
  nguoi: NguoiGhi;
  id: string;
  /** `updatedAt` mà người thu hồi ĐÃ THẤY. BẮT BUỘC. */
  updatedAtDaThay: Date;
  lyDo: string | null;
  now: Date;
}): Promise<KetQuaThuHoiLink> {
  try {
    const ra = await db.$transaction(async (tx) => {
      await khoaLink(tx, p.id);
      const dong = await tx.affiliateTrackingAsset.findUnique({ where: { id: p.id } });
      if (!dong) throw khongTimThayLink();
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoiLink();
      const kiem = kiemThuHoi({ status: dong.status, lyDo: p.lyDo });
      if (!kiem.ok) throw new LoiGhiAffiliate(kiem.loi, kiem.truong);
      const lyDo = (p.lyDo ?? "").trim();
      const moi = await tx.affiliateTrackingAsset.update({
        where: { id: dong.id },
        data: { status: "REVOKED", revokedAt: p.now, revokedById: p.nguoi.userId, revokedReason: lyDo },
      });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_LINK,
        entityId: dong.id,
        action: "AFFILIATE_LINK_THU_HOI",
        oldValues: { status: dong.status },
        newValues: { status: moi.status, token: anToken(dong.publicToken) },
        changedFields: ["status"],
        reason: lyDo,
      });
      return moi;
    });
    return { ok: true, updatedAt: ra.updatedAt.toISOString() };
  } catch (e) {
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

// ── XOAY ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Thu hồi link cũ + phát link mới CÙNG định danh (đối tác · membership · website · trang đích · loại · nhãn) trong MỘT transaction, `rotatedFromId` trỏ về link cũ.
 * Chuỗi được kiểm LẠI (`kiemPhatLink`): xoay trên chuỗi đã hỏng chỉ đẻ thêm một link chết — từ chối, bảo người dùng sửa campaign/đối tác trước (hoặc chỉ thu hồi).
 * Hạn mức link KHÔNG chặn xoay (thu hồi một, tạo một ⇒ số link đang chạy không đổi).
 */
export async function xoayLink(p: {
  nguoi: NguoiGhi;
  id: string;
  updatedAtDaThay: Date;
  lyDo: string | null;
  now: Date;
  sinh?: () => string;
}): Promise<KetQuaXoayLink> {
  try {
    const truoc = await db.affiliateTrackingAsset.findUnique({ where: { id: p.id }, select: { campaignId: true, siteId: true, membershipId: true } });
    if (!truoc) throw khongTimThayLink();

    const ra = await voiTokenMoi(p.sinh ?? sinhToken, (token) =>
      db.$transaction(async (tx) => {
        await khoaChiaCampaign(tx, truoc.campaignId);
        await khoaChiaWebsite(tx, truoc.siteId);
        await khoaMembership(tx, truoc.membershipId);
        await khoaLink(tx, p.id);
        const cu = await tx.affiliateTrackingAsset.findUnique({ where: { id: p.id } });
        if (!cu) throw khongTimThayLink();
        if (cu.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoiLink();
        const kiemCu = kiemThuHoi({ status: cu.status, lyDo: p.lyDo });
        if (!kiemCu.ok) throw new LoiGhiAffiliate(kiemCu.loi, kiemCu.truong);

        const c = await docChuoiPhat(tx, cu.membershipId, cu.siteId, p.now);
        // Trang đích của link cũ: id đã chụp; thiếu (link cũ, hoặc trang đã bị xoá ⇒ FK SET NULL) mà link ĐÃ chụp tên miền riêng thì tìm lại theo (tên miền, đường dẫn) — KHÔNG để rơi về tên miền
        // của website, vì như vậy link xoay sẽ âm thầm trỏ sang tên miền khác với link cũ.
        let trangCuId = cu.landingPageId;
        if (trangCuId === null && cu.landingHost !== null) {
          trangCuId = chonTrangKhop(c.chuoi.trangDich, cu.landingHost, cu.landingPath)?.id ?? null;
          if (trangCuId === null) throw new LoiGhiAffiliate(`Không xoay mã được: trang đích của link (${cu.landingHost}${cu.landingPath}) không còn trong danh sách được phép.`, "landingPath");
        }
        const kiem = kiemPhatLink({ partyId: cu.partyId, membershipPartyId: c.partyId, chuoi: c.chuoi, duongDan: cu.landingPath, landingPageId: trangCuId, soLinkDangChay: 0, laXoay: true, nguon: c.nguon }, p.now);
        if (!kiem.ok) throw new LoiGhiAffiliate(`Không xoay mã được: ${kiem.loi}`, kiem.truong);

        const lyDo = (p.lyDo ?? "").trim();
        const daThuHoi = await tx.affiliateTrackingAsset.update({
          where: { id: cu.id },
          data: { status: "REVOKED", revokedAt: p.now, revokedById: p.nguoi.userId, revokedReason: `Xoay mã: ${lyDo}` },
        });
        const moi = await tx.affiliateTrackingAsset.create({
          data: {
            partyId: cu.partyId,
            membershipId: cu.membershipId,
            campaignId: cu.campaignId,
            siteId: cu.siteId,
            landingPath: cu.landingPath,
            // Link xoay giữ NGUYÊN trang đích của link cũ (cùng tên miền) — chụp lại từ kết quả cổng.
            landingHost: kiem.landingHost,
            landingPageId: kiem.landingPageId,
            publicToken: token,
            type: cu.type as LoaiLink,
            label: cu.label,
            rotatedFromId: cu.id,
            createdById: p.nguoi.userId,
          },
        });
        await writeAudit({
          tx,
          actor: aud(p.nguoi),
          module: MODULE_AUDIT_AFFILIATE,
          entityType: ENTITY_LINK,
          entityId: cu.id,
          action: "AFFILIATE_LINK_THU_HOI",
          oldValues: { status: cu.status },
          newValues: { status: daThuHoi.status, token: anToken(cu.publicToken), thayBang: moi.id },
          changedFields: ["status"],
          reason: `Xoay mã: ${lyDo}`,
        });
        await writeAudit({
          tx,
          actor: aud(p.nguoi),
          module: MODULE_AUDIT_AFFILIATE,
          entityType: ENTITY_LINK,
          entityId: moi.id,
          action: "AFFILIATE_LINK_XOAY",
          newValues: { rotatedFromId: cu.id, partyId: moi.partyId, membershipId: moi.membershipId, siteId: moi.siteId, landingPath: moi.landingPath, landingHost: moi.landingHost, landingPageId: moi.landingPageId, type: moi.type, token: anToken(moi.publicToken) },
          reason: `Xoay mã: ${lyDo}`,
        });
        return { moi, cuId: cu.id };
      }),
    );
    if (ra === HET_LAN) return LOI_HET_LAN;
    return { ok: true, id: ra.moi.id, token: ra.moi.publicToken, updatedAt: ra.moi.updatedAt.toISOString(), thuHoiId: ra.cuId };
  } catch (e) {
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}
