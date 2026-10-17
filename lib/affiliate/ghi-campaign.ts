/**
 * lib/affiliate/ghi-campaign.ts — MỘT NƠI GHI campaign Affiliate: `taoCampaign` · `suaCampaign` · `doiTrangThaiCampaign` · `themQuyTac` · `xoaQuyTac` · `ganWebsite` · `goWebsite`
 * (AFF-P0b, docs/source-commission/12). Luật ĐƯỢC / KHÔNG ĐƯỢC ở `ghi-campaign-dau-vao.ts` (thuần); tệp này đọc DB rồi ghi.
 *
 * ── Khuôn (chép `lib/nguon/danh-muc-ghi.ts`) ───────────────────────────────────────────────────────────────────
 *  · Quyền do NƠI GỌI kiểm (Server Action): `affiliate_campaigns:manage` cho soạn · `affiliate_campaigns:activate` cho đổi trạng thái. Campaign là danh mục TOÀN HỆ (Hội sở
 *    sở hữu, không `centerId`) nên hàm này không có phạm vi cơ sở — cách ly nằm ở cổng quyền.
 *  · KHOÁ LẠC QUAN theo `updatedAt` mà người sửa ĐÃ THẤY, so `getTime()` trong JS SAU khi khoá hàng (`FOR UPDATE`), KHÔNG bằng `updateMany({ where: { updatedAt } })`
 *    (độ chính xác micro/mili-giây lệch nhau ⇒ điều kiện không bao giờ khớp). `updatedAtDaThay` BẮT BUỘC, không mặc định (luật 7).
 *  · MỘT thứ tự khoá cho mọi thứ chạm campaign: hàng CAMPAIGN (`FOR UPDATE`) → hàng NGUỒN / WEBSITE mà nó trỏ tới (`FOR SHARE`) → ghi. Mọi người ghi quy tắc · website · thành viên
 *    đều khoá campaign TRƯỚC, nên điều kiện kích hoạt kiểm dưới khoá không bị xoá quy tắc / gỡ website / ngừng nguồn xen vào giữa lúc kiểm và lúc ghi. `FOR SHARE` trên nguồn
 *    chặn người ngừng nguồn (module Nguồn khoá hàng nguồn `FOR UPDATE`) cho tới khi ta xong.
 *  · Mọi thay đổi con (quy tắc · website · thành viên) đóng dấu lại `updatedAt` của campaign ⇒ người đang xem trang cũ mà bấm Kích hoạt nhận «vừa được đổi», không kích hoạt trên
 *    một cấu hình họ chưa thấy.
 *  · MỌI cổng đứng TRƯỚC phép ghi đầu tiên; từ chối trong transaction là `throw LoiGhiAffiliate` (luật rollback — `return` KHÔNG rollback), nơi ngoài bắt và dịch ra kết quả.
 *  · `writeAudit` CÙNG transaction, mang `reason` và đúng các trường đổi (cũ → mới). Audit của quy tắc / website gắn vào thực thể `AffiliateCampaign` (một dòng thời gian cho campaign).
 *  · Không xoá cứng campaign — không có hàm xoá ở đây. Kết thúc campaign KHÔNG đụng membership / referral.
 *  · `now` BẮT BUỘC ở mọi hàm (luật 19): hiệu lực · nguồn hết hạn · mốc phê duyệt không đọc đồng hồ ngầm.
 */
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { MODULE_AUDIT_AFFILIATE, LoiGhiAffiliate, aud, laLoiTrungKhoa, type NguoiGhi } from "./chung";
import { docDuLieuCongKichHoat } from "./cong-kich-hoat-doc";
import {
  dungRuleKey,
  kiemChuyenTrangThai,
  kiemDoiQuyTac,
  kiemGanWebsite,
  kiemGoWebsite,
  kiemDoiCheDoThuong,
  kiemKichHoatCampaign,
  NHAN_CHE_DO_THUONG,
  type CheDoThuong,
  type ChanKichHoat,
  type KetQuaDoiCheDoThuong,
  kiemSuaCampaign,
  LY_DO_TOI_THIEU_CAMPAIGN,
  lyDoNguonKhongDung,
  suaCampaignSchema,
  taoCampaignSchema,
  taoQuyTacSchema,
  tenHanhDongTrangThai,
  type GiaTriCampaign,
  type KetQuaDatTrangDich,
  type KetQuaDoiTrangThaiCampaign,
  type KetQuaSuaCampaign,
  type KetQuaTaoCampaign,
  type KetQuaViecCon,
  type NguonDeKiem,
  type TrangThaiCampaign,
} from "./ghi-campaign-dau-vao";
import { demLinkMatHieuLuc, trangDichHieuLuc } from "./trang-dich-hieu-luc";
import { hostCuaBaseUrl } from "./website-hop-le";

