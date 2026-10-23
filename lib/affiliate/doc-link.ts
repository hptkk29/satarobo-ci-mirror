/**
 * lib/affiliate/doc-link.ts — ĐỌC link / QR / mã giới thiệu cho tab «Link / QR / Mã» và cho hai đường công khai (`/r/:token`, beacon). Chỉ đọc; ghi ở `ghi-link.ts`.
 *
 * ── Cách ly, PII, token ─────────────────────────────────────────────────────────────────────────────────────────
 *  · `AffiliateTrackingAsset` là danh mục TOÀN HỆ (không `centerId`) ⇒ cách ly nằm ở cổng quyền của page; không qua `scopedDb`.
 *  · KHÔNG SĐT/email/ghi chú đối tác ở đây — chỉ tên + mã đối tác.
 *  · TOKEN ĐẦY ĐỦ chỉ rời tầng đọc khi `coTheXemDayDu` (= `affiliate_links:manage`). Người chỉ có `affiliates:view` nhận 4 ký tự đầu + «…» và KHÔNG nhận địa chỉ `/r/…` hay `?aff=…`
 *    dựng sẵn (chúng mang token đầy đủ) — che ở giao diện là che chưa kịp, payload RSC vẫn là bản thật. `coTheXemDayDu` BẮT BUỘC, không mặc định (luật 7).
 *  · Số lượt bấm là MỘT câu GROUP BY cho cả trang (không N+1).
 *  · `taiChuoiLinkTheoToken` + `chuoiTuDong` là NƠI DUY NHẤT dựng `ChuoiLink` từ DB: phát link, xoay mã, `/r`, beacon và cột «dùng được không» của bảng cùng đi qua đây.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { dungUrlChuyenHuong, dungUrlDich, dungUrlTrangDich, type SiteDeDung } from "./dung-url-theo-doi";
import {
  NHAN_CHUOI_LINK_KHONG_HOP_LE,
  SO_LINK_HOAT_DONG_TOI_DA,
  anToken,
  kiemChuoiLink,
  type ChuoiLink,
  type LoaiLink,
  type TrangThaiLink,
} from "./ghi-link-dau-vao";
import { partyIdsVaoDuoc } from "./tai-khoan-truy-cap";
import { CHON_RANG_BUOC_CAMPAIGN, CHON_TRANG_DICH, rangBuocCuaCampaign, trangDichHieuLuc, type DongRangBuocCampaign, type TrangDichDb } from "./trang-dich-hieu-luc";
import { chuanHoaDuongDanMau, hostCuaBaseUrl, hostTrongDanhSach } from "./website-hop-le";

type Khach = PrismaClient | Prisma.TransactionClient;

export const KICH_THUOC_TRANG_LINK = 25;
/** Trần số chương trình đưa vào ô chọn «Phát link» — danh sách chọn, không phải đường tải danh bạ. */
export const TOI_DA_CHUONG_TRINH_CHON = 1000;

// ── Chuỗi quan hệ của một link ──────────────────────────────────────────────────────────────────────────────────

/** Hình dạng hàng DB mà `chuoiTuDong` cần. Mọi `select` ở tệp này (và ở `ghi-link.ts`) phải thoả hình này. */
export type HangChuoi = {
  status: TrangThaiLink;
  landingPath: string;
  /** Tên miền đích đã chụp lúc phát (AFF-L6). NULL = link cũ ⇒ tên miền của `baseUrl`. */
  landingHost: string | null;
  siteId: string;
  party: { status: ChuoiLink["doiTac"]["status"] };
  membership: ChuoiLink["thanhVien"];
  campaign: {
    code: string;
    status: ChuoiLink["campaign"]["status"];
    effectiveFrom: Date | null;
    effectiveTo: Date | null;
    cookieWindowDays: number;
    sites: { siteId: string }[];
    /** Trang đích campaign đã chọn (mọi website) — `rangBuocCuaCampaign` lọc theo website của link. */
    landings: DongRangBuocCampaign[];
  };
  site: { baseUrl: string; allowedDomains: string[]; status: "ACTIVE" | "INACTIVE"; trackingEnabled: boolean; landingPages: TrangDichDb[] };
};

