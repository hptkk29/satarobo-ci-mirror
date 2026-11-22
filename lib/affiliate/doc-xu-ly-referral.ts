/**
 * lib/affiliate/doc-xu-ly-referral.ts — ĐỌC cho phần XỬ LÝ TAY referral (AFF-L3b): nhật ký xử lý, lựa chọn của form khai tay, ô tìm phiếu khách.
 *
 * ── Cách ly và PII ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *  · Nhật ký đọc qua `scopedDb(actor)` (`AffiliateReferralEvent` ∈ SCOPED_MODELS, prefix `affiliate_referrals:`): người cấp cơ sở chỉ thấy sự kiện của referral thuộc cơ sở mình, dòng `centerId NULL` chỉ Hội sở.
 *    Select liệt kê TƯỜNG MINH — `detail` đi qua `docChiTietSuKien` (chỉ giữ khoá đã biết), không bao giờ chuyển nguyên Json xuống trình duyệt.
 *  · Ô tìm phiếu khách: tìm theo MÃ (6 ký tự cuối id) hoặc id trần thì ai có `affiliate_referrals:manage` cũng dùng được (chỉ trả mã rút gọn + cơ sở, không PII); tìm theo TÊN cần xem được khách
 *    (`leads:view-all|view-own`); tìm theo SĐT cần `leads:view-pii` (ô tìm theo SĐT không gác quyền = rò gián tiếp: gõ đủ số là biết khách có thật). Tên/SĐT hiển thị qua `maskLeadPiiFields`.
 */
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { maskLeadPiiFields } from "@/lib/lead/pii";
import { canonicalPhone } from "@/lib/phone";
import { maRutGonPhieu, type TrangThaiReferral } from "./ghi-referral-dau-vao";
import { LOAI_SU_KIEN, type LoaiSuKien } from "./xu-ly-referral";

// ── Nhật ký ──────────────────────────────────────────────────────────────────────────────────────

export type DongLichSu = {
  id: string;
  /** ISO. */
  luc: string;
  loai: LoaiSuKien;
  tu: TrangThaiReferral | null;
  den: TrangThaiReferral;
  nguoi: string;
  lyDo: string;
  ghiChu: string | null;
  lyDoTruoc: string | null;
  /** Nhánh ghi nguồn khi DUYỆT: tạo mới · thay nhóm chờ · đã đúng người từ trước. */
  ghiNguon: "TAO_MOI" | "DE_NHOM_CHO" | "DA_DUNG_NGUOI" | null;
  /** Người khai tự duyệt (không còn ai khác có quyền). */
  tuDuyet: boolean;
};

const laLoai = (v: string): v is LoaiSuKien => (LOAI_SU_KIEN as readonly string[]).includes(v);

export function docChiTietSuKien(raw: unknown): { ghiNguon: DongLichSu["ghiNguon"]; tuDuyet: boolean } {
  const o: Record<string, unknown> = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const g = o.ghiNguon;
  return {
    ghiNguon: g === "TAO_MOI" || g === "DE_NHOM_CHO" || g === "DA_DUNG_NGUOI" ? g : null,
    tuDuyet: o.tuDuyet === true,
  };
}

/** Nhật ký của MỘT referral, cũ → mới. `[]` khi referral ngoài tầm nhìn (sự kiện mang `centerId` của referral). */
export async function docLichSuReferral(actor: Actor, referralId: string): Promise<DongLichSu[]> {
  const r = await scopedDb(actor).affiliateReferralEvent.findMany({
    where: { referralId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, createdAt: true, kind: true, fromStatus: true, toStatus: true, actorName: true, reason: true, note: true, previousReason: true, detail: true },
    take: 200,
  });
  return r
    .filter((x): x is typeof x & { kind: LoaiSuKien } => laLoai(x.kind))
    .map((x) => ({
      id: x.id,
      luc: x.createdAt.toISOString(),
      loai: x.kind,
      tu: x.fromStatus,
      den: x.toStatus,
      nguoi: x.actorName,
      lyDo: x.reason,
      ghiChu: x.note,
      lyDoTruoc: x.previousReason,
      ...docChiTietSuKien(x.detail),
    }));
}

// ── Lựa chọn của form khai tay ───────────────────────────────────────────────────────────────────

export type LuaChonKhaiTay = { partyId: string; campaignId: string; doiTac: string; maDoiTac: string; campaign: string; maCampaign: string };