export type Tx = Prisma.TransactionClient;
type DongCampaign = Prisma.AffiliateCampaignGetPayload<Record<string, never>>;

const ENTITY_CAMPAIGN = "AffiliateCampaign";

const khongTimThay = () => new LoiGhiAffiliate("Không tìm thấy campaign này.", "khongTimThay");
const vuaDoi = () => new LoiGhiAffiliate("Campaign vừa được người khác thay đổi — hãy tải lại rồi thử lại.", "vuaDoi");

/** Bị chặn kích hoạt vì NHIỀU điều kiện: mang cả danh sách để giao diện liệt kê từng cái, không chỉ câu đầu. */
export class LoiKichHoat extends LoiGhiAffiliate {
  constructor(readonly lyDoChan: ChanKichHoat[]) {
    const cau = lyDoChan.map((c) => c.thongBao);
    super(cau.length === 1 ? cau[0]! : `Chưa kích hoạt được — còn ${cau.length} điều kiện chưa đạt:\n• ${cau.join("\n• ")}`, "kichHoat");
    this.name = "LoiKichHoat";
  }
}

function loiTuZod(e: { issues: readonly { path: PropertyKey[]; message: string }[] }): { ok: false; loi: string; truong: string } {
  const i = e.issues[0];
  return { ok: false, loi: i?.message ?? "Dữ liệu không hợp lệ.", truong: typeof i?.path[0] === "string" ? i.path[0] : "chung" };
}

// ── Khoá ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Khoá hàng campaign (`FOR UPDATE`) rồi đọc nó. ĐIỂM VÀO của mọi lệnh ghi campaign / quy tắc / website / thành viên — xem thứ tự khoá ở đầu tệp.
 * Export cho `ghi-membership.ts` (cùng thứ tự khoá).
 */
export async function khoaCampaignTrongTx(tx: Tx, id: string): Promise<DongCampaign> {
  await tx.$queryRaw`SELECT "id" FROM "AffiliateCampaign" WHERE "id" = ${id} FOR UPDATE`;
  const dong = await tx.affiliateCampaign.findUnique({ where: { id } });
  if (!dong) throw khongTimThay();
  return dong;
}

async function khoaNguon(tx: Tx, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT "id" FROM "LeadSourceGroup" WHERE "id" IN (${Prisma.join([...ids])}) ORDER BY "id" FOR SHARE`;
}

async function khoaWebsite(tx: Tx, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT "id" FROM "AffiliateSite" WHERE "id" IN (${Prisma.join([...ids])}) ORDER BY "id" FOR SHARE`;
}

/**
 * Đóng dấu lại `updatedAt` của campaign sau khi đổi một thứ CON của nó. Dùng đồng hồ của Prisma/máy (không phải `now` của nghiệp vụ): đây là mốc khoá lạc quan, cần KHÁC lần trước
 * kể cả khi hai lệnh chạy với cùng một `now`.
 */
export async function dongDauCampaign(tx: Tx, id: string): Promise<void> {
  await tx.affiliateCampaign.update({ where: { id }, data: { updatedAt: new Date() } });
}

const giaTriTuDong = (r: DongCampaign): GiaTriCampaign => ({
  name: r.name,
  description: r.description,
  attributionModel: r.attributionModel,
  cookieWindowDays: r.cookieWindowDays,
  protectWindowDays: r.protectWindowDays,
  allowSelfReferral: r.allowSelfReferral,
  partnerCanViewAmount: r.partnerCanViewAmount,
  defaultSourceGroupId: r.defaultSourceGroupId,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
});

const anhChup = (g: GiaTriCampaign): Record<string, unknown> => ({
  name: g.name,
  description: g.description,
  attributionModel: g.attributionModel,
  cookieWindowDays: g.cookieWindowDays,
  protectWindowDays: g.protectWindowDays,
  allowSelfReferral: g.allowSelfReferral,
  partnerCanViewAmount: g.partnerCanViewAmount,
  defaultSourceGroupId: g.defaultSourceGroupId,
  effectiveFrom: g.effectiveFrom?.toISOString() ?? null,
  effectiveTo: g.effectiveTo?.toISOString() ?? null,
});

/**
 * Nguồn dùng được làm đích của campaign không (khoá `FOR SHARE` rồi đọc): tồn tại ∧ `nguonChonDuoc` — CÙNG hàm với ô chọn nguồn của lead mới.
 * Từ chối bằng câu NÓI NGUYÊN NHÂN (`lyDoNguonKhongDung`).
 */
