// lib/affiliate/trang-dich-hieu-luc.ts — «CÁC TRANG ĐÍCH DÙNG ĐƯỢC CỦA MỘT CHUỖI LINK» — MỘT hàm thuần cho mọi nơi hỏi (AFF-L6, docs/source-commission/closeout/l6-da-website-landing.md).
//
// Phát link (admin + cổng đối tác), cổng `kiemChuoiLink` (lúc khách bấm / nhận biểu mẫu), `/r/:token`, beacon, intake, ô chọn «Phát link» — TẤT CẢ lấy danh sách trang đích từ đây. Hai việc, một chỗ:
//   1. GIẢI HOST: trang đích có host riêng ∈ `allowedDomains` của website (vd `covua.quatang.edu.vn`) hoặc không (= tên miền của `baseUrl`).
//   2. THU HẸP THEO CAMPAIGN (mức trang đích): campaign không chọn trang nào của website ⇒ KHÔNG hạn chế (mọi trang đích của website); có chọn ⇒ chỉ các trang đã chọn. Đọc THEO TỪNG (campaign × website).
// Hàm KHÔNG lọc trang đang tắt: `isActive` / `trackingEnabled` đi cùng đối tượng để các cổng (`chonTrangKhop`, `kiemChuoiLink`) tự quyết và màn hình nói được VÌ SAO một trang không dùng được.
//
// THUẦN: không DB, không đồng hồ.
import { chonTrangKhop, hostCuaBaseUrl, type TrangDichDeKiem } from "./website-hop-le";

/** Hàng `AffiliateLandingPage` như DB trả (host riêng có thể NULL). */
export type TrangDichDb = { id: string; host: string | null; pathPattern: string; label: string | null; isActive: boolean; trackingEnabled: boolean };

/** Trang đích trong chuỗi link: host ĐÃ GIẢI (không NULL). */
export type TrangDichChuoi = TrangDichDeKiem & { id: string; label: string | null };

/** Phần `select` dùng chung của mọi nơi đọc trang đích để dựng chuỗi (một nơi khai — thêm cột ở đây là mọi nơi có). */
export const CHON_TRANG_DICH = { id: true, host: true, pathPattern: true, label: true, isActive: true, trackingEnabled: true } as const;

/** Phần `select` dùng chung của «campaign đã chọn trang đích nào». */
export const CHON_RANG_BUOC_CAMPAIGN = { select: { landingPageId: true, landingPage: { select: { siteId: true } } } } as const;

export type DongRangBuocCampaign = { landingPageId: string; landingPage: { siteId: string } };

/** Id trang đích campaign đã chọn TRONG MỘT website. Rỗng = không hạn chế website đó. */
export function rangBuocCuaCampaign(landings: readonly DongRangBuocCampaign[], siteId: string): string[] {
  return landings.filter((l) => l.landingPage.siteId === siteId).map((l) => l.landingPageId);
}

/** Tên miền đã giải của một trang đích: host riêng, không có thì host của `baseUrl`; không giải được ⇒ chuỗi rỗng (không bao giờ khớp một URL thật). */
export function giaiHostTrangDich(baseUrl: string, hostRieng: string | null): string {
  return hostRieng ?? hostCuaBaseUrl(baseUrl) ?? "";
}

/**
 * Các trang đích của website sau khi GIẢI HOST và THU HẸP THEO CAMPAIGN. `rangBuoc` rỗng ⇒ không thu hẹp.
 * Id trong `rangBuoc` không còn thuộc website (đã xoá / sang website khác) bị bỏ qua; nhưng nếu `rangBuoc` KHÁC rỗng mà không id nào còn tồn tại thì kết quả RỖNG — thu hẹp không được âm thầm
 * "nở ra" thành không hạn chế chỉ vì trang đã chọn biến mất.
 */
export function trangDichHieuLuc(p: { baseUrl: string; trangDich: readonly TrangDichDb[]; rangBuoc: readonly string[] }): TrangDichChuoi[] {
  const chon = p.rangBuoc.length > 0 ? new Set(p.rangBuoc) : null;
  return p.trangDich
    .filter((t) => chon === null || chon.has(t.id))
    .map((t) => ({ id: t.id, label: t.label, pathPattern: t.pathPattern, isActive: t.isActive, trackingEnabled: t.trackingEnabled, host: giaiHostTrangDich(p.baseUrl, t.host) }));
}

/** Link tại (`host`, `path`) còn khớp một trang đích ĐANG BẬT trong danh sách không. */
export function trangDichKhopLink(trangDich: readonly TrangDichDeKiem[], host: string, path: string): boolean {
  return chonTrangKhop(trangDich, host, path) !== null;
}

/**
 * Đếm các link ĐANG HOẠT ĐỘNG mất hiệu lực nếu danh sách trang đích dùng được đổi từ `truoc` sang `sau` (thu hẹp campaign, tắt trang đích, đổi host…). Link còn khớp ở `truoc` mà không khớp ở `sau`
 * ⇒ tính. Dùng để BÁO trước khi ghi — không bao giờ để một thao tác làm hỏng link đang chạy mà người bấm không biết.
 */
export function demLinkMatHieuLuc(
  links: readonly { landingHost: string | null; landingPath: string }[],
  baseHost: string,
  truoc: readonly TrangDichDeKiem[],
  sau: readonly TrangDichDeKiem[],
): number {
  let n = 0;
  for (const l of links) {
    const host = l.landingHost ?? baseHost;
    if (trangDichKhopLink(truoc, host, l.landingPath) && !trangDichKhopLink(sau, host, l.landingPath)) n += 1;
  }
  return n;
}
