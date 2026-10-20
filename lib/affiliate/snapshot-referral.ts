// lib/affiliate/snapshot-referral.ts — ĐỌC bản chụp referral Affiliate nằm trong `LeadAttribution.signals.affiliate`. THUẦN: không DB, không đồng hồ.
//
// Bản chụp do `chuanBiReferral` (nhan-referral.ts) ghi LÚC quy nguồn, rồi `quy-nguon.ts` đưa vào `signals.affiliate`. Hình dạng đã chốt ở đó:
//   { affiliateCode, campaignCode, method, typeCode, tagCodes, tu?, tuNhan?, origin, canCuTuGioiThieu? }
// KHÔNG có `campaignId` / `membershipId` / `referralId` (AFF-P2 quyết định 2: không chụp thêm — id lấy lúc quét theo `campaignCode`, vốn UNIQUE và không đổi sau khi tạo).
//
// Đọc PHÒNG THỦ: `signals` là JSON tự do và còn bị `doi-nguon-lead.ts` chép nguyên (`...conLai`) qua lượt đổi nguồn thủ công, nên không được tin hình dạng. Thiếu một trong hai mã
// ⇒ `null` (KHÔNG đoán campaign) — attribution cũ, attribution không đi qua luật AFFILIATE_REFERRAL, và chỗ JSON hỏng đều rơi vào đây.

import { NHAN_TU_DAU, type TuDauGiaiNguon } from "./giai-nguon";
import type { CanCuTuGioiThieu } from "./tu-gioi-thieu";

export type SnapshotAffiliate = {
  affiliateCode: string;
  campaignCode: string;
  /** Bậc quyết định nguồn (`TuDauGiaiNguon`) — chữ máy, chỉ để hiển thị lại. */
  tu: string | null;
  tuNhan: string | null;
  typeCode: string | null;
};

const laDoiTuong = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const chuoiKhongRong = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const chuoiHoacNull = (x: unknown): string | null => (typeof x === "string" && x.trim().length > 0 ? x : null);

export function docSnapshotAffiliate(signals: unknown): SnapshotAffiliate | null {
  if (!laDoiTuong(signals)) return null;
  const a = signals.affiliate;
  if (!laDoiTuong(a)) return null;
  if (!chuoiKhongRong(a.affiliateCode) || !chuoiKhongRong(a.campaignCode)) return null;
  return {
    affiliateCode: a.affiliateCode,
    campaignCode: a.campaignCode,
    tu: chuoiHoacNull(a.tu),
    tuNhan: chuoiHoacNull(a.tuNhan),
    typeCode: chuoiHoacNull(a.typeCode),
  };
}

// ── GHI bản chụp — MỘT nơi dựng cho cả đường tự động lẫn đường duyệt tay (AFF-L3b) ───────────────────────────────────────────────────
//
// `LeadAttribution.signals.affiliate` và `AffiliateReferral.sourceSnapshot` mang CÙNG hình dạng. Hình dạng này do hai đường dựng: `chuanBiReferral` (khách gửi biểu mẫu qua link) và
// DUYỆT TAY (`lib/nguon/ghi-nguon-affiliate-duyet.ts`). Dựng ở hai nơi bằng tay là có ngày một khoá lệch tên — và `docAffiliateChoHoaHong` (cổng của engine) trả `null` im lặng, hoa hồng của
// đối tác biến mất mà không lỗi nào báo. Nên dựng ở ĐÂY.
export type DauVaoDungSnapshot = {
  /** `Affiliate.code` — PHẢI là mã của đối tác đang giữ công (cổng engine so mã này). */
  affiliateCode: string;
  campaignCode: string;
  /** Cách đến: `LINK` · `QR` · `CODE` (đường tự động) hoặc `MANUAL` · `OFFLINE` (đường khai tay). */
  method: string;
  typeCode: string | null;
  tagCodes: readonly string[];
  /** Bậc quyết định nguồn; null ⇒ KHÔNG ghi `tu`/`tuNhan` (lượt chưa quy được nguồn). */
  tu: TuDauGiaiNguon | null;
  origin: "KHOP" | "LECH" | "VANG";
  canCuTuGioiThieu: readonly CanCuTuGioiThieu[];
};

export function dungSnapshotReferral(v: DauVaoDungSnapshot): Record<string, unknown> {
  return {
    affiliateCode: v.affiliateCode,
    campaignCode: v.campaignCode,
    method: v.method,
    typeCode: v.typeCode,
    tagCodes: [...v.tagCodes].sort(),
    ...(v.tu !== null ? { tu: v.tu, tuNhan: NHAN_TU_DAU[v.tu] } : {}),
    origin: v.origin,
    ...(v.canCuTuGioiThieu.length > 0 ? { canCuTuGioiThieu: [...v.canCuTuGioiThieu] } : {}),
  };
}
