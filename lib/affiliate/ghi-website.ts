/**
 * lib/affiliate/ghi-website.ts — MỘT NƠI GHI website + trang đích Affiliate: `taoWebsite` · `suaWebsite` · `doiTrangThaiWebsite` · `xoaWebsite` · `themTrangDich` · `suaTrangDich`
 * · `batTatTrangDich` (AFF-P0b, docs/source-commission/12). Luật ĐƯỢC / KHÔNG ĐƯỢC ở `ghi-website-dau-vao.ts` (thuần), phép so tên miền/đường dẫn ở `website-hop-le.ts`;
 * tệp này đọc DB rồi ghi.
 *
 * ── Khuôn (chép `lib/nguon/danh-muc-ghi.ts` + `ghi-campaign.ts`) ────────────────────────────────────────────────────────────────────────────
 *  · Quyền do NƠI GỌI kiểm (Server Action): `affiliate_campaigns:manage`. Website là danh mục TOÀN HỆ (không `centerId`) nên hàm này không có phạm vi cơ sở.
 *  · KHOÁ LẠC QUAN theo `updatedAt` mà người sửa ĐÃ THẤY, so `getTime()` trong JS SAU khi khoá hàng (`FOR UPDATE`), KHÔNG bằng `updateMany({ where: { updatedAt } })` (độ chính xác
 *    micro/mili-giây lệch nhau ⇒ điều kiện không bao giờ khớp). `updatedAtDaThay` BẮT BUỘC, không mặc định (luật 7).
 *  · THỨ TỰ KHOÁ chung với `ghi-campaign.ts` (campaign → website): campaign chạy `FOR UPDATE` campaign rồi `FOR SHARE` website. Ở đây, khi cần đọc campaign làm mặc định, khoá campaign
 *    `FOR SHARE` TRƯỚC rồi mới khoá website `FOR UPDATE` — đảo ngược hai bước này là mở đường deadlock với người gắn website vào campaign.
 *  · Host của gốc URL ∈ tên miền được phép kiểm LẠI TRONG transaction, trên giá trị sẽ ghi (sau khoá), đứng trước phép ghi đầu tiên.
 *  · MỌI cổng đứng TRƯỚC phép ghi đầu tiên; từ chối trong transaction là `throw LoiGhiAffiliate` (luật rollback — `return` KHÔNG rollback), nơi ngoài bắt và dịch ra kết quả.
 *  · `writeAudit` CÙNG transaction, mang `reason` và đúng các trường đổi (cũ → mới).
 *  · Xoá cứng CHỈ cho website trống (không gắn campaign, không trang đích) — cổng đếm SAU khoá hàng. Trang đích không xoá, chỉ bật/tắt.
 *  · Đua tạo cùng mã / cùng mẫu đường dẫn: người sau nhận P2002 ⇒ «đã có», không phải lỗi 500.
 */
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { MODULE_AUDIT_AFFILIATE, LoiGhiAffiliate, aud, laLoiTrungKhoa, type KetQuaGhi, type NguoiGhi } from "./chung";
import { demLinkMatHieuLuc, trangDichHieuLuc, type TrangDichDb } from "./trang-dich-hieu-luc";
import { hostCuaBaseUrl } from "./website-hop-le";
import {
  chuanHoaNoiDungWebsite,
  kiemBatTatTrangDich,
  kiemDoiTrangThaiWebsite,
  kiemMauTrangDich,
  kiemSuaWebsite,
  kiemXoaWebsite,
  suaTrangDichSchema,
  suaWebsiteSchema,
  chuanHoaHostTrangDich,
  kiemSuaWebsiteVoiTrangDich,
  taoTrangDichSchema,
  taoWebsiteSchema,
  type GiaTriWebsite,
  type TrangThaiWebsite,
  type TruongSuaWebsite,
} from "./ghi-website-dau-vao";

type Tx = Prisma.TransactionClient;
type DongWebsite = Prisma.AffiliateSiteGetPayload<Record<string, never>>;

const ENTITY_SITE = "AffiliateSite";
const ENTITY_TRANG_DICH = "AffiliateLandingPage";