async function kiemNguonChon(tx: Tx, id: string, now: Date, truong: string): Promise<void> {
  await khoaNguon(tx, [id]);
  const n = await tx.leadSourceGroup.findUnique({ where: { id }, select: { id: true, name: true, status: true, selectable: true, effectiveFrom: true, effectiveTo: true } });
  if (!n) throw new LoiGhiAffiliate("Không tìm thấy nguồn này.", truong);
  const de: NguonDeKiem = { ten: n.name, status: n.status, selectable: n.selectable, effectiveFrom: n.effectiveFrom, effectiveTo: n.effectiveTo };
  const ly = lyDoNguonKhongDung(de, now);
  if (ly) throw new LoiGhiAffiliate(ly, truong);
}

function dich(e: unknown, mac?: { ma?: string }): { ok: false; loi: string; truong?: string } | null {
  if (e instanceof LoiGhiAffiliate) return { ok: false, loi: e.message, truong: e.truong };
  if (laLoiTrungKhoa(e) && mac?.ma) return { ok: false, loi: `Mã «${mac.ma}» đã có.`, truong: "code" };
  return null;
}

// ── TẠO ──────────────────────────────────────────────────────────────────────────────────────────────────────

export async function taoCampaign(p: { nguoi: NguoiGhi; vao: unknown; now: Date }): Promise<KetQuaTaoCampaign> {
  const kq = taoCampaignSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  try {
    const row = await db.$transaction(async (tx) => {
      if (await tx.affiliateCampaign.findUnique({ where: { code: v.code }, select: { id: true } })) {
        throw new LoiGhiAffiliate(`Mã «${v.code}» đã có.`, "code");
      }
      if (v.defaultSourceGroupId) await kiemNguonChon(tx, v.defaultSourceGroupId, p.now, "defaultSourceGroupId");
      const r = await tx.affiliateCampaign.create({
        data: {
          code: v.code,
          name: v.name,
          description: v.description,
          status: "DRAFT",
          attributionModel: v.attributionModel,
          cookieWindowDays: v.cookieWindowDays,
          protectWindowDays: v.protectWindowDays,
          allowSelfReferral: v.allowSelfReferral,
          partnerCanViewAmount: v.partnerCanViewAmount ?? null,
          defaultSourceGroupId: v.defaultSourceGroupId,
          effectiveFrom: v.effectiveFrom,
          effectiveTo: v.effectiveTo,
          createdById: p.nguoi.userId,
        },
      });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_CAMPAIGN,
        entityId: r.id,
        action: "CAMPAIGN_TAO",
        newValues: { code: r.code, status: r.status, ...anhChup(giaTriTuDong(r)) },
        reason: `Tạo campaign «${r.name}» (${r.code})`,
      });
      return r;
    });
    return { ok: true, id: row.id, code: row.code, updatedAt: row.updatedAt.toISOString() };
  } catch (e) {
    // Đua tạo cùng mã: người sau nhận P2002 — cũng là «mã đã có», không phải lỗi 500.
    const d = dich(e, { ma: v.code });
    if (d) return d;
    throw e;
  }
}

// ── SỬA ──────────────────────────────────────────────────────────────────────────────────────────────────────

