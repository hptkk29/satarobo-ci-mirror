/**
 * lib/affiliate/doc-campaign.ts — ĐỌC cho tab Campaign Affiliate (AFF-P0b): danh sách · chi tiết · lựa chọn cho ô chọn · thành viên · xem trước nguồn. Chỉ ĐỌC, không ghi.
 *
 * · Campaign / Loại / Nhãn / Website là danh mục TOÀN HỆ (không `centerId`) ⇒ cách ly nằm ở cổng quyền của trang, không ở truy vấn. `Affiliate` cũng nằm ngoài tự-scope của `scopedDb`.
 * · Đối tác trả ra CHỈ gồm mã · tên · loại · trạng thái (KHÔNG SĐT / email) — màn Campaign không có lý do nào cần liên hệ của họ.
 * · Mọi kiểu trả ra là kiểu THUẦN trong `ghi-campaign-dau-vao.ts` (client import được mà không kéo `db`); ngày ở dạng ISO.
 * · `now` BẮT BUỘC ở hàm cần xét hiệu lực (luật 19).
 */
import { db } from "@/lib/db";
import { docDuLieuCongKichHoat } from "./cong-kich-hoat-doc";
import { CHON_RANG_BUOC_CAMPAIGN, CHON_TRANG_DICH, giaiHostTrangDich, rangBuocCuaCampaign } from "./trang-dich-hieu-luc";
import { nguonChonDuoc } from "@/lib/nguon/hieu-luc-nguon";
import {
  dungDauVaoXemTruoc,
  kiemKichHoatCampaign,
  xemTruocNguon,
  type NguonDeKiem,
  type ChiTietCampaignView,
  type DoiTacChonView,
  type DongCampaignView,
  type DongMembershipView,
  type LuaChonCampaignView,
  type TrangThaiCampaign,
  type XemTruocView,
} from "./ghi-campaign-dau-vao";
import type { TrangThaiMembership } from "./ghi-membership-dau-vao";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

// ── Danh sách ────────────────────────────────────────────────────────────────────────────────────────────────

export type DanhSachCampaign = {
  dong: DongCampaignView[];
  tong: number;
  trang: number;
  kichThuoc: number;
  /** Số campaign theo trạng thái (không lọc) — chip lọc in số thật. */
  demTheoTrangThai: Record<TrangThaiCampaign, number>;
};

export async function docDanhSachCampaign(p: { trangThai: TrangThaiCampaign | null; trang: number; kichThuoc: number }): Promise<DanhSachCampaign> {
  const where = p.trangThai ? { status: p.trangThai } : {};
  const [tong, rows, nhom] = await Promise.all([
    db.affiliateCampaign.count({ where }),
    db.affiliateCampaign.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (Math.max(1, p.trang) - 1) * p.kichThuoc,
      take: p.kichThuoc,
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        attributionModel: true,
        effectiveFrom: true,
        effectiveTo: true,
        updatedAt: true,
        _count: { select: { sites: true } },
      },
    }),
    db.affiliateCampaign.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const hoatDong = rows.length
    ? await db.affiliateMembership.groupBy({ by: ["campaignId"], where: { campaignId: { in: rows.map((r) => r.id) }, status: "ACTIVE" }, _count: { _all: true } })
    : [];
  const demHoatDong = new Map(hoatDong.map((g) => [g.campaignId, g._count._all]));
  const dem: Record<TrangThaiCampaign, number> = { DRAFT: 0, ACTIVE: 0, PAUSED: 0, ENDED: 0 };
  for (const g of nhom) dem[g.status] = g._count._all;
  return {
    dong: rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      status: r.status,
      attributionModel: r.attributionModel,
      effectiveFrom: iso(r.effectiveFrom),
      effectiveTo: iso(r.effectiveTo),
      soDoiTacHoatDong: demHoatDong.get(r.id) ?? 0,
      soWebsite: r._count.sites,
      capNhatLuc: r.updatedAt.toISOString(),
    })),
    tong,
    trang: p.trang,
    kichThuoc: p.kichThuoc,
    demTheoTrangThai: dem,
  };
}