const khongTimThayWebsite = () => new LoiGhiAffiliate("Không tìm thấy website này.", "khongTimThay");
const vuaDoiWebsite = () => new LoiGhiAffiliate("Website vừa được người khác thay đổi — hãy tải lại rồi thử lại.", "vuaDoi");
const khongTimThayTrangDich = () => new LoiGhiAffiliate("Không tìm thấy trang đích này.", "khongTimThay");
const vuaDoiTrangDich = () => new LoiGhiAffiliate("Trang đích vừa được người khác thay đổi — hãy tải lại rồi thử lại.", "vuaDoi");

export type KetQuaTaoWebsite = KetQuaGhi<{ id: string; code: string; updatedAt: string }>;
export type KetQuaSuaWebsite = KetQuaGhi<{ doi: boolean; truongDoi: TruongSuaWebsite[]; updatedAt: string }>;
export type KetQuaDoiTrangThaiWebsite = KetQuaGhi<{ tu: TrangThaiWebsite; den: TrangThaiWebsite; updatedAt: string; campaignDangChay: number }>;
export type KetQuaXoaWebsite = KetQuaGhi;
export type KetQuaTrangDich = KetQuaGhi<{ id: string; updatedAt: string; soLinkAnhHuong: number }>;
export type KetQuaBatTatTrangDich = KetQuaGhi<{ den: boolean; updatedAt: string; soLinkAnhHuong: number }>;

function loiTuZod(e: { issues: readonly { path: PropertyKey[]; message: string }[] }): { ok: false; loi: string; truong: string } {
  const i = e.issues[0];
  return { ok: false, loi: i?.message ?? "Dữ liệu không hợp lệ.", truong: typeof i?.path[0] === "string" ? i.path[0] : "chung" };
}

function dich(e: unknown, trung?: { loi: string; truong: string }): { ok: false; loi: string; truong?: string } | null {
  if (e instanceof LoiGhiAffiliate) return { ok: false, loi: e.message, truong: e.truong };
  if (trung && laLoiTrungKhoa(e)) return { ok: false, loi: trung.loi, truong: trung.truong };
  return null;
}

// ── Link bị ảnh hưởng (AFF-L6) ──────────────────────────────────────────────────────────────────────────────

/**
 * Số link ĐANG HOẠT ĐỘNG của website mất hiệu lực nếu danh sách trang đích đổi từ `truoc` sang `sau`. Đo trên danh sách trang đích CỦA WEBSITE (chưa thu hẹp theo campaign) — số này là CẬN DƯỚI
 * của tác động thật (campaign đã thu hẹp còn nhiều link chết hơn), đủ để KHÔNG BAO GIỜ làm hỏng link đang chạy mà người bấm không được báo.
 */
async function demLinkAnhHuong(tx: Tx, p: { siteId: string; baseUrl: string; truoc: readonly TrangDichDb[]; sau: readonly TrangDichDb[] }): Promise<number> {
  const links = await tx.affiliateTrackingAsset.findMany({ where: { siteId: p.siteId, status: "ACTIVE" }, select: { landingHost: true, landingPath: true } });
  if (links.length === 0) return 0;
  const baseHost = hostCuaBaseUrl(p.baseUrl) ?? "";
  return demLinkMatHieuLuc(
    links,
    baseHost,
    trangDichHieuLuc({ baseUrl: p.baseUrl, trangDich: p.truoc, rangBuoc: [] }),
    trangDichHieuLuc({ baseUrl: p.baseUrl, trangDich: p.sau, rangBuoc: [] }),
  );
}

const trangDichDb = (r: { id: string; host: string | null; pathPattern: string; label: string | null; isActive: boolean; trackingEnabled: boolean }): TrangDichDb => ({
  id: r.id,
  host: r.host,
  pathPattern: r.pathPattern,
  label: r.label,
  isActive: r.isActive,
  trackingEnabled: r.trackingEnabled,
});

// ── Khoá ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Khoá hàng website (`FOR UPDATE`) rồi đọc nó. Chặn người ghi khác VÀ chặn chèn trang đích / gắn campaign mới (FK KEY SHARE) cho tới khi ta xong. */
async function khoaWebsite(tx: Tx, id: string): Promise<DongWebsite> {
  await tx.$queryRaw`SELECT "id" FROM "AffiliateSite" WHERE "id" = ${id} FOR UPDATE`;
  const dong = await tx.affiliateSite.findUnique({ where: { id } });
  if (!dong) throw khongTimThayWebsite();
  return dong;
}