/** Phần `select` CHUNG của mọi nơi cần dựng chuỗi (không gồm cột riêng của từng nơi). */
export const CHON_CHUOI = {
  status: true,
  landingPath: true,
  landingHost: true,
  siteId: true,
  party: { select: { status: true } },
  membership: { select: { status: true, effectiveFrom: true, effectiveTo: true } },
  campaign: { select: { code: true, status: true, effectiveFrom: true, effectiveTo: true, cookieWindowDays: true, sites: { select: { siteId: true } }, landings: CHON_RANG_BUOC_CAMPAIGN } },
  site: { select: { baseUrl: true, allowedDomains: true, status: true, trackingEnabled: true, landingPages: { select: CHON_TRANG_DICH } } },
} satisfies Prisma.AffiliateTrackingAssetSelect;

export function chuoiTuDong(h: HangChuoi): ChuoiLink {
  return {
    // Link cũ (trước AFF-L6) chưa chụp tên miền đích ⇒ dùng tên miền của `baseUrl`, đúng nơi nó vẫn luôn chuyển tới.
    taiSan: { status: h.status, landingPath: h.landingPath, landingHost: h.landingHost ?? hostCuaBaseUrl(h.site.baseUrl) ?? "" },
    doiTac: { status: h.party.status },
    thanhVien: { status: h.membership.status, effectiveFrom: h.membership.effectiveFrom, effectiveTo: h.membership.effectiveTo },
    campaign: {
      code: h.campaign.code,
      status: h.campaign.status,
      effectiveFrom: h.campaign.effectiveFrom,
      effectiveTo: h.campaign.effectiveTo,
      cookieWindowDays: h.campaign.cookieWindowDays,
    },
    campaignGanSite: h.campaign.sites.some((s) => s.siteId === h.siteId),
    site: { baseUrl: h.site.baseUrl, allowedDomains: h.site.allowedDomains, status: h.site.status, trackingEnabled: h.site.trackingEnabled },
    // MỘT hàm giải host + thu hẹp theo campaign cho mọi nơi dựng chuỗi (`trang-dich-hieu-luc.ts`).
    trangDich: trangDichHieuLuc({ baseUrl: h.site.baseUrl, trangDich: h.site.landingPages, rangBuoc: rangBuocCuaCampaign(h.campaign.landings, h.siteId) }),
  };
}

export type LinkDaTai = {
  id: string;
  token: string;
  partyId: string;
  campaignId: string;
  membershipId: string;
  siteId: string;
  landingPath: string;
  chuoi: ChuoiLink;
  /** Website dạng dùng cho `dungUrlDich`. */
  site: SiteDeDung;
};

/** Link theo token ĐÃ CHUẨN HOÁ (`chuanHoaToken`) — null nếu không có. Không phân biệt «chưa từng có» với «đã thu hồi» (nơi gọi dựa vào `chuoi.taiSan.status`). */
export async function taiChuoiLinkTheoToken(client: Khach, tokenChuan: string): Promise<LinkDaTai | null> {
  const h = await client.affiliateTrackingAsset.findUnique({
    where: { publicToken: tokenChuan },
    select: { ...CHON_CHUOI, id: true, publicToken: true, partyId: true, campaignId: true, membershipId: true },
  });
  if (!h) return null;
  const chuoi = chuoiTuDong(h);
  return {
    id: h.id,
    token: h.publicToken,
    partyId: h.partyId,
    campaignId: h.campaignId,
    membershipId: h.membershipId,
    siteId: h.siteId,
    landingPath: h.landingPath,
    chuoi,
    site: { baseUrl: chuoi.site.baseUrl, allowedDomains: chuoi.site.allowedDomains, status: chuoi.site.status, trackingEnabled: chuoi.site.trackingEnabled },
  };
}

// ── Danh sách ───────────────────────────────────────────────────────────────────────────────────────────────────

