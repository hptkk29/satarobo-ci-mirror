/**
 * lib/affiliate/ghi-membership.ts — MỘT NƠI GHI membership (đối tác × campaign): `themMembership` · `doiTrangThaiMembership` · `suaMembership` (AFF-P0b).
 * Luật ĐƯỢC / KHÔNG ĐƯỢC ở `ghi-membership-dau-vao.ts` (thuần); tệp này đọc DB rồi ghi.
 *
 * Khuôn y `ghi-campaign.ts` — đọc phần đầu tệp đó (quyền do nơi gọi kiểm: `affiliate_memberships:manage`; khoá lạc quan; cổng trước phép ghi; `throw` mới rollback).
 *  · THỨ TỰ KHOÁ: hàng CAMPAIGN (`FOR UPDATE`, qua `khoaCampaignTrongTx`) → hàng MEMBERSHIP (`FOR UPDATE`). Khoá campaign trước để «campaign ENDED không nhận thành viên mới» đọc dưới khoá,
 *    không có người kết thúc campaign xen vào giữa lúc kiểm và lúc ghi.
 *  · Một (đối tác, campaign) một dòng (UNIQUE `AffiliateMembership_partyId_campaignId_key`). Thêm lại đối tác đã ENDED = MỞ LẠI dòng cũ: PENDING, hiệu lực làm mới, phê duyệt cũ bị bỏ (audit giữ
 *    giá trị cũ). Đua thêm cùng đối tác: người sau nhận P2002 ⇒ dịch thành câu «đã ở trong campaign», không phải lỗi 500.
 *  · Lý do tạm ngừng / từ chối / kết thúc KHÔNG có cột riêng ở `AffiliateMembership` — nó sống ở AuditLog (cùng transaction). Đừng thêm cột khi chưa có ai cần đọc lại nó.
 *  · Chỉ trả tên / mã / loại của đối tác ở nơi đọc; hàm ghi không đụng SĐT / email.
 *  · `now` BẮT BUỘC ở mọi hàm (luật 19).
 */
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { MODULE_AUDIT_AFFILIATE, LoiGhiAffiliate, aud, laLoiTrungKhoa, type NguoiGhi } from "./chung";
import { dongDauCampaign, khoaCampaignTrongTx, type Tx } from "./ghi-campaign";
import {
  kiemChuyenMembership,
  kiemSuaMembership,
  kiemThemMembership,
  suaMembershipSchema,
  themMembershipSchema,
  tinhHieuLucKhiKetThuc,
  type KetQuaDoiMembership,
  type KetQuaSuaMembership,
  type KetQuaThemMembership,
  type TrangThaiMembership,
} from "./ghi-membership-dau-vao";

const ENTITY_MEMBERSHIP = "AffiliateMembership";
const DA_O_TRONG_CAMPAIGN = "Đối tác này đã ở trong campaign.";

const khongTimThay = () => new LoiGhiAffiliate("Không tìm thấy dòng thành viên này.", "khongTimThay");
const vuaDoi = () => new LoiGhiAffiliate("Dòng thành viên vừa được người khác thay đổi — hãy tải lại rồi thử lại.", "vuaDoi");

function loiTuZod(e: { issues: readonly { path: PropertyKey[]; message: string }[] }): { ok: false; loi: string; truong: string } {
  const i = e.issues[0];
  return { ok: false, loi: i?.message ?? "Dữ liệu không hợp lệ.", truong: typeof i?.path[0] === "string" ? i.path[0] : "chung" };
}

function dich(e: unknown): { ok: false; loi: string; truong?: string } | null {
  if (e instanceof LoiGhiAffiliate) return { ok: false, loi: e.message, truong: e.truong };
  return null;
}