/** Khoá campaign `FOR SHARE` (cùng thứ tự với `ghi-campaign.ts`: campaign TRƯỚC website). */
async function khoaCampaignChia(tx: Tx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "AffiliateCampaign" WHERE "id" = ${id} FOR SHARE`;
}

/** Campaign làm mặc định phải tồn tại và chưa kết thúc. Gọi SAU `khoaCampaignChia`. */
async function kiemCampaignMacDinh(tx: Tx, id: string): Promise<void> {
  const c = await tx.affiliateCampaign.findUnique({ where: { id }, select: { status: true, name: true } });
  if (!c) throw new LoiGhiAffiliate("Không tìm thấy campaign này.", "defaultCampaignId");
  if (c.status === "ENDED") throw new LoiGhiAffiliate(`Campaign «${c.name}» đã kết thúc — chọn campaign khác.`, "defaultCampaignId");
}

const giaTriTuDong = (r: DongWebsite): GiaTriWebsite => ({
  name: r.name,
  baseUrl: r.baseUrl,
  allowedDomains: r.allowedDomains,
  trackingEnabled: r.trackingEnabled,
  defaultCampaignId: r.defaultCampaignId,
});

const anhChup = (g: GiaTriWebsite): Record<string, unknown> => ({
  name: g.name,
  baseUrl: g.baseUrl,
  allowedDomains: [...g.allowedDomains],
  trackingEnabled: g.trackingEnabled,
  defaultCampaignId: g.defaultCampaignId,
});

// ── TẠO WEBSITE ─────────────────────────────────────────────────────────────────────────────────────────────

export async function taoWebsite(p: { nguoi: NguoiGhi; vao: unknown }): Promise<KetQuaTaoWebsite> {
  const kq = taoWebsiteSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  const nd = chuanHoaNoiDungWebsite(v);
  if (!nd.ok) return nd;
  try {
    // Cổng đọc ngoài transaction: báo «mã đã có» sớm cho ca không đua. Ca đua do P2002 bên dưới giữ.
    if (await db.affiliateSite.findUnique({ where: { code: v.code }, select: { id: true } })) {
      return { ok: false, loi: `Mã «${v.code}» đã có.`, truong: "code" };
    }
    const tao = await db.$transaction(async (tx) => {
      // Khoá campaign (nếu có) TRƯỚC — thứ tự chung với ghi-campaign. Kiểm lại nội dung TRONG transaction, trước phép ghi duy nhất.
      if (v.defaultCampaignId) {
        await khoaCampaignChia(tx, v.defaultCampaignId);
        await kiemCampaignMacDinh(tx, v.defaultCampaignId);
      }
      const lai = chuanHoaNoiDungWebsite(v);
      if (!lai.ok) throw new LoiGhiAffiliate(lai.loi, lai.truong);
      const r = await tx.affiliateSite.create({
        data: {
          code: v.code,
          name: v.name,
          baseUrl: lai.baseUrl,
          allowedDomains: lai.allowedDomains,
          status: "ACTIVE",
          trackingEnabled: v.trackingEnabled,
          defaultCampaignId: v.defaultCampaignId,
          createdById: p.nguoi.userId,
        },
      });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_SITE,
        entityId: r.id,
        action: "AFFILIATE_WEBSITE_TAO",
        newValues: { code: r.code, ...anhChup(giaTriTuDong(r)), status: r.status },
        reason: `Tạo website «${r.name}» (${r.code})`,
      });
      return r;
    });
    return { ok: true, id: tao.id, code: tao.code, updatedAt: tao.updatedAt.toISOString() };
  } catch (e) {
    const d = dich(e, { loi: `Mã «${v.code}» đã có.`, truong: "code" });
    if (d) return d;
    throw e;
  }
}

// ── SỬA WEBSITE ─────────────────────────────────────────────────────────────────────────────────────────────

export async function suaWebsite(p: {
  nguoi: NguoiGhi;
  id: string;
  /** `updatedAt` mà người sửa ĐÃ THẤY. BẮT BUỘC. */
  updatedAtDaThay: Date;
  vao: unknown;
  lyDo: string | null;
}): Promise<KetQuaSuaWebsite> {
  // Mã không đổi sau khi tạo: nói thẳng thay vì để Zod strict báo «Unrecognized key».
  if (typeof p.vao === "object" && p.vao !== null && "code" in p.vao && (p.vao as Record<string, unknown>).code !== undefined) {
    return { ok: false, loi: "Mã website không đổi được sau khi tạo.", truong: "code" };
  }
  const kq = suaWebsiteSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const patch = kq.data;
  try {
    const ra = await db.$transaction(async (tx) => {
      // Khoá campaign (chỉ khi người sửa gửi một campaign mặc định) TRƯỚC khoá website — thứ tự chung với ghi-campaign.
      if (typeof patch.defaultCampaignId === "string") await khoaCampaignChia(tx, patch.defaultCampaignId);
      const dong = await khoaWebsite(tx, p.id);
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoiWebsite();

      const hienTai = giaTriTuDong(dong);
      const kiem = kiemSuaWebsite({ hienTai, patch });
      if (!kiem.ok) throw new LoiGhiAffiliate(kiem.loi, kiem.truong);
      if (kiem.truongDoi.length === 0) return { doi: false as const, row: dong, truongDoi: [] as TruongSuaWebsite[] };
      // AFF-L6: gỡ một tên miền khỏi danh sách (hoặc đổi gốc URL sang tên miền đang là host riêng của một trang đích) khi còn trang đích dùng nó ⇒ TỪ CHỐI, trước phép ghi đầu tiên.
      if (kiem.truongDoi.includes("allowedDomains") || kiem.truongDoi.includes("baseUrl")) {
        const trang = await tx.affiliateLandingPage.findMany({ where: { siteId: dong.id, host: { not: null } }, select: { host: true } });
        const vuong = kiemSuaWebsiteVoiTrangDich({ baseUrlMoi: kiem.moi.baseUrl, allowedDomainsMoi: kiem.moi.allowedDomains, hostTrangDich: trang.map((t) => t.host) });
        if (vuong) throw new LoiGhiAffiliate(vuong.loi, vuong.truong);
      }
      // Campaign mặc định chỉ kiểm khi THẬT SỰ đổi sang một campaign: biểu mẫu gửi lại mọi ô, campaign đã kết thúc từ trước không được chặn việc sửa tên.
      if (kiem.doiCampaignMacDinh && kiem.moi.defaultCampaignId) await kiemCampaignMacDinh(tx, kiem.moi.defaultCampaignId);

      const data: Prisma.AffiliateSiteUncheckedUpdateInput = {};
      for (const k of kiem.truongDoi) {
        if (k === "allowedDomains") data.allowedDomains = [...kiem.moi.allowedDomains];
        else (data as Record<string, unknown>)[k] = kiem.moi[k];
      }
      const moi = await tx.affiliateSite.update({ where: { id: dong.id }, data });

      const cu: Record<string, unknown> = {};
      const nay: Record<string, unknown> = {};
      const motCu = anhChup(hienTai);
      const motMoi = anhChup(giaTriTuDong(moi));
      for (const k of kiem.truongDoi) {
        cu[k] = motCu[k];
        nay[k] = motMoi[k];
      }
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_SITE,
        entityId: dong.id,
        action: "AFFILIATE_WEBSITE_SUA",
        oldValues: cu,
        newValues: nay,
        changedFields: [...kiem.truongDoi],
        reason: (p.lyDo ?? "").trim() !== "" ? p.lyDo!.trim() : `Sửa website «${dong.name}»`,
      });
      return { doi: true as const, row: moi, truongDoi: kiem.truongDoi };
    });
    return { ok: true, doi: ra.doi, truongDoi: ra.truongDoi, updatedAt: ra.row.updatedAt.toISOString() };
  } catch (e) {
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

// ── ĐỔI TRẠNG THÁI ──────────────────────────────────────────────────────────────────────────────────────────

export async function doiTrangThaiWebsite(p: {
  nguoi: NguoiGhi;
  id: string;
  updatedAtDaThay: Date;
  den: TrangThaiWebsite;
  /** Bắt buộc ≥ 10 ký tự khi NGỪNG (cổng ở `kiemDoiTrangThaiWebsite`); tuỳ chọn khi bật lại. */
  lyDo: string | null;
}): Promise<KetQuaDoiTrangThaiWebsite> {
  try {
    const ra = await db.$transaction(async (tx) => {
      const dong = await khoaWebsite(tx, p.id);
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoiWebsite();
      const kiem = kiemDoiTrangThaiWebsite({ tu: dong.status, den: p.den, lyDo: p.lyDo });
      if (!kiem.ok) throw new LoiGhiAffiliate(kiem.loi, kiem.truong);
      // Số campaign ĐANG CHẠY dùng website này: ghi vào audit để người đọc nhật ký biết ngừng website này ảnh hưởng tới đâu (link của các campaign đó sẽ không còn hợp lệ).
      const campaignDangChay = await tx.affiliateCampaignSite.count({ where: { siteId: dong.id, campaign: { status: "ACTIVE" } } });
      const moi = await tx.affiliateSite.update({ where: { id: dong.id }, data: { status: p.den } });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_SITE,
        entityId: dong.id,
        action: p.den === "INACTIVE" ? "AFFILIATE_WEBSITE_NGUNG" : "AFFILIATE_WEBSITE_BAT_LAI",
        oldValues: { status: dong.status },
        newValues: { status: moi.status, campaignDangChay },
        changedFields: ["status"],
        reason: (p.lyDo ?? "").trim() !== "" ? p.lyDo!.trim() : `${p.den === "INACTIVE" ? "Ngừng" : "Bật lại"} website «${dong.name}»`,
      });
      return { tu: dong.status, row: moi, campaignDangChay };
    });
    return { ok: true, tu: ra.tu, den: p.den, updatedAt: ra.row.updatedAt.toISOString(), campaignDangChay: ra.campaignDangChay };
  } catch (e) {
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

// ── XOÁ ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function xoaWebsite(p: { nguoi: NguoiGhi; id: string; updatedAtDaThay: Date; lyDo: string | null }): Promise<KetQuaXoaWebsite> {
  try {
    await db.$transaction(async (tx) => {
      const dong = await khoaWebsite(tx, p.id);
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoiWebsite();
      // Đếm SAU khoá hàng: người gắn campaign (FOR SHARE) và người thêm trang đích (FK KEY SHARE) bị chặn cho tới khi ta xong.
      const [soTrangDich, soCampaign] = await Promise.all([
        tx.affiliateLandingPage.count({ where: { siteId: dong.id } }),
        tx.affiliateCampaignSite.count({ where: { siteId: dong.id } }),
      ]);
      const kiem = kiemXoaWebsite({ soTrangDich, soCampaign, lyDo: p.lyDo });
      if (!kiem.ok) throw new LoiGhiAffiliate(kiem.loi, kiem.truong);
      // Audit TRƯỚC khi xoá (cùng transaction): bản ghi còn nên suy được đơn vị tổ chức; rollback thì cả hai cùng lùi.
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_SITE,
        entityId: dong.id,
        action: "AFFILIATE_WEBSITE_XOA",
        oldValues: { code: dong.code, ...anhChup(giaTriTuDong(dong)), status: dong.status },
        reason: (p.lyDo ?? "").trim(),
      });
      await tx.affiliateSite.delete({ where: { id: dong.id } });
    });
    return { ok: true };
  } catch (e) {
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

// ── TRANG ĐÍCH ──────────────────────────────────────────────────────────────────────────────────────────────

export async function themTrangDich(p: { nguoi: NguoiGhi; vao: unknown }): Promise<KetQuaTrangDich> {
  const kq = taoTrangDichSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  const mau = kiemMauTrangDich(v.pathPattern);
  if (!mau.ok) return mau;
  try {
    const tao = await db.$transaction(async (tx) => {
      // FOR SHARE: website không bị xoá giữa chừng và không bị đổi dưới chân ta; tương thích với người gắn campaign (cũng FOR SHARE).
      await tx.$queryRaw`SELECT "id" FROM "AffiliateSite" WHERE "id" = ${v.siteId} FOR SHARE`;
      const site = await tx.affiliateSite.findUnique({ where: { id: v.siteId }, select: { id: true, code: true, baseUrl: true, allowedDomains: true } });
      if (!site) throw khongTimThayWebsite();
      // Tên miền của trang đích: ∈ danh sách của website (kiểm TRONG transaction, trước phép ghi), trùng gốc URL ⇒ NULL.
      const host = chuanHoaHostTrangDich({ raw: v.host, baseUrl: site.baseUrl, allowedDomains: site.allowedDomains });
      if (!host.ok) throw new LoiGhiAffiliate(host.loi, host.truong);
      const loiDaCo = `Đường dẫn «${mau.mau}» đã có${host.host ? ` trên tên miền ${host.host}` : ""} ở website này.`;
      if (await tx.affiliateLandingPage.findUnique({ where: { siteId_hostKey_pathPattern: { siteId: site.id, hostKey: host.hostKey, pathPattern: mau.mau } }, select: { id: true } })) {
        throw new LoiGhiAffiliate(loiDaCo, "pathPattern");
      }
      const r = await tx.affiliateLandingPage.create({
        data: { siteId: site.id, host: host.host, hostKey: host.hostKey, pathPattern: mau.mau, label: v.label, isActive: true, trackingEnabled: v.trackingEnabled ?? true, createdById: p.nguoi.userId },
      });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_TRANG_DICH,
        entityId: r.id,
        action: "AFFILIATE_TRANG_DICH_THEM",
        newValues: { siteId: site.id, siteCode: site.code, host: r.host, pathPattern: r.pathPattern, label: r.label, isActive: r.isActive, trackingEnabled: r.trackingEnabled },
        reason: `Thêm trang đích ${r.host ?? hostCuaBaseUrl(site.baseUrl) ?? ""}${r.pathPattern} cho website ${site.code}`,
      });
      return r;
    });
    return { ok: true, id: tao.id, updatedAt: tao.updatedAt.toISOString(), soLinkAnhHuong: 0 };
  } catch (e) {
    const d = dich(e, { loi: `Đường dẫn «${mau.mau}» đã có ở website này.`, truong: "pathPattern" });
    if (d) return d;
    throw e;
  }
}

export async function suaTrangDich(p: { nguoi: NguoiGhi; id: string; updatedAtDaThay: Date; vao: unknown; lyDo: string | null }): Promise<KetQuaTrangDich> {
  const kq = suaTrangDichSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const patch = kq.data;
  let mauMoi: string | undefined;
  if (patch.pathPattern !== undefined) {
    const mau = kiemMauTrangDich(patch.pathPattern);
    if (!mau.ok) return mau;
    mauMoi = mau.mau;
  }
  try {
    const ra = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AffiliateLandingPage" WHERE "id" = ${p.id} FOR UPDATE`;
      const dong = await tx.affiliateLandingPage.findUnique({ where: { id: p.id }, include: { site: { select: { code: true, baseUrl: true, allowedDomains: true } } } });
      if (!dong) throw khongTimThayTrangDich();
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoiTrangDich();

      const data: Prisma.AffiliateLandingPageUncheckedUpdateInput = {};
      const cu: Record<string, unknown> = {};
      const nay: Record<string, unknown> = {};
      let hostMoi = dong.host;
      let hostKeyMoi = dong.hostKey;
      if (patch.host !== undefined) {
        const h = chuanHoaHostTrangDich({ raw: patch.host, baseUrl: dong.site.baseUrl, allowedDomains: dong.site.allowedDomains });
        if (!h.ok) throw new LoiGhiAffiliate(h.loi, h.truong);
        if (h.hostKey !== dong.hostKey) {
          hostMoi = h.host;
          hostKeyMoi = h.hostKey;
          data.host = h.host;
          data.hostKey = h.hostKey;
          cu.host = dong.host;
          nay.host = h.host;
        }
      }
      const mauSau = mauMoi !== undefined && mauMoi !== dong.pathPattern ? mauMoi : dong.pathPattern;
      if (mauSau !== dong.pathPattern || hostKeyMoi !== dong.hostKey) {
        if (await tx.affiliateLandingPage.findUnique({ where: { siteId_hostKey_pathPattern: { siteId: dong.siteId, hostKey: hostKeyMoi, pathPattern: mauSau } }, select: { id: true } })) {
          throw new LoiGhiAffiliate(`Đường dẫn «${mauSau}» đã có${hostMoi ? ` trên tên miền ${hostMoi}` : ""} ở website này.`, "pathPattern");
        }
      }
      if (mauSau !== dong.pathPattern) {
        data.pathPattern = mauSau;
        cu.pathPattern = dong.pathPattern;
        nay.pathPattern = mauSau;
      }
      if (patch.label !== undefined && patch.label !== dong.label) {
        data.label = patch.label;
        cu.label = dong.label;
        nay.label = patch.label;
      }
      if (patch.trackingEnabled !== undefined && patch.trackingEnabled !== dong.trackingEnabled) {
        data.trackingEnabled = patch.trackingEnabled;
        cu.trackingEnabled = dong.trackingEnabled;
        nay.trackingEnabled = patch.trackingEnabled;
      }
      const truongDoi = Object.keys(data).filter((k) => k !== "hostKey");
      if (truongDoi.length === 0) return { dong, soLinkAnhHuong: 0 };

      // Báo trước tác động: đổi tên miền / đường dẫn / tắt theo dõi của một trang đích có thể làm chết link đang chạy. Đếm TRƯỚC phép ghi (đọc), ghi vào audit + trả cho giao diện.
      const tatCa = await tx.affiliateLandingPage.findMany({ where: { siteId: dong.siteId }, select: { id: true, host: true, pathPattern: true, label: true, isActive: true, trackingEnabled: true } });
      const truoc = tatCa.map(trangDichDb);
      const sau = tatCa.map((t) =>
        t.id === dong.id
          ? trangDichDb({ ...t, host: hostMoi, pathPattern: mauSau, trackingEnabled: patch.trackingEnabled ?? t.trackingEnabled })
          : trangDichDb(t),
      );
      const soLinkAnhHuong = await demLinkAnhHuong(tx, { siteId: dong.siteId, baseUrl: dong.site.baseUrl, truoc, sau });

      const moi = await tx.affiliateLandingPage.update({ where: { id: dong.id }, data });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_TRANG_DICH,
        entityId: dong.id,
        action: "AFFILIATE_TRANG_DICH_SUA",
        oldValues: cu,
        newValues: { ...nay, siteCode: dong.site.code, soLinkAnhHuong },
        changedFields: truongDoi,
        reason: (p.lyDo ?? "").trim() !== "" ? p.lyDo!.trim() : `Sửa trang đích ${dong.pathPattern} của website ${dong.site.code}`,
      });
      return { dong: moi, soLinkAnhHuong };
    });
    return { ok: true, id: ra.dong.id, updatedAt: ra.dong.updatedAt.toISOString(), soLinkAnhHuong: ra.soLinkAnhHuong };
  } catch (e) {
    const d = dich(e, { loi: "Đường dẫn này đã có ở website này.", truong: "pathPattern" });
    if (d) return d;
    throw e;
  }
}