export type DongLink = {
  id: string;
  doiTac: { id: string; ten: string; ma: string };
  campaign: { id: string; ma: string; ten: string };
  website: { ten: string; host: string };
  landingPath: string;
  /** Tên miền ĐÍCH của link (đã giải; link cũ ⇒ tên miền của website) — một website có thể có nhiều tên miền. */
  landingHost: string;
  /** Nhãn trang đích đã chụp lúc phát; null = link cũ chưa suy được trang đích duy nhất, hoặc trang đích không có nhãn. */
  landingNhan: string | null;
  loai: LoaiLink;
  nhan: string | null;
  trangThai: TrangThaiLink;
  /** Link ĐANG HOẠT ĐỘNG nhưng chuỗi hiện không dùng được (campaign tạm dừng, đối tác ngừng, trang đích bị tắt…) ⇒ câu cho người vận hành. null = dùng được / đã thu hồi. */
  lyDoKhongDung: string | null;
  soLuotBam: number;
  soLuotBamLoi: number;
  taoLuc: string;
  /** ISO của `updatedAt` — mốc khoá lạc quan khi thu hồi / xoay. */
  capNhatLuc: string;
  thuHoiLuc: string | null;
  lyDoThuHoi: string | null;
  laBanXoay: boolean;
  /** Referral HỢP LỆ (`VALID`) đã gắn vào link này — khách để lại thông tin qua link. Không tính lượt bị loại / chờ xem xét. Toàn hệ (cùng phạm vi với «lượt bấm»). */
  soReferral: number;
  /** `affiliate_links:manage`: token đầy đủ. Ngược lại: 4 ký tự đầu + «…». */
  token: string;
  /** Chỉ khi `coTheXemDayDu` ∧ link đang hoạt động ∧ đã cấu hình gốc công khai (`LocLink.gocLinkNgan`). */
  lienKetNgan: string | null;
  lienKetTrucTiep: string | null;
  /**
   * URL CUỐI = nơi khách thật sự đến. Định nghĩa MỘT lần: với người có `coTheXemDayDu` và link đang dùng được là `lienKetTrucTiep` (kèm `?aff=&cmp=`); với người chỉ xem là địa chỉ trang đích SẠCH
   * (không token — token là bí mật của đối tác). Website tắt / trang đích không còn ⇒ null. Cột «URL cuối» và nút sao chép cùng đọc trường này.
   */
  urlCuoi: string | null;
};

export type LocLink = {
  trang: number;
  kichThuoc: number;
  trangThai: TrangThaiLink | null;
  /** MÃ campaign. */
  campaignMa: string | null;
  /** MÃ đối tác (`Affiliate.code`). */
  doiTacMa: string | null;
  /** Người xem có `affiliate_links:manage` không. BẮT BUỘC (luật 7). */
  coTheXemDayDu: boolean;
  /** Gốc công khai của link ngắn `/r` (`gocCongKhai(process.env)`), hoặc null = chưa cấu hình ⇒ không dựng link ngắn. BẮT BUỘC, không mặc định (luật 7): không ai quên truyền gốc rồi để link ngắn trỏ sai môi trường. */
  gocLinkNgan: string | null;
  /**
   * R10 · D1: `true` ⇒ góc nhìn ĐỐI TÁC — cột «referral» của mỗi link đếm MỌI lượt gửi, không phân loại. Đếm riêng lượt HỢP LỆ tăng ngay khi một SĐT MỚI được gửi (số đã có trong CRM thì dòng là «trùng», không tính)
   * ⇒ chính là bit «số này đã có chưa». Cổng đối tác PHẢI truyền `true`; màn quản trị (nhân viên) truyền `false` (đếm lượt hợp lệ). BẮT BUỘC, không mặc định (luật 7).
   */
  gocNhinDoiTac: boolean;
  now: Date;
};

export type KetQuaDanhSachLink = {
  dong: DongLink[];
  tong: number;
  trang: number;
  kichThuoc: number;
  /** Đếm theo trạng thái trong bộ lọc campaign + đối tác (KHÔNG theo trạng thái) — để chip trạng thái đếm đúng thứ nó mở ra. */
  theoTrangThai: Record<TrangThaiLink, number>;
};

