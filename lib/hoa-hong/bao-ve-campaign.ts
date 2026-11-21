// lib/hoa-hong/bao-ve-campaign.ts — CỬA SỔ BẢO VỆ CỦA CAMPAIGN AFFILIATE: referral có còn được campaign bảo vệ vào NGÀY SỰ KIỆN không. THUẦN — không DB, không đồng hồ.
//
// Nguồn: AFF-L2 (D-A, người điều phối chốt 13/10/2026) — docs/source-commission/closeout/l2-engine.md.
//
// ── BA khái niệm tách bạch (đừng gộp) ───────────────────────────────────────────────────────────────────────────
//   (1) CỬA SỔ BẢO VỆ CỦA CAMPAIGN (`AffiliateCampaign.protectWindowDays` → `AffiliateReferral.protectedUntil`): AI SỞ HỮU referral. Đây là thứ file này đo.
//   (2) CỬA SỔ GHI CÔNG CỦA NGUỒN (`LeadSourceGroup.attributionWindowDays` / setting): luật riêng của NGUỒN, do `dau-vao-chinh-sach.ts` đo (`ngoaiCuaSo`). Vẫn đúng cho mọi vai thu hút khác.
//   (3) CHÍNH SÁCH HOA HỒNG: có trả tiền hay không (rule thắng).
//
// Hoa hồng của vai AFFILIATE đến từ referral hợp lệ KHÔNG bị cửa sổ nguồn vô hiệu LẦN HAI nếu campaign còn bảo vệ hợp lệ — trừ khi rule thắng YÊU CẦU tường minh dùng cửa sổ nguồn
// (`CommissionRule.dungCuaSoNguon`). Quyết định ÁP hay KHÔNG nằm ở `tinh-dong-cho-khoan.ts` (cần rule thắng); file này chỉ trả lời "campaign còn bảo vệ referral này không".
//
// ⚠️ MỌI phép đo là ở NGÀY SỰ KIỆN (ngày thu ĐẦU của lần mua), KHÔNG BAO GIỜ ở `bc.now`: đo ở hôm nay thì kết thúc campaign / ngưng thành viên SAU ngày thu làm kết quả lật, băm đổi, mọi ô cũ hoá INPUT_DRIFT giả
// (cùng lý do `campaign-cho-hoa-hong.ts` cố ý không lọc theo trạng thái). Vì thế KHÔNG đọc `status` của campaign / thành viên — chúng là trạng thái SỐNG, không mang thời điểm; chỉ đọc các mốc ngày.
// Campaign ENDED/PAUSED không đóng dấu `effectiveTo` nên cũng KHÔNG rút bảo vệ của referral đã nhận: bảo vệ là quyền đã phát ra lúc ghi nhận, hết ở `protectedUntil`.
import type { AffiliateChoHoaHong } from "@/lib/affiliate/campaign-cho-hoa-hong";
import { ngayVN } from "@/lib/format/thoi-gian-vn";

export type LyDoKhongLienKet =
  | "KHONG_CO_CAMPAIGN"
  | "KHONG_CO_THANH_VIEN"
  | "KHONG_CO_REFERRAL_HOP_LE"
  | "NGUON_KHONG_KHOP"
  | "THANH_VIEN_CHUA_HIEU_LUC"
  | "THANH_VIEN_DA_HET_HIEU_LUC"
  | "CAMPAIGN_NGOAI_HIEU_LUC";

export type LyDoKhongBaoVe = LyDoKhongLienKet | "REFERRAL_KHONG_CO_HAN_BAO_VE" | "HET_HAN_BAO_VE";

export type KetQuaLienKet = { hopLe: true } | { hopLe: false; lyDo: LyDoKhongLienKet };
export type KetQuaBaoVe = { baoVe: true; baoVeDen: Date } | { baoVe: false; lyDo: LyDoKhongBaoVe };

/** Biên: `[tu, den)` — `tu` null = từ đầu, `den` null = còn hiệu lực. Cùng khuôn `CommissionRateConfig` (biên MỞ). */
function trongKhoang(ngay: Date, tu: Date | null, den: Date | null): boolean {
  if (tu !== null && ngay.getTime() < tu.getTime()) return false;
  if (den !== null && ngay.getTime() >= den.getTime()) return false;
  return true;
}

/**
 * Chuỗi liên kết (đối tác — thành viên — referral — nguồn — campaign) của khoản có HỢP LỆ vào `ngaySuKien` không — chưa nói gì về HẠN bảo vệ. Dùng ở HAI nơi:
 *   · `xetBaoVeCampaign` (ngay dưới) — cộng thêm hạn bảo vệ;
 *   · so bóng (D-D): dòng theo chính sách campaign chỉ là chênh LỆCH ĐƯỢC CHẤP NHẬN khi chuỗi này hợp lệ. Hạn bảo vệ không phải điều kiện ở đó: nó quyết khoản có ĐƯỢC TRẢ hay không, không quyết chênh có giải thích được hay không.
 * Điều kiện: có thành viên · có referral VALID mà NGUỒN nó giải lúc ghi nhận KHỚP nguồn của attribution hiện tại (`nguonGroupId` — đổi nguồn thủ công thì không còn là referral này) ·
 * thành viên hiệu lực vào ngày đó · campaign (nếu có mốc `effectiveFrom/To`) hiệu lực vào ngày đó.
 */
