// lib/affiliate/feature.ts — NƠI DUY NHẤT ĐỌC CỜ AFFILIATE (`affiliate.enabled`).
//
// Khuôn `lib/hoa-hong/feature.ts`: cờ trong DB (SystemSetting), mặc định TẮT, người vận hành bật được và có AuditLog.
// Đặc tả: docs/source-commission/12 §2.6. Cờ này chỉ gác MÀN + phần quản trị (ba tab Affiliate / Campaign / Website) và các đường công khai về sau;
// nó KHÔNG bật việc tính tiền — engine hoa hồng có cờ riêng (`hoaHong.engineBat`).
//
// Cờ chỉ có NGHĨA khi `nguon.enabled` BẬT: campaign trỏ vào danh mục nguồn (`LeadSourceGroup`) mà module Nguồn quản lý. `hopCoAffiliate` là phép giải
// DUY NHẤT (hàm thuần, test không cần DB) — cùng nếp `hopCoNguon`: bật cờ con trước khi bật cờ tổng không được làm cờ con "rò" ra màn hình.
import { getSetting } from "@/lib/settings/service";

export const KHOA_AFFILIATE = "affiliate.enabled" as const;

/** Giải tổ hợp: affiliate chỉ bật khi CẢ cờ affiliate LẪN công tắc tổng nguồn bật. THUẦN. */
export function hopCoAffiliate(tho: { affiliate: boolean; nguon: boolean }): boolean {
  return tho.nguon && tho.affiliate;
}

/**
 * Giá trị THÔ của cờ affiliate trong DB (chưa AND với cờ nguồn). Nơi cần "có hiện màn không" phải qua `docCoModule` / `hopCoAffiliate`,
 * không dùng thẳng hàm này.
 */
export async function laAffiliateBatTho(): Promise<boolean> {
  return await getSetting(KHOA_AFFILIATE);
}