export async function docDanhSachLink(loc: LocLink, client: Khach = db): Promise<KetQuaDanhSachLink> {
  const whereChung: Prisma.AffiliateTrackingAssetWhereInput = {
    ...(loc.campaignMa ? { campaign: { code: loc.campaignMa } } : {}),
    ...(loc.doiTacMa ? { party: { code: loc.doiTacMa } } : {}),
  };
  const where: Prisma.AffiliateTrackingAssetWhereInput = { ...whereChung, ...(loc.trangThai ? { status: loc.trangThai } : {}) };
  const kichThuoc = Math.max(1, Math.trunc(loc.kichThuoc));
  const trang = Math.max(1, Math.trunc(loc.trang));

  const [tong, hang, theoTT] = await Promise.all([
    client.affiliateTrackingAsset.count({ where }),
    client.affiliateTrackingAsset.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (trang - 1) * kichThuoc,
      take: kichThuoc,
      select: {
        ...CHON_CHUOI,
        id: true,
        publicToken: true,
        type: true,
        label: true,
        createdAt: true,
        updatedAt: true,
        revokedAt: true,
        revokedReason: true,
        rotatedFromId: true,
        landingPage: { select: { label: true } },
        party: { select: { id: true, name: true, code: true, status: true } },
        campaign: { select: { id: true, code: true, name: true, status: true, effectiveFrom: true, effectiveTo: true, cookieWindowDays: true, sites: { select: { siteId: true } }, landings: CHON_RANG_BUOC_CAMPAIGN } },
        site: { select: { name: true, baseUrl: true, allowedDomains: true, status: true, trackingEnabled: true, landingPages: { select: CHON_TRANG_DICH } } },
      },
    }),
    client.affiliateTrackingAsset.groupBy({ by: ["status"], where: whereChung, _count: { _all: true }, orderBy: { status: "asc" } }),
  ]);

  const ids = hang.map((h) => h.id);
  // Hai câu GROUP BY cho cả trang (không N+1), chạy song song: (link × kết cục) ⇒ «OK» là lượt bấm hợp lệ, còn lại là «link chết còn bị bấm»; và referral HỢP LỆ theo link.
  const [luot, referral] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          client.referralClick.groupBy({ by: ["assetId", "outcome"], where: { assetId: { in: ids } }, _count: { _all: true }, orderBy: [{ assetId: "asc" }, { outcome: "asc" }] }),
          client.affiliateReferral.groupBy({
            by: ["assetId"],
            // Góc nhìn ĐỐI TÁC đếm MỌI lượt gửi (không phân loại): đếm riêng lượt HỢP LỆ là cho họ đọc «số này mới» ngay khi gửi (R10 · D1). Góc nhìn vận hành vẫn đếm lượt hợp lệ.
            where: { assetId: { in: ids }, ...(loc.gocNhinDoiTac ? {} : { status: "VALID" as const }) },
            _count: { _all: true },
            orderBy: { assetId: "asc" },
          }),
        ]);
  const demReferral = new Map<string, number>();
  for (const g of referral) if (g.assetId !== null) demReferral.set(g.assetId, g._count._all);
  const ok = new Map<string, number>();
  const loi = new Map<string, number>();
  for (const g of luot) {
    const m = g.outcome === "OK" ? ok : loi;
    m.set(g.assetId, (m.get(g.assetId) ?? 0) + g._count._all);
  }

  const theoTrangThai: Record<TrangThaiLink, number> = { ACTIVE: 0, REVOKED: 0 };
  for (const g of theoTT) theoTrangThai[g.status] = g._count._all;

  const dong: DongLink[] = hang.map((h) => {
    const chuoi = chuoiTuDong(h);
    const sach = h.status === "ACTIVE";
    let lyDoKhongDung: string | null = null;
    if (sach) {
      const kq = kiemChuoiLink(chuoi, loc.now);
      if (!kq.ok) lyDoKhongDung = NHAN_CHUOI_LINK_KHONG_HOP_LE[kq.ma];
    }
    let lienKetNgan: string | null = null;
    let lienKetTrucTiep: string | null = null;
    if (loc.coTheXemDayDu && sach) {
      lienKetNgan = loc.gocLinkNgan === null ? null : dungUrlChuyenHuong(loc.gocLinkNgan, h.publicToken);
      const u = dungUrlDich({ site: h.site, trangDich: chuoi.trangDich, landingHost: chuoi.taiSan.landingHost, landingPath: h.landingPath, token: h.publicToken, campaignCode: h.campaign.code });
      lienKetTrucTiep = u.ok ? u.url : null;
    }
    // URL cuối: xem chú thích trường `urlCuoi`. Link đã thu hồi: không có URL cuối (khách bấm vào cũng chỉ tới trang sạch, không gắn người giới thiệu).
    let urlCuoi: string | null = null;
    if (sach) {
      if (loc.coTheXemDayDu) urlCuoi = lienKetTrucTiep;
      else {
        const sachUrl = dungUrlTrangDich({ site: h.site, trangDich: chuoi.trangDich, landingHost: chuoi.taiSan.landingHost, landingPath: h.landingPath });
        urlCuoi = sachUrl.ok ? sachUrl.url : null;
      }
    }
    let host = h.site.baseUrl;
    try {
      host = new URL(h.site.baseUrl).host;
    } catch {
      /* giữ nguyên chuỗi */
    }
    return {
      id: h.id,
      doiTac: { id: h.party.id, ten: h.party.name, ma: h.party.code },
      campaign: { id: h.campaign.id, ma: h.campaign.code, ten: h.campaign.name },
      website: { ten: h.site.name, host },
      landingPath: h.landingPath,
      landingHost: chuoi.taiSan.landingHost,
      landingNhan: h.landingPage?.label ?? null,
      loai: h.type,
      nhan: h.label,
      trangThai: h.status,
      lyDoKhongDung,
      soLuotBam: ok.get(h.id) ?? 0,
      soLuotBamLoi: loi.get(h.id) ?? 0,
      taoLuc: h.createdAt.toISOString(),
      capNhatLuc: h.updatedAt.toISOString(),
      thuHoiLuc: h.revokedAt ? h.revokedAt.toISOString() : null,
      lyDoThuHoi: h.revokedReason,
      laBanXoay: h.rotatedFromId !== null,
      soReferral: demReferral.get(h.id) ?? 0,
      token: loc.coTheXemDayDu ? h.publicToken : anToken(h.publicToken),
      lienKetNgan,
      lienKetTrucTiep,
      urlCuoi,
    };
  });

  return { dong, tong, trang, kichThuoc, theoTrangThai };
}