export function xetLienKetCampaign(a: AffiliateChoHoaHong | null, ngaySuKien: Date, nguonGroupId: string | null): KetQuaLienKet {
  if (a === null) return { hopLe: false, lyDo: "KHONG_CO_CAMPAIGN" };
  if (a.thanhVien === null) return { hopLe: false, lyDo: "KHONG_CO_THANH_VIEN" };
  if (a.referral === null) return { hopLe: false, lyDo: "KHONG_CO_REFERRAL_HOP_LE" };
  if (nguonGroupId === null || a.referral.sourceGroupId !== nguonGroupId) return { hopLe: false, lyDo: "NGUON_KHONG_KHOP" };
  if (ngaySuKien.getTime() < a.thanhVien.effectiveFrom.getTime()) return { hopLe: false, lyDo: "THANH_VIEN_CHUA_HIEU_LUC" };
  if (a.thanhVien.effectiveTo !== null && ngaySuKien.getTime() >= a.thanhVien.effectiveTo.getTime()) return { hopLe: false, lyDo: "THANH_VIEN_DA_HET_HIEU_LUC" };
  if (!trongKhoang(ngaySuKien, a.chup.effectiveFrom, a.chup.effectiveTo)) return { hopLe: false, lyDo: "CAMPAIGN_NGOAI_HIEU_LUC" };
  return { hopLe: true };
}

/**
 * Campaign còn BẢO VỆ referral này vào `ngaySuKien` không = chuỗi liên kết hợp lệ VÀ `ngaySuKien ≤ protectedUntil` (đóng ở cuối: ngày thu đúng hạn chót vẫn được bảo vệ).
 * `protectedUntil` null = không có hạn bảo vệ ⇒ KHÔNG bảo vệ (không đoán). Mỗi điều kiện có đối chứng riêng ở `bao-ve-campaign.test.ts`.
 */
export function xetBaoVeCampaign(a: AffiliateChoHoaHong | null, ngaySuKien: Date, nguonGroupId: string | null): KetQuaBaoVe {
  const lk = xetLienKetCampaign(a, ngaySuKien, nguonGroupId);
  if (!lk.hopLe) return { baoVe: false, lyDo: lk.lyDo };
  const den = a!.referral!.protectedUntil;
  if (den === null) return { baoVe: false, lyDo: "REFERRAL_KHONG_CO_HAN_BAO_VE" };
  // So theo NGÀY VN (cùng cách cửa sổ nguồn đếm, gồm cả ngày cuối): `protectedUntil = lúc nhận + N×24h` mang giờ, còn ngày thu là Timestamptz có giờ thật — so từng mili-giây thì khoản thu
  // đúng ngày hạn chót nhưng muộn hơn giờ nhận bị coi là hết hạn, trái với câu «đúng hạn chót vẫn được bảo vệ» ở trên (reviewer Tài chính, 13/10/2026).
  if (ngayVN(ngaySuKien) > ngayVN(den)) return { baoVe: false, lyDo: "HET_HAN_BAO_VE" };
  return { baoVe: true, baoVeDen: den };
}

/** Câu tiếng Việt cho "vì sao KHÔNG được campaign bảo vệ" — dùng ở ngăn «Vì sao con số này». */
export const NHAN_KHONG_BAO_VE: Readonly<Record<LyDoKhongBaoVe, string>> = {
  KHONG_CO_CAMPAIGN: "khoản không đến từ campaign Affiliate",
  KHONG_CO_THANH_VIEN: "đối tác không có tư cách thành viên của campaign",
  KHONG_CO_REFERRAL_HOP_LE: "không có referral hợp lệ của đối tác cho khách này trong campaign",
  REFERRAL_KHONG_CO_HAN_BAO_VE: "referral không có hạn bảo vệ",
  HET_HAN_BAO_VE: "ngày thu đã quá hạn bảo vệ của campaign",
  THANH_VIEN_CHUA_HIEU_LUC: "ngày thu trước khi đối tác có hiệu lực trong campaign",
  THANH_VIEN_DA_HET_HIEU_LUC: "ngày thu sau khi đối tác hết hiệu lực trong campaign",
  CAMPAIGN_NGOAI_HIEU_LUC: "ngày thu nằm ngoài thời gian hiệu lực của campaign",
  NGUON_KHONG_KHOP: "nguồn của khách đã khác nguồn campaign ghi nhận lúc giới thiệu",
};
