/**
 * lib/affiliate/doc-website.ts — ĐỌC danh sách website + trang đích + campaign đang dùng cho tab «Website» (AFF-P0b). Chỉ đọc; ghi ở `ghi-website.ts`.
 *
 * Website là danh mục TOÀN HỆ (không `centerId`) nên không qua `scopedDb`; quyền xem là việc của page (`affiliate_campaigns:view`).
 * Ba câu truy vấn song song (không nối đuôi): website kèm trang đích + campaign gắn, và danh sách campaign chọn làm mặc định.
 * Chưa phân trang: danh mục website là vài chục dòng; khi vượt thì thêm phân trang ở tầng truy vấn (đừng cắt ở giao diện).
 */
import { db } from "@/lib/db";
import type { TrangThaiWebsite } from "./ghi-website-dau-vao";
import { giaiHostTrangDich } from "./trang-dich-hieu-luc";

export type DongTrangDich = {
  id: string;
  /** Tên miền RIÊNG của trang đích (NULL = tên miền của gốc URL). */
  host: string | null;
  /** Tên miền ĐÃ GIẢI (host riêng, không có thì host của gốc URL) — thứ khách thực sự tới. */
  hostGiai: string;
  pathPattern: string;
  label: string | null;
  isActive: boolean;
  /** Theo dõi riêng trang này (website vẫn có thể bật). */
  trackingEnabled: boolean;
  /** Số link ĐANG HOẠT ĐỘNG đã chụp trang đích này lúc phát (link cũ chưa suy được trang đích không tính). */
  soLinkDangChay: number;
  /** ISO của `updatedAt` — mốc khoá lạc quan khi sửa / bật-tắt. */
  capNhatLuc: string;
};

export type CampaignGanWebsite = { id: string; code: string; name: string; status: string };

export type DongWebsite = {
  id: string;
  code: string;
  name: string;
  baseUrl: string;
  allowedDomains: string[];
  status: TrangThaiWebsite;
  trackingEnabled: boolean;
  defaultCampaignId: string | null;
  /** Campaign mặc định kèm tên/trạng thái (có thể ĐÃ KẾT THÚC — khi đó không nằm trong `campaignChon`, biểu mẫu vẫn phải hiện đúng nó). */
  defaultCampaign: CampaignGanWebsite | null;
  /** ISO của `updatedAt` — mốc khoá lạc quan. */
  capNhatLuc: string;
  trangDich: DongTrangDich[];
  /** Campaign đang gắn website này (CHỈ ĐỌC ở tab này — việc gắn/gỡ thuộc màn Campaign). */
  campaigns: CampaignGanWebsite[];
};

/** Campaign chọn làm mặc định của website: chưa kết thúc. */
export type CampaignChon = { id: string; code: string; name: string; status: string };

export type DuLieuWebsite = { dong: DongWebsite[]; campaignChon: CampaignChon[] };

export async function docWebsite(): Promise<DuLieuWebsite> {
  const [sites, campaignChon] = await Promise.all([
    db.affiliateSite.findMany({
      orderBy: [{ status: "asc" }, { code: "asc" }],
      include: {
        landingPages: { orderBy: [{ hostKey: "asc" }, { pathPattern: "asc" }], include: { _count: { select: { assets: { where: { status: "ACTIVE" } } } } } },
        defaultCampaign: { select: { id: true, code: true, name: true, status: true } },
        campaigns: { include: { campaign: { select: { id: true, code: true, name: true, status: true } } } },
      },
    }),
    db.affiliateCampaign.findMany({
      where: { status: { not: "ENDED" } },
      orderBy: [{ code: "asc" }],
      select: { id: true, code: true, name: true, status: true },
    }),
  ]);
  return {
    dong: sites.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      baseUrl: s.baseUrl,
      allowedDomains: s.allowedDomains,
      status: s.status,
      trackingEnabled: s.trackingEnabled,
      defaultCampaignId: s.defaultCampaignId,
      defaultCampaign: s.defaultCampaign,
      capNhatLuc: s.updatedAt.toISOString(),
      trangDich: s.landingPages.map((t) => ({
        id: t.id,
        host: t.host,
        hostGiai: giaiHostTrangDich(s.baseUrl, t.host),
        pathPattern: t.pathPattern,
        label: t.label,
        isActive: t.isActive,
        trackingEnabled: t.trackingEnabled,
        soLinkDangChay: t._count.assets,
        capNhatLuc: t.updatedAt.toISOString(),
      })),
      campaigns: s.campaigns
        .map((c) => ({ id: c.campaign.id, code: c.campaign.code, name: c.campaign.name, status: c.campaign.status }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    })),
    campaignChon,
  };
}