// ── Tuỳ chọn cho bộ lọc ─────────────────────────────────────────────────────────────────────────────────────────

export type TuyChonLoc = { campaign: { ma: string; ten: string }[]; doiTac: { ma: string; ten: string }[] };

/** Campaign và đối tác ĐÃ CÓ link (lọc theo thứ không có link nào chỉ ra danh sách rỗng). */
export async function docTuyChonLoc(client: Khach = db): Promise<TuyChonLoc> {
  const [campaign, doiTac] = await Promise.all([
    client.affiliateCampaign.findMany({ where: { assets: { some: {} } }, orderBy: { code: "asc" }, select: { code: true, name: true }, take: 500 }),
    client.affiliate.findMany({ where: { assets: { some: {} } }, orderBy: { name: "asc" }, select: { code: true, name: true }, take: 500 }),
  ]);
  return { campaign: campaign.map((c) => ({ ma: c.code, ten: c.name })), doiTac: doiTac.map((d) => ({ ma: d.code, ten: d.name })) };
}

// ── Tuỳ chọn cho Sheet «Phát link» ──────────────────────────────────────────────────────────────────────────────

/** Trang đích chọn được (AFF-L6): đã giải tên miền + thu hẹp theo campaign; chỉ trang ĐANG BẬT và BẬT THEO DÕI. `id` là thứ gửi lên máy chủ — tên miền KHÔNG gửi, máy chủ suy từ dòng trang đích. */
export type TrangDichChon = { id: string; host: string; mau: string; nhan: string | null; kieu: "CHINH_XAC" | "TIEN_TO" };
export type WebsiteChon = { siteId: string; ten: string; host: string; trangDich: TrangDichChon[] };
export type ChuongTrinhChon = {
  membershipId: string;
  campaignMa: string;
  campaignTen: string;
  websites: WebsiteChon[];
  /** Số link ĐANG HOẠT ĐỘNG của chương trình (đối tác × campaign) và trần — để ô chọn báo «đã dùng X/50» trước khi bấm tạo. Cổng thật vẫn là `kiemPhatLink`. */
  soLinkDangChay: number;
  soLinkToiDa: number;
};
export type DoiTacChon = { id: string; ten: string; ma: string; chuongTrinh: ChuongTrinhChon[] };