export async function batTatTrangDich(p: { nguoi: NguoiGhi; id: string; updatedAtDaThay: Date; den: boolean; lyDo: string | null }): Promise<KetQuaBatTatTrangDich> {
  try {
    const ra = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AffiliateLandingPage" WHERE "id" = ${p.id} FOR UPDATE`;
      const dong = await tx.affiliateLandingPage.findUnique({ where: { id: p.id }, include: { site: { select: { code: true, baseUrl: true } } } });
      if (!dong) throw khongTimThayTrangDich();
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoiTrangDich();
      const kiem = kiemBatTatTrangDich({ tu: dong.isActive, den: p.den });
      if (!kiem.ok) throw new LoiGhiAffiliate(kiem.loi, kiem.truong);
      // TẮT một trang đích có thể làm chết link đang chạy: đếm trước (đọc) để báo; bật lại thì không ảnh hưởng link nào.
      let soLinkAnhHuong = 0;
      if (!p.den) {
        const tatCa = await tx.affiliateLandingPage.findMany({ where: { siteId: dong.siteId }, select: { id: true, host: true, pathPattern: true, label: true, isActive: true, trackingEnabled: true } });
        soLinkAnhHuong = await demLinkAnhHuong(tx, {
          siteId: dong.siteId,
          baseUrl: dong.site.baseUrl,
          truoc: tatCa.map(trangDichDb),
          sau: tatCa.map((t) => trangDichDb(t.id === dong.id ? { ...t, isActive: false } : t)),
        });
      }
      const moi = await tx.affiliateLandingPage.update({ where: { id: dong.id }, data: { isActive: p.den } });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_TRANG_DICH,
        entityId: dong.id,
        action: p.den ? "AFFILIATE_TRANG_DICH_BAT" : "AFFILIATE_TRANG_DICH_TAT",
        oldValues: { isActive: dong.isActive },
        newValues: { isActive: moi.isActive, pathPattern: dong.pathPattern, host: dong.host, siteCode: dong.site.code, soLinkAnhHuong },
        changedFields: ["isActive"],
        reason: (p.lyDo ?? "").trim() !== "" ? p.lyDo!.trim() : `${p.den ? "Bật" : "Tắt"} trang đích ${dong.pathPattern} của website ${dong.site.code}`,
      });
      return { moi, soLinkAnhHuong };
    });
    return { ok: true, den: ra.moi.isActive, updatedAt: ra.moi.updatedAt.toISOString(), soLinkAnhHuong: ra.soLinkAnhHuong };
  } catch (e) {
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}
