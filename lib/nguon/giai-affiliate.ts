// lib/nguon/giai-affiliate.ts — GIẢI tín hiệu «referral Affiliate» thành thứ resolver quy nguồn dùng được. THUẦN.
//
// Resolver KHÔNG nhận token và KHÔNG tự đoán nguồn: tầng gọi (`lib/affiliate/nhan-referral.ts`) đã kiểm link/membership/campaign/tự-giới-thiệu và đã GIẢI nguồn từ cấu hình
// (`giaiNguonCuaDoiTac`). Ở đây chỉ làm nốt phần mà CHỈ tầng đọc của `lib/nguon` làm được — đối chiếu với dữ liệu sống TẠI LÚC GHI: đối tác còn hoạt động không, nhóm nguồn đích còn tồn tại
// không (nhóm còn ACTIVE ∧ trong hiệu lực hay không do `CauHinhQuyNguon.nhom[].active` quyết, ở luật). `loi ≠ null` ⇒ luật `AFFILIATE_REFERRAL` KHÔNG khớp (rơi xuống luật sau),
// không ném, không chặn lead (T4: lỗi ở bước quy nguồn không được làm mất khách).
import type { AffiliateReferralDaGiai, AffiliateReferralDauVao } from "./tin-hieu";

export function giaiAffiliateReferral(
  v: AffiliateReferralDauVao,
  tra: { affiliateConHoatDong: boolean; nhom: { code: string } | undefined },
): AffiliateReferralDaGiai {
  if (!tra.affiliateConHoatDong) {
    return { affiliateId: v.affiliateId, groupCode: "", snapshot: v.snapshot, loi: "Đối tác giới thiệu không còn hoạt động lúc ghi nhận." };
  }
  if (!tra.nhom) {
    return { affiliateId: v.affiliateId, groupCode: "", snapshot: v.snapshot, loi: "Nguồn đã giải từ cấu hình campaign không còn tồn tại." };
  }
  return { affiliateId: v.affiliateId, groupCode: tra.nhom.code, snapshot: v.snapshot, loi: null };
}