/** Con số để ô chọn NÓI RÕ vì sao trống (luật 12: không hứa suông). */
export type ChanDoanPhatLink = {
  soDoiTac: number;
  soDoiTacHoatDong: number;
  soDoiTacCoChuongTrinh: number;
  soChuongTrinhCoWebsiteDung: number;
};

export type TuyChonPhatLink = { doiTac: DoiTacChon[]; chanDoan: ChanDoanPhatLink };

/**
 * Phạm vi của ô chọn «Phát link». BẮT BUỘC, không mặc định (luật 7): quên truyền = `tsc` liệt kê chỗ gọi, chứ không âm thầm đưa danh sách của người khác cho một đối tác.
 *  · `partyIds: null`  — quản trị (đã qua cổng `affiliate_links:manage`): mọi đối tác.
 *  · `partyIds: [...]` — cổng đối tác: CHỈ các hồ sơ của chính người đăng nhập (lấy từ `Affiliate.userId`, không từ client).
 *  · `chiTrangChinhXac` — chỉ trang đích khai KHÔNG có dấu `*` (cổng đối tác: trang tiền tố/wildcard không hiện). Mẫu hỏng (không chuẩn hoá được) cũng bị loại khi bật cờ này.
 */
export type PhamViPhatLink = { partyIds: readonly string[] | null; chiTrangChinhXac: boolean };

/**
 * Đối tác ĐANG HOẠT ĐỘNG × membership ĐANG HOẠT ĐỘNG trong campaign ĐANG CHẠY × website ĐANG HOẠT ĐỘNG, bật theo dõi, ĐÃ GẮN campaign và có ≥ 1 trang đích bật.
 * `now` BẮT BUỘC (luật 19): cửa sổ ngày của membership và campaign đo theo đồng hồ truyền vào.
 * Đây chỉ là bộ lọc cho ô chọn — cổng thật là `kiemPhatLink` ở máy chủ (cùng `kiemChuoiLink` với lúc khách bấm).
 */