// ── Chi tiết ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function docChiTietCampaign(code: string, now: Date): Promise<ChiTietCampaignView | null> {
  const [c, nhom, cong] = await Promise.all([
    db.affiliateCampaign.findUnique({
      where: { code },
      include: {
        defaultSourceGroup: { select: { id: true, code: true, name: true, status: true, selectable: true, effectiveFrom: true, effectiveTo: true } },
        rules: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: {
            type: { select: { code: true, name: true } },
            tag: { select: { code: true, name: true } },
            sourceGroup: { select: { id: true, code: true, name: true, status: true, selectable: true, effectiveFrom: true, effectiveTo: true } },
          },
        },
        sites: {
          include: { site: { select: { id: true, code: true, name: true, baseUrl: true, status: true, landingPages: { orderBy: [{ hostKey: "asc" }, { pathPattern: "asc" }], select: CHON_TRANG_DICH } } } },
          orderBy: { createdAt: "asc" },
        },
        landings: CHON_RANG_BUOC_CAMPAIGN,
      },
    }),
    db.affiliateMembership.groupBy({ by: ["status"], where: { campaign: { code } }, _count: { _all: true } }),
    // Quy tắc + chính sách CAMPAIGN cho cổng kích hoạt: CÙNG hàm với hàm ghi (`doiTrangThaiCampaign`). Tra theo MÃ nên chạy song song với đọc campaign.
    db.affiliateCampaign.findUnique({ where: { code }, select: { id: true } }).then((r) => (r ? docDuLieuCongKichHoat(db, r.id) : null)),
  ]);
  if (!c) return null;
  const dem: ChiTietCampaignView["demMembership"] = { PENDING: 0, ACTIVE: 0, SUSPENDED: 0, ENDED: 0 };
  for (const g of nhom) dem[g.status] = g._count._all;
  const nguonView = (n: { id: string; code: string; name: string; status: string; selectable: boolean; effectiveFrom: Date | null; effectiveTo: Date | null }) => ({
    id: n.id,
    code: n.code,
    ten: n.name,
    status: n.status,
    chonDuoc: nguonChonDuoc(n, now),
  });
  // Điều kiện kích hoạt còn thiếu: CÙNG hàm với cổng ghi, để nút «Kích hoạt» nói đúng điều mà máy chủ sẽ nói (đọc ngoài khoá — máy chủ vẫn là bên quyết định).
  const nguonTheoId = new Map<string, NguonDeKiem>();
  for (const n of [c.defaultSourceGroup, ...c.rules.map((r) => r.sourceGroup)]) {
    if (n) nguonTheoId.set(n.id, { ten: n.name, status: n.status, selectable: n.selectable, effectiveFrom: n.effectiveFrom, effectiveTo: n.effectiveTo });
  }
  const chanKichHoat = kiemKichHoatCampaign({
    cheDoThuong: c.rewardMode,
    phienBanChinhSach: cong?.phienBanChinhSach ?? [],
    attributionModel: c.attributionModel,
    defaultSourceGroupId: c.defaultSourceGroupId,
    effectiveFrom: c.effectiveFrom,
    effectiveTo: c.effectiveTo,
    quyTac: cong?.quyTac ?? [],
    website: c.sites.map((s) => ({ ten: s.site.name, status: s.site.status })),
    nguon: nguonTheoId,
    now,
  });
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description,
    status: c.status,
    attributionModel: c.attributionModel,
    cookieWindowDays: c.cookieWindowDays,
    protectWindowDays: c.protectWindowDays,
    allowSelfReferral: c.allowSelfReferral,
    partnerCanViewAmount: c.partnerCanViewAmount,
    defaultSourceGroupId: c.defaultSourceGroupId,
    nguonMacDinh: c.defaultSourceGroup ? nguonView(c.defaultSourceGroup) : null,
    effectiveFrom: iso(c.effectiveFrom),
    effectiveTo: iso(c.effectiveTo),
    activatedAt: iso(c.activatedAt),
    capNhatLuc: c.updatedAt.toISOString(),
    quyTac: c.rules.map((r) => ({
      id: r.id,
      typeId: r.typeId,
      tagId: r.tagId,
      loai: r.type ? { code: r.type.code, ten: r.type.name } : null,
      nhan: r.tag ? { code: r.tag.code, ten: r.tag.name } : null,
      nguon: nguonView(r.sourceGroup),
    })),
    website: c.sites.map((s) => ({
      id: s.site.id,
      code: s.site.code,
      ten: s.site.name,
      baseUrl: s.site.baseUrl,
      status: s.site.status,
      // AFF-L6: các trang đích của website (tên miền ĐÃ GIẢI) + trang campaign đã chọn TRONG website này.
      trangDich: s.site.landingPages.map((t) => ({ id: t.id, host: giaiHostTrangDich(s.site.baseUrl, t.host), pathPattern: t.pathPattern, label: t.label, isActive: t.isActive, trackingEnabled: t.trackingEnabled })),
      trangDaChon: rangBuocCuaCampaign(c.landings, s.site.id),
    })),
    chanKichHoat,
    cheDoThuong: c.rewardMode,
    demMembership: dem,
  };
}