/** Khoá hàng membership (`FOR UPDATE`) rồi đọc. Gọi SAU khi đã khoá campaign của nó. */
async function khoaMembership(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "AffiliateMembership" WHERE "id" = ${id} FOR UPDATE`;
  const dong = await tx.affiliateMembership.findUnique({ where: { id } });
  if (!dong) throw khongTimThay();
  return dong;
}

// ── THÊM / MỞ LẠI ────────────────────────────────────────────────────────────────────────────────────────────

export async function themMembership(p: { nguoi: NguoiGhi; campaignId: string; vao: unknown; now: Date }): Promise<KetQuaThemMembership> {
  const kq = themMembershipSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  try {
    const ra = await db.$transaction(async (tx) => {
      const camp = await khoaCampaignTrongTx(tx, p.campaignId);
      const [doiTac, hienCo] = await Promise.all([
        tx.affiliate.findUnique({ where: { id: v.partyId }, select: { id: true, code: true, name: true, status: true } }),
        tx.affiliateMembership.findUnique({ where: { partyId_campaignId: { partyId: v.partyId, campaignId: camp.id } } }),
      ]);
      const cong = kiemThemMembership({ campaign: { status: camp.status }, doiTac, hienCo });
      if (!cong.ok) throw new LoiGhiAffiliate(cong.loi, cong.truong);
      const tu = v.effectiveFrom ?? p.now;
      if (v.effectiveTo && v.effectiveTo.getTime() <= tu.getTime()) throw new LoiGhiAffiliate("Ngày kết thúc phải SAU ngày bắt đầu.", "effectiveTo");

      if (cong.viec === "MO_LAI") {
        const cu = hienCo!;
        const moi = await tx.affiliateMembership.update({
          where: { id: cu.id },
          data: {
            status: "PENDING",
            groupLabel: v.groupLabel ?? cu.groupLabel,
            effectiveFrom: tu,
            effectiveTo: v.effectiveTo,
            approvedById: null,
            approvedAt: null,
          },
        });
        await dongDauCampaign(tx, camp.id);
        await writeAudit({
          tx,
          actor: aud(p.nguoi),
          module: MODULE_AUDIT_AFFILIATE,
          entityType: ENTITY_MEMBERSHIP,
          entityId: moi.id,
          action: "MEMBERSHIP_MO_LAI",
          oldValues: { status: cu.status, effectiveFrom: cu.effectiveFrom.toISOString(), effectiveTo: cu.effectiveTo?.toISOString() ?? null, approvedAt: cu.approvedAt?.toISOString() ?? null, groupLabel: cu.groupLabel },
          newValues: { status: moi.status, campaignId: camp.id, partyId: v.partyId, effectiveFrom: moi.effectiveFrom.toISOString(), effectiveTo: moi.effectiveTo?.toISOString() ?? null, groupLabel: moi.groupLabel },
          reason: `Mở lại thành viên «${doiTac!.name}» trong campaign «${camp.name}»`,
        });
        return { id: moi.id, viec: "MO_LAI" as const };
      }

      const moi = await tx.affiliateMembership.create({
        data: {
          partyId: v.partyId,
          campaignId: camp.id,
          status: "PENDING",
          groupLabel: v.groupLabel,
          joinedAt: p.now,
          effectiveFrom: tu,
          effectiveTo: v.effectiveTo,
          createdById: p.nguoi.userId,
        },
      });
      await dongDauCampaign(tx, camp.id);
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_MEMBERSHIP,
        entityId: moi.id,
        action: "MEMBERSHIP_THEM",
        newValues: { status: moi.status, campaignId: camp.id, partyId: v.partyId, effectiveFrom: moi.effectiveFrom.toISOString(), effectiveTo: moi.effectiveTo?.toISOString() ?? null, groupLabel: moi.groupLabel },
        reason: `Thêm «${doiTac!.name}» vào campaign «${camp.name}»`,
      });
      return { id: moi.id, viec: "TAO" as const };
    });
    return { ok: true, id: ra.id, viec: ra.viec };
  } catch (e) {
    if (laLoiTrungKhoa(e)) return { ok: false, loi: DA_O_TRONG_CAMPAIGN, truong: "partyId" };
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

// ── ĐỔI TRẠNG THÁI ───────────────────────────────────────────────────────────────────────────────────────────

export async function doiTrangThaiMembership(p: {
  nguoi: NguoiGhi;
  id: string;
  updatedAtDaThay: Date;
  den: TrangThaiMembership;
  lyDo: string | null;
  now: Date;
}): Promise<KetQuaDoiMembership> {
  try {
    // Cần biết campaign để khoá nó TRƯỚC (thứ tự khoá: campaign → membership). Đọc ngoài khoá chỉ để lấy `campaignId` — bất biến của dòng (không có đường nào đổi nó).
    const truoc = await db.affiliateMembership.findUnique({ where: { id: p.id }, select: { campaignId: true } });
    if (!truoc) throw khongTimThay();
    const ra = await db.$transaction(async (tx) => {
      const camp = await khoaCampaignTrongTx(tx, truoc.campaignId);
      const dong = await khoaMembership(tx, p.id);
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoi();
      const doiTac = await tx.affiliate.findUnique({ where: { id: dong.partyId }, select: { name: true, status: true } });
      if (!doiTac) throw new LoiGhiAffiliate("Không tìm thấy đối tác của dòng này.", "partyId");
      const kiem = kiemChuyenMembership({ tu: dong.status, den: p.den, lyDo: p.lyDo, campaign: { status: camp.status }, doiTac: { status: doiTac.status } });
      if (!kiem.ok) throw new LoiGhiAffiliate(kiem.loi, kiem.truong);

      const data: Prisma.AffiliateMembershipUncheckedUpdateInput = { status: p.den };
      if (p.den === "ENDED") {
        const hl = tinhHieuLucKhiKetThuc({ effectiveFrom: dong.effectiveFrom, effectiveTo: dong.effectiveTo, now: p.now });
        if (!hl.ok) throw new LoiGhiAffiliate(hl.loi, "effectiveTo");
        data.effectiveTo = hl.effectiveTo;
      }
      // Duyệt lần đầu (PENDING → ACTIVE): ghi người duyệt + lúc duyệt. Cho tham gia lại sau tạm ngừng giữ nguyên phê duyệt cũ.
      if (dong.status === "PENDING" && p.den === "ACTIVE") {
        data.approvedById = p.nguoi.userId;
        data.approvedAt = p.now;
      }
      const moi = await tx.affiliateMembership.update({ where: { id: dong.id }, data });
      await dongDauCampaign(tx, camp.id);
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_MEMBERSHIP,
        entityId: dong.id,
        action: kiem.thaoTac.hanhDong,
        oldValues: { status: dong.status, effectiveTo: dong.effectiveTo?.toISOString() ?? null },
        newValues: { status: moi.status, campaignId: camp.id, partyId: dong.partyId, effectiveTo: moi.effectiveTo?.toISOString() ?? null },
        changedFields: p.den === "ENDED" ? ["status", "effectiveTo"] : ["status"],
        reason: (p.lyDo ?? "").trim() !== "" ? p.lyDo!.trim() : `${kiem.thaoTac.nhan} «${doiTac.name}» trong campaign «${camp.name}»`,
      });
      return { tu: dong.status, row: moi };
    });
    return { ok: true, tu: ra.tu, den: p.den, updatedAt: ra.row.updatedAt.toISOString() };
  } catch (e) {
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

// ── SỬA NHÃN NHÓM / HIỆU LỰC ─────────────────────────────────────────────────────────────────────────────────

export async function suaMembership(p: {
  nguoi: NguoiGhi;
  id: string;
  updatedAtDaThay: Date;
  vao: unknown;
  lyDo: string | null;
  now: Date;
}): Promise<KetQuaSuaMembership> {
  void p.now;
  const kq = suaMembershipSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const patch = kq.data;
  try {
    const truoc = await db.affiliateMembership.findUnique({ where: { id: p.id }, select: { campaignId: true } });
    if (!truoc) throw khongTimThay();
    const ra = await db.$transaction(async (tx) => {
      const camp = await khoaCampaignTrongTx(tx, truoc.campaignId);
      const dong = await khoaMembership(tx, p.id);
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoi();
      const kiem = kiemSuaMembership({ status: dong.status, hienTai: { groupLabel: dong.groupLabel, effectiveFrom: dong.effectiveFrom, effectiveTo: dong.effectiveTo }, patch, lyDo: p.lyDo });
      if (!kiem.ok) throw new LoiGhiAffiliate(kiem.loi, kiem.truong);
      if (kiem.truongDoi.length === 0) return { doi: false as const, row: dong };
      const data: Prisma.AffiliateMembershipUncheckedUpdateInput = {};
      for (const k of kiem.truongDoi) (data as Record<string, unknown>)[k] = (patch as Record<string, unknown>)[k];
      const moi = await tx.affiliateMembership.update({ where: { id: dong.id }, data });
      await dongDauCampaign(tx, camp.id);
      const cu: Record<string, unknown> = {};
      const nay: Record<string, unknown> = {};
      for (const k of kiem.truongDoi) {
        const a = (dong as Record<string, unknown>)[k];
        const b = (moi as Record<string, unknown>)[k];
        cu[k] = a instanceof Date ? a.toISOString() : a;
        nay[k] = b instanceof Date ? b.toISOString() : b;
      }
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_MEMBERSHIP,
        entityId: dong.id,
        action: "MEMBERSHIP_SUA",
        oldValues: cu,
        newValues: nay,
        changedFields: [...kiem.truongDoi],
        reason: (p.lyDo ?? "").trim() !== "" ? p.lyDo!.trim() : `Sửa thành viên trong campaign «${camp.name}»`,
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