export async function docTuyChonPhatLink(now: Date, phamVi: PhamViPhatLink, client: Khach = db): Promise<TuyChonPhatLink> {
  const trongPhamViDoiTac: Prisma.AffiliateWhereInput = phamVi.partyIds === null ? {} : { id: { in: [...phamVi.partyIds] } };
  const [soDoiTac, soDoiTacHoatDong, ds] = await Promise.all([
    client.affiliate.count({ where: trongPhamViDoiTac }),
    client.affiliate.count({ where: { ...trongPhamViDoiTac, status: "ACTIVE" } }),
    client.affiliateMembership.findMany({
      // Cửa sổ ngày CÙNG luật với `kiemLienKet` (`từ ≤ now < đến`, biên trên MỞ): ô chọn không đưa ra chuỗi mà máy chủ sẽ từ chối vì ngày (luật 12).
      where: {
        ...(phamVi.partyIds === null ? {} : { partyId: { in: [...phamVi.partyIds] } }),
        status: "ACTIVE",
        effectiveFrom: { lte: now },
        AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }],
        party: { status: "ACTIVE" },
        campaign: {
          status: "ACTIVE",
          AND: [{ OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] }, { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }],
        },
      },
      orderBy: [{ party: { name: "asc" } }, { campaign: { code: "asc" } }],
      take: TOI_DA_CHUONG_TRINH_CHON,
      select: {
        id: true,
        party: { select: { id: true, name: true, code: true } },
        campaign: {
          select: {
            code: true,
            name: true,
            landings: CHON_RANG_BUOC_CAMPAIGN,
            sites: {
              orderBy: { site: { name: "asc" } },
              select: {
                site: {
                  select: {
                    id: true,
                    name: true,
                    baseUrl: true,
                    allowedDomains: true,
                    status: true,
                    trackingEnabled: true,
                    landingPages: { where: { isActive: true, trackingEnabled: true }, orderBy: [{ hostKey: "asc" }, { pathPattern: "asc" }], select: CHON_TRANG_DICH },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  // Số link đang chạy theo membership — MỘT câu GROUP BY cho cả danh sách (không N+1).
  const dangChay = new Map<string, number>();
  if (ds.length > 0) {
    const g = await client.affiliateTrackingAsset.groupBy({ by: ["membershipId"], where: { membershipId: { in: ds.map((m) => m.id) }, status: "ACTIVE" }, _count: { _all: true }, orderBy: { membershipId: "asc" } });
    for (const x of g) dangChay.set(x.membershipId, x._count._all);
  }

  const theoDoiTac = new Map<string, DoiTacChon>();
  const doiTacCoChuongTrinh = new Set<string>();
  let soChuongTrinhCoWebsiteDung = 0;
  for (const m of ds) {
    doiTacCoChuongTrinh.add(m.party.id);
    const websites: WebsiteChon[] = [];
    for (const { site } of m.campaign.sites) {
      if (site.status !== "ACTIVE" || !site.trackingEnabled || site.landingPages.length === 0) continue;
      // MỘT hàm giải host + thu hẹp theo campaign (cùng hàm với cổng phát / cổng bấm link); chỉ giữ trang đang bật, bật theo dõi, tên miền còn ∈ danh sách của website.
      const hieuLuc = trangDichHieuLuc({ baseUrl: site.baseUrl, trangDich: site.landingPages, rangBuoc: rangBuocCuaCampaign(m.campaign.landings, site.id) }).filter(
        (t) => t.isActive && t.trackingEnabled && hostTrongDanhSach(site.allowedDomains, t.host),
      );
      let host = site.baseUrl;
      try {
        host = new URL(site.baseUrl).host;
      } catch {
        /* giữ nguyên */
      }
      const trangDich: TrangDichChon[] = [];
      for (const t of hieuLuc) {
        const mau = chuanHoaDuongDanMau(t.pathPattern);
        if (phamVi.chiTrangChinhXac) {
          // Cổng đối tác: chỉ trang «đúng» KHÔNG dấu `*`. Mẫu không chuẩn hoá được thì LOẠI (không đoán là «đúng» như bộ chọn của quản trị).
          if (!mau.ok || mau.kieu !== "CHINH_XAC" || t.pathPattern.includes("*")) continue;
          trangDich.push({ id: t.id, host: t.host, mau: t.pathPattern, nhan: t.label, kieu: "CHINH_XAC" });
        } else {
          trangDich.push({ id: t.id, host: t.host, mau: t.pathPattern, nhan: t.label, kieu: mau.ok ? mau.kieu : "CHINH_XAC" });
        }
      }
      if (trangDich.length === 0) continue;
      websites.push({ siteId: site.id, ten: site.name, host, trangDich });
    }
    if (websites.length === 0) continue;
    soChuongTrinhCoWebsiteDung += 1;
    const dt = theoDoiTac.get(m.party.id) ?? { id: m.party.id, ten: m.party.name, ma: m.party.code, chuongTrinh: [] };
    dt.chuongTrinh.push({
      membershipId: m.id,
      campaignMa: m.campaign.code,
      campaignTen: m.campaign.name,
      websites,
      soLinkDangChay: dangChay.get(m.id) ?? 0,
      soLinkToiDa: SO_LINK_HOAT_DONG_TOI_DA,
    });
    theoDoiTac.set(m.party.id, dt);
  }
  return {
    doiTac: [...theoDoiTac.values()],
    chanDoan: { soDoiTac, soDoiTacHoatDong, soDoiTacCoChuongTrinh: doiTacCoChuongTrinh.size, soChuongTrinhCoWebsiteDung },
  };
}

// ── Cho QR ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Token + trạng thái của MỘT link, để dựng QR. Chỉ gọi sau cổng `affiliate_links:manage`. null = không có link đó. */
export async function docLinkChoQr(id: string, client: Khach = db): Promise<{ token: string; status: TrangThaiLink } | null> {
  const h = await client.affiliateTrackingAsset.findUnique({ where: { id }, select: { publicToken: true, status: true } });
  return h ? { token: h.publicToken, status: h.status } : null;
}

/**
 * Như `docLinkChoQr` nhưng cho CỔNG ĐỐI TÁC: chỉ trả khi link thuộc một đối tác mà `userId` VÀO ĐƯỢC (`partyIdsVaoDuoc`, cùng hàm với menu và trang). Quyền sở hữu nằm TRONG truy vấn (`partyId IN`) —
 * id link do client gửi lên, nên link của người khác ra `null` y hệt link không tồn tại (không phân biệt «không có» với «không phải của bạn»).
 */
export async function docLinkChoQrCuaToi(userId: string, id: string, client: Khach = db): Promise<{ token: string; status: TrangThaiLink } | null> {
  const duocVao = await partyIdsVaoDuoc(userId, client);
  if (duocVao.length === 0) return null;
  const h = await client.affiliateTrackingAsset.findFirst({ where: { id, partyId: { in: duocVao } }, select: { publicToken: true, status: true } });
  return h ? { token: h.publicToken, status: h.status } : null;
}

// ── Link ĐANG DÙNG của đối tác (nút «Link» ở bảng đối tác và ở màn cũ) ──────────────────────────────────────────

export type LinkDangDung = { id: string; urlCuoi: string; campaign: string; website: string };

/**
 * Với mỗi đối tác trong `partyIds`: link ACTIVE ∧ dùng được (`kiemChuoiLink` ok, CÙNG cổng với lúc khách bấm) MỚI NHẤT, kèm URL CUỐI trực tiếp (`?aff=&cmp=` — `dungUrlDich`). Đối tác chưa có
 * link dùng được thì KHÔNG có mặt trong Map (nơi gọi vẽ nút «tạo link» thay cho nút sao chép).
 *
 * `coTheXemDayDu` BẮT BUỘC (luật 7): URL cuối mang token đầy đủ của đối tác. Không có `affiliate_links:manage` ⇒ Map RỖNG và KHÔNG chạy truy vấn nào — che ở tầng đọc, vì payload RSC
 * gửi xuống trình duyệt là bản thật. MỘT câu truy vấn cho cả trang (không N+1).
 */
export async function docLinkDangDungTheoDoiTac(
  partyIds: readonly string[],
  p: { coTheXemDayDu: boolean; now: Date },
  client: Khach = db,
): Promise<Map<string, LinkDangDung>> {
  const ra = new Map<string, LinkDangDung>();
  if (!p.coTheXemDayDu || partyIds.length === 0) return ra;
  const hang = await client.affiliateTrackingAsset.findMany({
    where: { partyId: { in: [...partyIds] }, status: "ACTIVE" },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 2000,
    select: {
      ...CHON_CHUOI,
      id: true,
      publicToken: true,
      partyId: true,
      campaign: { select: { name: true, code: true, status: true, effectiveFrom: true, effectiveTo: true, cookieWindowDays: true, sites: { select: { siteId: true } }, landings: CHON_RANG_BUOC_CAMPAIGN } },
      site: { select: { name: true, baseUrl: true, allowedDomains: true, status: true, trackingEnabled: true, landingPages: { select: CHON_TRANG_DICH } } },
    },
  });
  for (const h of hang) {
    if (ra.has(h.partyId)) continue;
    const chuoi = chuoiTuDong(h);
    if (!kiemChuoiLink(chuoi, p.now).ok) continue;
    const u = dungUrlDich({ site: h.site, trangDich: chuoi.trangDich, landingHost: chuoi.taiSan.landingHost, landingPath: h.landingPath, token: h.publicToken, campaignCode: h.campaign.code });
    if (!u.ok) continue;
    ra.set(h.partyId, { id: h.id, urlCuoi: u.url, campaign: h.campaign.name, website: h.site.name });
  }
  return ra;
}