// ── Lựa chọn cho các ô chọn ──────────────────────────────────────────────────────────────────────────────────

/**
 * Nguồn chọn được = CÙNG `nguonChonDuoc` mà ô chọn nguồn của lead mới và cổng ghi dùng (ACTIVE ∧ selectable ∧ trong hiệu lực) — một định nghĩa, không bản thứ hai.
 * Website: trả cả website TẮT (có cờ `status`) để giao diện nói «đang tắt» thay vì giấu.
 */
export async function docLuaChonChoCampaign(now: Date): Promise<LuaChonCampaignView> {
  const [nguon, loai, nhan, website] = await Promise.all([
    db.leadSourceGroup.findMany({
      select: { id: true, code: true, name: true, description: true, status: true, selectable: true, effectiveFrom: true, effectiveTo: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.affiliateType.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.affiliateTag.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    db.affiliateSite.findMany({ select: { id: true, code: true, name: true, baseUrl: true, status: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    nguon: nguon.filter((n) => nguonChonDuoc(n, now)).map((n) => ({ id: n.id, code: n.code, ten: n.name, moTa: n.description })),
    loai: loai.map((t) => ({ id: t.id, code: t.code, ten: t.name })),
    nhan: nhan.map((t) => ({ id: t.id, code: t.code, ten: t.name })),
    website: website.map((s) => ({ id: s.id, code: s.code, ten: s.name, baseUrl: s.baseUrl, status: s.status })),
  };
}

/** Trần số đối tác hiện ở ô chọn — vượt thì ô chọn nói «còn nữa» (đối tác chọn theo tên; danh sách dài hơn cần ô tìm, chưa làm ở P0). */
export const TRAN_DOI_TAC_O_CHON = 500;

/** Đối tác ĐANG HOẠT ĐỘNG cho ô «Thêm đối tác» và «Xem trước nguồn». Chỉ mã · tên · loại + trạng thái dòng trong campaign. */
export async function docDoiTacChoCampaign(campaignId: string): Promise<{ doiTac: DoiTacChonView[]; conNua: boolean }> {
  const rows = await db.affiliate.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, code: true, name: true, partyKind: true, type: { select: { name: true } }, memberships: { where: { campaignId }, select: { status: true } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: TRAN_DOI_TAC_O_CHON + 1,
  });
  return {
    doiTac: rows.slice(0, TRAN_DOI_TAC_O_CHON).map((r) => ({
      id: r.id,
      code: r.code,
      ten: r.name,
      kind: r.partyKind,
      loai: r.type?.name ?? null,
      trongCampaign: r.memberships[0]?.status ?? null,
    })),
    conNua: rows.length > TRAN_DOI_TAC_O_CHON,
  };
}

// ── Thành viên ───────────────────────────────────────────────────────────────────────────────────────────────

export type DanhSachMembership = { dong: DongMembershipView[]; tong: number; trang: number; kichThuoc: number };

export async function docMembership(p: { campaignId: string; trangThai: TrangThaiMembership | null; trang: number; kichThuoc: number }): Promise<DanhSachMembership> {
  const where = { campaignId: p.campaignId, ...(p.trangThai ? { status: p.trangThai } : {}) };
  const [tong, rows] = await Promise.all([
    db.affiliateMembership.count({ where }),
    db.affiliateMembership.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (Math.max(1, p.trang) - 1) * p.kichThuoc,
      take: p.kichThuoc,
      select: {
        id: true,
        status: true,
        groupLabel: true,
        effectiveFrom: true,
        effectiveTo: true,
        approvedAt: true,
        updatedAt: true,
        party: { select: { id: true, code: true, name: true, partyKind: true, status: true, type: { select: { name: true } } } },
      },
    }),
  ]);
  return {
    dong: rows.map((r) => ({
      id: r.id,
      doiTac: { id: r.party.id, code: r.party.code, ten: r.party.name, kind: r.party.partyKind, loai: r.party.type?.name ?? null, status: r.party.status },
      status: r.status,
      groupLabel: r.groupLabel,
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveTo: iso(r.effectiveTo),
      approvedAt: iso(r.approvedAt),
      capNhatLuc: r.updatedAt.toISOString(),
    })),
    tong,
    trang: p.trang,
    kichThuoc: p.kichThuoc,
  };
}

// ── Xem trước nguồn ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * «Đối tác này, trong campaign này, sẽ được gán nguồn nào — và vì sao?» Đọc cấu hình rồi chạy ĐÚNG `giaiNguonCuaDoiTac` (qua `xemTruocNguon`); không có thứ tự ưu tiên thứ hai ở đây.
 * Đối tác không tồn tại ⇒ null.
 */
export async function docXemTruocNguon(p: { campaignId: string; partyId: string; now: Date }): Promise<XemTruocView | null> {
  const [camp, quyTac, doiTac] = await Promise.all([
    db.affiliateCampaign.findUnique({ where: { id: p.campaignId }, select: { defaultSourceGroupId: true } }),
    db.affiliateCampaignRule.findMany({ where: { campaignId: p.campaignId }, select: { typeId: true, tagId: true, sourceGroupId: true } }),
    db.affiliate.findUnique({
      where: { id: p.partyId },
      select: {
        id: true,
        code: true,
        name: true,
        type: { select: { id: true, name: true, defaultSourceGroupId: true } },
        tags: { select: { tagId: true, tag: { select: { name: true } } } },
        memberships: { where: { campaignId: p.campaignId }, select: { status: true } },
      },
    }),
  ]);
  if (!camp || !doiTac) return null;
  const idNguon = [...new Set([...quyTac.map((r) => r.sourceGroupId), ...(camp.defaultSourceGroupId ? [camp.defaultSourceGroupId] : []), ...(doiTac.type?.defaultSourceGroupId ? [doiTac.type.defaultSourceGroupId] : [])])];
  const nguon = idNguon.length
    ? await db.leadSourceGroup.findMany({ where: { id: { in: idNguon } }, select: { id: true, code: true, name: true, status: true, selectable: true, effectiveFrom: true, effectiveTo: true } })
    : [];
  const dauVao = dungDauVaoXemTruoc({
    quyTac,
    campaignMacDinh: camp.defaultSourceGroupId,
    doiTac: { loaiId: doiTac.type?.id ?? null, nhanIds: doiTac.tags.map((t) => t.tagId) },
    loaiMacDinh: doiTac.type?.defaultSourceGroupId ?? null,
  });
  const ketQua = xemTruocNguon({
    dauVao,
    nguon: new Map(nguon.map((n) => [n.id, { id: n.id, code: n.code, ten: n.name, status: n.status, selectable: n.selectable, effectiveFrom: n.effectiveFrom, effectiveTo: n.effectiveTo }])),
    now: p.now,
  });
  return {
    doiTac: {
      id: doiTac.id,
      code: doiTac.code,
      ten: doiTac.name,
      loai: doiTac.type?.name ?? null,
      nhan: doiTac.tags.map((t) => t.tag.name),
      trongCampaign: doiTac.memberships[0]?.status ?? null,
    },
    ketQua,
  };
}