/** Cặp (đối tác, campaign) ĐANG hợp lệ để khai tay: thành viên ACTIVE, đối tác ACTIVE, campaign ACTIVE. Không SĐT/email. Hiệu lực theo ngày do cổng ghi kiểm lại. */
export async function docLuaChonKhaiTay(): Promise<LuaChonKhaiTay[]> {
  const r = await db.affiliateMembership.findMany({
    where: { status: "ACTIVE", party: { status: "ACTIVE" }, campaign: { status: "ACTIVE" } },
    orderBy: [{ campaign: { name: "asc" } }, { party: { name: "asc" } }],
    select: { partyId: true, campaignId: true, party: { select: { name: true, code: true } }, campaign: { select: { name: true, code: true } } },
    take: 300,
  });
  return r.map((m) => ({ partyId: m.partyId, campaignId: m.campaignId, doiTac: m.party.name, maDoiTac: m.party.code, campaign: m.campaign.name, maCampaign: m.campaign.code }));
}

// ── Ô tìm phiếu khách ────────────────────────────────────────────────────────────────────────────

export type QuyenTimPhieu = {
  /** `leads:view-all` hoặc `leads:view-own` — được tìm theo tên. */
  xemKhach: boolean;
  /** `leads:view-pii` — được tìm theo SĐT và thấy tên/SĐT không che. */
  xemPii: boolean;
};

export type KetQuaTimPhieu = { id: string; maRutGon: string; ten: string | null; sdt: string | null };

const ID_RE = /^[a-z0-9]{20,32}$/;
const MA_RE = /^[A-Za-z0-9]{6}$/;
export const TIM_PHIEU_TOI_THIEU = 3;
export const TIM_PHIEU_TOI_DA = 8;

export const chuanQuyenTimPhieu = (q: QuyenTimPhieu): QuyenTimPhieu => ({ xemKhach: q.xemKhach, xemPii: q.xemKhach && q.xemPii });

/** THUẦN: điều kiện tìm theo quyền — tách ra để ca thuần đo được mà không cần DB. */
export function dungDieuKienTimPhieu(q: string, quyenTho: QuyenTimPhieu): Prisma.LeadWhereInput[] {
  // PII chỉ có nghĩa khi xem được khách: giữ bất biến ở MỘT chỗ để cả tìm lẫn hiển thị cùng dùng.
  const quyen = chuanQuyenTimPhieu(quyenTho);
  const t = q.trim();
  if (t.length < TIM_PHIEU_TOI_THIEU) return [];
  const ra: Prisma.LeadWhereInput[] = [];
  if (ID_RE.test(t.toLowerCase())) ra.push({ id: t.toLowerCase() });
  if (MA_RE.test(t)) ra.push({ id: { endsWith: t.toLowerCase() } });
  if (quyen.xemKhach) ra.push({ parentName: { contains: t, mode: "insensitive" } });
  // SĐT: chỉ khi được xem PII — ô tìm theo SĐT không gác quyền là rò gián tiếp.
  if (quyen.xemPii) {
    const c = canonicalPhone(t);
    if (c !== null) ra.push({ phone: { in: [c, `0${c.slice(2)}`, `+${c}`] } });
  }
  return ra;
}

export async function timPhieuKhaiTay(actor: Actor, q: string, quyenTho: QuyenTimPhieu): Promise<KetQuaTimPhieu[]> {
  const quyen = chuanQuyenTimPhieu(quyenTho);
  const dieuKien = dungDieuKienTimPhieu(q, quyen);
  if (dieuKien.length === 0) return [];
  const r = await scopedDb(actor).lead.findMany({
    where: { deletedAt: null, OR: dieuKien },
    orderBy: { createdAt: "desc" },
    take: TIM_PHIEU_TOI_DA,
    select: { id: true, parentName: true, phone: true },
  });
  return r.map((l) => {
    const a = maskLeadPiiFields({ parentName: l.parentName, phone: l.phone }, quyen.xemPii);
    // Người chỉ có `affiliate_referrals:manage` (không xem được khách) thấy MÃ chứ không thấy tên — kể cả tên đã che.
    return { id: l.id, maRutGon: maRutGonPhieu(l.id), ten: quyen.xemKhach ? a.parentName : null, sdt: quyen.xemKhach ? a.phone : null };
  });
}