export async function suaCampaign(p: {
  nguoi: NguoiGhi;
  id: string;
  /** `updatedAt` mà người sửa ĐÃ THẤY. BẮT BUỘC. */
  updatedAtDaThay: Date;
  vao: unknown;
  lyDo: string | null;
  now: Date;
}): Promise<KetQuaSuaCampaign> {
  const kq = suaCampaignSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const patch = kq.data;
  try {
    const ra = await db.$transaction(async (tx) => {
      const dong = await khoaCampaignTrongTx(tx, p.id);
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoi();
      const hienTai = giaTriTuDong(dong);
      const kiem = kiemSuaCampaign({ trangThai: dong.status, hienTai, patch, lyDo: p.lyDo });
      if (!kiem.ok) throw new LoiGhiAffiliate(kiem.loi, kiem.truong);
      if (kiem.truongDoi.length === 0) return { doi: false as const, row: dong, truongDoi: [] as typeof kiem.truongDoi };
      if (kiem.truongDoi.includes("defaultSourceGroupId") && patch.defaultSourceGroupId) {
        await kiemNguonChon(tx, patch.defaultSourceGroupId, p.now, "defaultSourceGroupId");
      }
      const data: Prisma.AffiliateCampaignUncheckedUpdateInput = {};
      for (const k of kiem.truongDoi) (data as Record<string, unknown>)[k] = (patch as Record<string, unknown>)[k];
      const moi = await tx.affiliateCampaign.update({ where: { id: dong.id }, data });
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
        entityType: ENTITY_CAMPAIGN,
        entityId: dong.id,
        action: "CAMPAIGN_SUA",
        oldValues: cu,
        newValues: nay,
        changedFields: [...kiem.truongDoi],
        reason: (p.lyDo ?? "").trim() !== "" ? p.lyDo!.trim() : `Sửa campaign «${dong.name}»`,
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

// ── ĐỔI TRẠNG THÁI ───────────────────────────────────────────────────────────────────────────────────────────

export async function doiTrangThaiCampaign(p: {
  nguoi: NguoiGhi;
  id: string;
  updatedAtDaThay: Date;
  den: TrangThaiCampaign;
  lyDo: string | null;
  now: Date;
}): Promise<KetQuaDoiTrangThaiCampaign> {
  try {
    const ra = await db.$transaction(async (tx) => {
      const dong = await khoaCampaignTrongTx(tx, p.id);
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoi();
      const kiem = kiemChuyenTrangThai({ tu: dong.status, den: p.den, lyDo: p.lyDo });
      if (!kiem.ok) throw new LoiGhiAffiliate(kiem.loi, kiem.truong);

      if (p.den === "ACTIVE") {
        // MỌI điều kiện kích hoạt kiểm Ở ĐÂY, dưới khoá campaign: kích hoạt lần đầu VÀ chạy lại sau tạm dừng cùng đi qua `kiemKichHoatCampaign`.
        // Phần chính sách + quy tắc đọc bằng CHÍNH hàm mà trang chi tiết dùng (`docChiTietCampaign`) — hai nơi hỏi cổng không thể đọc hai tập khác nhau.
        const [cong, gan] = await Promise.all([docDuLieuCongKichHoat(tx, dong.id), tx.affiliateCampaignSite.findMany({ where: { campaignId: dong.id }, select: { siteId: true } })]);
        const quyTac = cong.quyTac;
        const idNguon = [...new Set([...quyTac.map((r) => r.sourceGroupId), ...(dong.defaultSourceGroupId ? [dong.defaultSourceGroupId] : [])])];
        const idSite = gan.map((g) => g.siteId);
        // Khoá chia sẻ RỒI mới đọc trạng thái: người ngừng nguồn / tắt website đang giữ khoá thì ta chờ họ xong và thấy kết quả đã commit.
        await khoaNguon(tx, idNguon);
        await khoaWebsite(tx, idSite);
        const [nguon, site] = await Promise.all([
          idNguon.length > 0
            ? tx.leadSourceGroup.findMany({ where: { id: { in: idNguon } }, select: { id: true, name: true, status: true, selectable: true, effectiveFrom: true, effectiveTo: true } })
            : Promise.resolve([]),
          idSite.length > 0 ? tx.affiliateSite.findMany({ where: { id: { in: idSite } }, select: { name: true, status: true } }) : Promise.resolve([]),
        ]);
        const loi = kiemKichHoatCampaign({
          cheDoThuong: dong.rewardMode,
          phienBanChinhSach: cong.phienBanChinhSach,
          attributionModel: dong.attributionModel,
          defaultSourceGroupId: dong.defaultSourceGroupId,
          effectiveFrom: dong.effectiveFrom,
          effectiveTo: dong.effectiveTo,
          quyTac,
          website: site.map((s) => ({ ten: s.name, status: s.status })),
          nguon: new Map(nguon.map((n) => [n.id, { ten: n.name, status: n.status, selectable: n.selectable, effectiveFrom: n.effectiveFrom, effectiveTo: n.effectiveTo }])),
          now: p.now,
        });
        if (loi.length > 0) throw new LoiKichHoat(loi);
      }

      const data: Prisma.AffiliateCampaignUncheckedUpdateInput = { status: p.den };
      if (p.den === "ACTIVE") {
        data.activatedById = p.nguoi.userId;
        data.activatedAt = p.now;
      }
      const moi = await tx.affiliateCampaign.update({ where: { id: dong.id }, data });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_CAMPAIGN,
        entityId: dong.id,
        action: tenHanhDongTrangThai(dong.status, p.den),
        oldValues: { status: dong.status },
        newValues: { status: moi.status },
        changedFields: ["status"],
        reason: (p.lyDo ?? "").trim() !== "" ? p.lyDo!.trim() : `${kiem.thaoTac.nhan} campaign «${dong.name}»`,
      });
      return { tu: dong.status, row: moi };
    });
    return { ok: true, tu: ra.tu, den: p.den, updatedAt: ra.row.updatedAt.toISOString() };
  } catch (e) {
    if (e instanceof LoiKichHoat) return { ok: false, loi: e.message, truong: "kichHoat", lyDoChan: e.lyDoChan };
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

// ── LỰA CHỌN «THƯỞNG» (AFF-L1) ───────────────────────────────────────────────────────────────────────────────

/**
 * Chọn «có thưởng theo chính sách riêng» hoặc «không có mức riêng» cho campaign. Cùng khuôn mọi lệnh ghi campaign: khoá hàng (`FOR UPDATE`) → khoá lạc quan theo `updatedAt` đã thấy
 * → cổng (`kiemDoiCheDoThuong`, đọc chính sách dưới khoá) → ghi → audit cùng transaction. Quyền `affiliate_campaigns:manage` do Server Action kiểm.
 *
 * Chiều ngược lại của cổng («kích hoạt chính sách CAMPAIGN khi đang không thưởng») nằm ở `kichHoat` của dịch vụ chính sách, và khoá campaign `FOR SHARE` ở đó xếp hàng với khoá `FOR UPDATE` ở đây:
 * hai bên không thể cùng qua cổng rồi cùng ghi.
 */
export async function datCheDoThuong(p: { nguoi: NguoiGhi; id: string; updatedAtDaThay: Date; den: CheDoThuong; lyDo: string | null; now: Date }): Promise<KetQuaDoiCheDoThuong> {
  try {
    const ra = await db.$transaction(async (tx) => {
      const dong = await khoaCampaignTrongTx(tx, p.id);
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoi();
      const cong = await docDuLieuCongKichHoat(tx, dong.id);
      const kiem = kiemDoiCheDoThuong({ trangThai: dong.status, den: p.den, lyDo: p.lyDo, phienBanChinhSach: cong.phienBanChinhSach, now: p.now });
      if (!kiem.ok) throw new LoiGhiAffiliate(kiem.loi, kiem.truong);
      if (dong.rewardMode === p.den) return { doi: false as const, row: dong };
      const moi = await tx.affiliateCampaign.update({ where: { id: dong.id }, data: { rewardMode: p.den } });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_CAMPAIGN,
        entityId: dong.id,
        action: "CAMPAIGN_DOI_CHE_DO_THUONG",
        oldValues: { rewardMode: dong.rewardMode },
        newValues: { rewardMode: moi.rewardMode },
        changedFields: ["rewardMode"],
        reason: (p.lyDo ?? "").trim() !== "" ? p.lyDo!.trim() : `Chọn «${NHAN_CHE_DO_THUONG[p.den]}» cho campaign «${dong.name}»`,
      });
      return { doi: true as const, row: moi };
    });
    return { ok: true, doi: ra.doi, updatedAt: ra.row.updatedAt.toISOString() };
  } catch (e) {
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

// ── QUY TẮC QUY NGUỒN ────────────────────────────────────────────────────────────────────────────────────────

export async function themQuyTac(p: { nguoi: NguoiGhi; campaignId: string; vao: unknown; lyDo: string | null; now: Date }): Promise<KetQuaViecCon> {
  const kq = taoQuyTacSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  const ruleKey = dungRuleKey(v.typeId, v.tagId);
  try {
    await db.$transaction(async (tx) => {
      const dong = await khoaCampaignTrongTx(tx, p.campaignId);
      const cong = kiemDoiQuyTac({ trangThai: dong.status, lyDo: p.lyDo });
      if (!cong.ok) throw new LoiGhiAffiliate(cong.loi, cong.truong);
      if (await tx.affiliateCampaignRule.findUnique({ where: { campaignId_ruleKey: { campaignId: dong.id, ruleKey } }, select: { id: true } })) {
        throw new LoiGhiAffiliate("Đã có quy tắc cho cặp này — xoá quy tắc cũ rồi thêm lại nếu muốn đổi nguồn.", "typeId");
      }
      let loai: { code: string; name: string } | null = null;
      let nhan: { code: string; name: string } | null = null;
      if (v.typeId) {
        const t = await tx.affiliateType.findUnique({ where: { id: v.typeId }, select: { code: true, name: true, isActive: true } });
        if (!t || !t.isActive) throw new LoiGhiAffiliate("Loại đối tác không tồn tại hoặc đã tắt.", "typeId");
        loai = { code: t.code, name: t.name };
      }
      if (v.tagId) {
        const g = await tx.affiliateTag.findUnique({ where: { id: v.tagId }, select: { code: true, name: true, isActive: true } });
        if (!g || !g.isActive) throw new LoiGhiAffiliate("Nhãn đối tác không tồn tại hoặc đã tắt.", "tagId");
        nhan = { code: g.code, name: g.name };
      }
      await kiemNguonChon(tx, v.sourceGroupId, p.now, "sourceGroupId");
      const nguon = await tx.leadSourceGroup.findUnique({ where: { id: v.sourceGroupId }, select: { code: true, name: true } });
      const r = await tx.affiliateCampaignRule.create({
        data: { campaignId: dong.id, typeId: v.typeId, tagId: v.tagId, ruleKey, sourceGroupId: v.sourceGroupId, policyId: null, createdById: p.nguoi.userId },
      });
      await dongDauCampaign(tx, dong.id);
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_CAMPAIGN,
        entityId: dong.id,
        action: "CAMPAIGN_THEM_QUY_TAC",
        newValues: { ruleId: r.id, ruleKey, loai: loai?.code ?? null, nhan: nhan?.code ?? null, nguon: nguon?.code ?? null, sourceGroupId: v.sourceGroupId },
        reason: (p.lyDo ?? "").trim() !== "" ? p.lyDo!.trim() : `Thêm quy tắc quy nguồn cho campaign «${dong.name}»`,
      });
    });
    return { ok: true };
  } catch (e) {
    // Đua thêm cùng cặp: người sau nhận P2002 trên (campaignId, ruleKey) — cùng câu với bản kiểm trước.
    if (laLoiTrungKhoa(e)) return { ok: false, loi: "Đã có quy tắc cho cặp này — xoá quy tắc cũ rồi thêm lại nếu muốn đổi nguồn.", truong: "typeId" };
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

export async function xoaQuyTac(p: { nguoi: NguoiGhi; campaignId: string; ruleId: string; lyDo: string | null; now: Date }): Promise<KetQuaViecCon> {
  void p.now;
  try {
    await db.$transaction(async (tx) => {
      const dong = await khoaCampaignTrongTx(tx, p.campaignId);
      const cong = kiemDoiQuyTac({ trangThai: dong.status, lyDo: p.lyDo });
      if (!cong.ok) throw new LoiGhiAffiliate(cong.loi, cong.truong);
      const r = await tx.affiliateCampaignRule.findFirst({ where: { id: p.ruleId, campaignId: dong.id } });
      if (!r) throw new LoiGhiAffiliate("Không tìm thấy quy tắc này (có thể đã được xoá).", "khongTimThay");
      await tx.affiliateCampaignRule.delete({ where: { id: r.id } });
      await dongDauCampaign(tx, dong.id);
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_CAMPAIGN,
        entityId: dong.id,
        action: "CAMPAIGN_XOA_QUY_TAC",
        oldValues: { ruleId: r.id, ruleKey: r.ruleKey, typeId: r.typeId, tagId: r.tagId, sourceGroupId: r.sourceGroupId },
        reason: (p.lyDo ?? "").trim() !== "" ? p.lyDo!.trim() : `Xoá quy tắc quy nguồn của campaign «${dong.name}»`,
      });
    });
    return { ok: true };
  } catch (e) {
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

// ── WEBSITE ──────────────────────────────────────────────────────────────────────────────────────────────────

export async function ganWebsite(p: { nguoi: NguoiGhi; campaignId: string; siteId: string; now: Date }): Promise<KetQuaViecCon> {
  void p.now;
  const siteId = p.siteId.trim();
  if (siteId === "") return { ok: false, loi: "Chọn website.", truong: "siteId" };
  try {
    await db.$transaction(async (tx) => {
      const dong = await khoaCampaignTrongTx(tx, p.campaignId);
      await khoaWebsite(tx, [siteId]);
      const [site, daGan] = await Promise.all([
        tx.affiliateSite.findUnique({ where: { id: siteId }, select: { id: true, code: true, name: true, status: true } }),
        tx.affiliateCampaignSite.findUnique({ where: { campaignId_siteId: { campaignId: dong.id, siteId } }, select: { siteId: true } }),
      ]);
      const cong = kiemGanWebsite({ trangThai: dong.status, site, daGan: daGan !== null });
      if (!cong.ok) throw new LoiGhiAffiliate(cong.loi, cong.truong);
      await tx.affiliateCampaignSite.create({ data: { campaignId: dong.id, siteId } });
      await dongDauCampaign(tx, dong.id);
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_CAMPAIGN,
        entityId: dong.id,
        action: "CAMPAIGN_GAN_WEBSITE",
        newValues: { siteId, siteCode: site!.code },
        reason: `Gắn website «${site!.name}» vào campaign «${dong.name}»`,
      });
    });
    return { ok: true };
  } catch (e) {
    if (laLoiTrungKhoa(e)) return { ok: false, loi: "Website này đã gắn vào campaign.", truong: "siteId" };
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

export async function goWebsite(p: { nguoi: NguoiGhi; campaignId: string; siteId: string; lyDo: string | null; now: Date }): Promise<KetQuaViecCon> {
  void p.now;
  try {
    await db.$transaction(async (tx) => {
      const dong = await khoaCampaignTrongTx(tx, p.campaignId);
      const gan = await tx.affiliateCampaignSite.findMany({ where: { campaignId: dong.id }, select: { siteId: true, site: { select: { code: true, name: true, status: true } } } });
      const cua = gan.find((g) => g.siteId === p.siteId) ?? null;
      const soBatConLai = gan.filter((g) => g.siteId !== p.siteId && g.site.status === "ACTIVE").length;
      const cong = kiemGoWebsite({ trangThai: dong.status, daGan: cua !== null, soWebsiteBatConLai: soBatConLai });
      if (!cong.ok) throw new LoiGhiAffiliate(cong.loi, cong.truong);
      // AFF-L6: lựa chọn trang đích của website này đi cùng website — gỡ website thì xoá luôn, kẻo gắn lại về sau «sống lại» một lựa chọn cũ người dùng không còn nhớ.
      await tx.affiliateCampaignLanding.deleteMany({ where: { campaignId: dong.id, landingPage: { siteId: p.siteId } } });
      await tx.affiliateCampaignSite.delete({ where: { campaignId_siteId: { campaignId: dong.id, siteId: p.siteId } } });
      await dongDauCampaign(tx, dong.id);
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_CAMPAIGN,
        entityId: dong.id,
        action: "CAMPAIGN_GO_WEBSITE",
        oldValues: { siteId: p.siteId, siteCode: cua!.site.code },
        reason: (p.lyDo ?? "").trim() !== "" ? p.lyDo!.trim() : `Gỡ website «${cua!.site.name}» khỏi campaign «${dong.name}»`,
      });
    });
    return { ok: true };
  } catch (e) {
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

// ── TRANG ĐÍCH CỦA CAMPAIGN (AFF-L6) ─────────────────────────────────────────────────────────────────────────

/** Thu hẹp làm chết link đang chạy mà người bấm chưa xác nhận: mang số link để giao diện hỏi lại. */
class CanXacNhan extends LoiGhiAffiliate {
  constructor(readonly soLinkAnhHuong: number) {
    super(`Thu hẹp này làm ${soLinkAnhHuong} link đang hoạt động không còn hiệu lực (lịch sử lượt bấm / referral vẫn giữ). Xác nhận để tiếp tục.`, "xacNhan");
    this.name = "CanXacNhan";
  }
}

/**
 * Chọn các trang đích CỦA MỘT WEBSITE mà campaign được chạy. `landingPageIds` rỗng = KHÔNG hạn chế (mọi trang đích đang bật của website dùng được); có phần tử = CHỈ các trang đó.
 * Áp cho MỌI nơi hỏi qua `trangDichHieuLuc`: phát link (admin + cổng đối tác), cổng `kiemChuoiLink` (/r, beacon, intake), ô chọn.
 *
 * Cổng (đứng TRƯỚC phép ghi đầu tiên): campaign chưa ENDED · website ĐANG gắn vào campaign · mọi id thuộc ĐÚNG website này và là trang ĐANG BẬT + bật theo dõi (chọn trang tắt là hứa suông).
 * Thu hẹp mà làm chết link đang hoạt động ⇒ TỪ CHỐI kèm số link (`canXacNhan`) cho tới khi người bấm `xacNhan: true`. KHÔNG xoá / sửa link nào — lịch sử referral giữ nguyên; link chỉ hết hiệu lực qua cổng.
 */
export async function datTrangDichCampaign(p: {
  nguoi: NguoiGhi;
  campaignId: string;
  siteId: string;
  landingPageIds: readonly string[];
  /** Người bấm đã được báo số link bị ảnh hưởng và đồng ý. BẮT BUỘC khai (luật 7). */
  xacNhan: boolean;
  lyDo: string | null;
  now: Date;
}): Promise<KetQuaDatTrangDich> {
  void p.now;
  const siteId = p.siteId.trim();
  if (siteId === "") return { ok: false, loi: "Chọn website.", truong: "siteId" };
  const moi = [...new Set(p.landingPageIds.map((x) => x.trim()).filter((x) => x !== ""))];
  try {
    const ra = await db.$transaction(async (tx) => {
      const dong = await khoaCampaignTrongTx(tx, p.campaignId);
      await khoaWebsite(tx, [siteId]);
      if (dong.status === "ENDED") throw new LoiGhiAffiliate("Campaign đã kết thúc — không đổi được trang đích.", "trangThai");
      const [gan, site, trang, cu] = await Promise.all([
        tx.affiliateCampaignSite.findUnique({ where: { campaignId_siteId: { campaignId: dong.id, siteId } }, select: { siteId: true } }),
        tx.affiliateSite.findUnique({ where: { id: siteId }, select: { id: true, code: true, name: true, baseUrl: true } }),
        tx.affiliateLandingPage.findMany({ where: { siteId }, select: { id: true, host: true, pathPattern: true, label: true, isActive: true, trackingEnabled: true } }),
        tx.affiliateCampaignLanding.findMany({ where: { campaignId: dong.id, landingPage: { siteId } }, select: { landingPageId: true } }),
      ]);
      if (!site || !gan) throw new LoiGhiAffiliate("Website này chưa gắn vào campaign — gắn website trước rồi mới chọn trang đích.", "siteId");
      const theoId = new Map(trang.map((t) => [t.id, t]));
      for (const id of moi) {
        const t = theoId.get(id);
        if (!t) throw new LoiGhiAffiliate("Có trang đích không thuộc website này.", "landingPageIds");
        if (!t.isActive || !t.trackingEnabled) {
          throw new LoiGhiAffiliate(`Trang đích ${t.pathPattern} đang ${t.isActive ? "tắt theo dõi" : "tắt"} — bật lại ở tab Website trước khi chọn.`, "landingPageIds");
        }
      }
      const cuIds = cu.map((x) => x.landingPageId);
      const khongDoi = moi.length === cuIds.length && moi.every((x) => cuIds.includes(x));
      if (khongDoi) return { doi: false as const, soLinkAnhHuong: 0, site, dong };

      // Đếm link ĐANG HOẠT ĐỘNG (campaign × website) mất hiệu lực — đọc, trước phép ghi.
      const links = await tx.affiliateTrackingAsset.findMany({ where: { campaignId: dong.id, siteId, status: "ACTIVE" }, select: { landingHost: true, landingPath: true } });
      const baseHost = hostCuaBaseUrl(site.baseUrl) ?? "";
      const dbTrang = trang.map((t) => ({ id: t.id, host: t.host, pathPattern: t.pathPattern, label: t.label, isActive: t.isActive, trackingEnabled: t.trackingEnabled }));
      const soLinkAnhHuong = demLinkMatHieuLuc(
        links,
        baseHost,
        trangDichHieuLuc({ baseUrl: site.baseUrl, trangDich: dbTrang, rangBuoc: cuIds }),
        trangDichHieuLuc({ baseUrl: site.baseUrl, trangDich: dbTrang, rangBuoc: moi }),
      );
      if (soLinkAnhHuong > 0 && !p.xacNhan) throw new CanXacNhan(soLinkAnhHuong);
      // Thu hẹp làm chết link ĐANG CHẠY của đối tác ⇒ phải để lại LÝ DO (cùng ngưỡng với mọi thay đổi khác của campaign đã từng chạy) — nhật ký kiểm toán không được chỉ có câu mặc định (reviewer Bảo mật, MEDIUM).
      if (soLinkAnhHuong > 0 && (p.lyDo ?? "").trim().length < LY_DO_TOI_THIEU_CAMPAIGN) {
        throw new LoiGhiAffiliate(`Ghi lý do thu hẹp (tối thiểu ${LY_DO_TOI_THIEU_CAMPAIGN} ký tự) — ${soLinkAnhHuong} link đang chạy sẽ không còn hiệu lực.`, "lyDo");
      }

      await tx.affiliateCampaignLanding.deleteMany({ where: { campaignId: dong.id, landingPage: { siteId } } });
      if (moi.length > 0) await tx.affiliateCampaignLanding.createMany({ data: moi.map((landingPageId) => ({ campaignId: dong.id, landingPageId })) });
      await dongDauCampaign(tx, dong.id);
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_CAMPAIGN,
        entityId: dong.id,
        action: "CAMPAIGN_DAT_TRANG_DICH",
        oldValues: { siteId, siteCode: site.code, trangDaChon: cuIds },
        newValues: { siteId, siteCode: site.code, trangDaChon: moi, soLinkAnhHuong },
        changedFields: ["trangDaChon"],
        reason: (p.lyDo ?? "").trim() !== "" ? p.lyDo!.trim() : `${moi.length === 0 ? "Bỏ hạn chế" : `Chọn ${moi.length} trang đích`} của website «${site.name}» cho campaign «${dong.name}»`,
      });
      return { doi: true as const, soLinkAnhHuong, site, dong };
    });
    return { ok: true, soLinkAnhHuong: ra.soLinkAnhHuong };
  } catch (e) {
    if (e instanceof CanXacNhan) return { ok: false, loi: e.message, truong: "xacNhan", canXacNhan: true, soLinkAnhHuong: e.soLinkAnhHuong };
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}
