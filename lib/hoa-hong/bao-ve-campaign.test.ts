// @vitest-environment node
/**
 * [L2-BV-*] — CỬA SỔ BẢO VỆ CỦA CAMPAIGN (AFF-L2, D-A): `xetLienKetCampaign` + `xetBaoVeCampaign`. THUẦN — không DB, không đồng hồ (luật 19: mọi ngày TUYỆT ĐỐI).
 *
 *   [L2-BV-01] đối chứng dương: chuỗi đủ + trong hạn ⇒ bảo vệ, kèm hạn
 *   [L2-BV-02] MỖI điều kiện sai MỘT mình ⇒ không bảo vệ, đúng lý do (bảng âm — mỗi dòng đối chứng với [L2-BV-01])
 *   [L2-BV-03] biên ngày: đúng hạn chót ⇒ còn bảo vệ; một mili-giây sau ⇒ hết; thành viên biên MỞ ở `effectiveTo`
 *   [L2-BV-04] `status` (trạng thái SỐNG) của campaign không ảnh hưởng: ENDED sau ngày thu không rút bảo vệ đã phát (đo ở NGÀY SỰ KIỆN, không ở hôm nay)
 *   [L2-BV-05] liên kết hợp lệ ≠ còn hạn bảo vệ: hết hạn thì liên kết vẫn hợp lệ (so bóng D-D cần đúng cái này)
 */
import { describe, expect, it } from "vitest";

import type { AffiliateChoHoaHong } from "@/lib/affiliate/campaign-cho-hoa-hong";

import { NHAN_KHONG_BAO_VE, xetBaoVeCampaign, xetLienKetCampaign, type LyDoKhongBaoVe } from "./bao-ve-campaign";

const D = (s: string): Date => new Date(`${s}T03:00:00.000Z`);
const NGAY_THU = D("2026-12-20");
const HAN = D("2027-01-03");

function aff(p: Partial<AffiliateChoHoaHong> = {}): AffiliateChoHoaHong {
  return {
    campaignId: "c1",
    campaignCode: "C1",
    campaignName: "Campaign 1",
    partyId: "p1",
    membershipId: "m1",
    referralId: "r1",
    thanhVien: { effectiveFrom: D("2026-01-01"), effectiveTo: null },
    referral: { protectedUntil: HAN, sourceGroupId: "g1" },
    chup: {
      status: "ACTIVE",
      attributionModel: "FIRST_VALID",
      cookieWindowDays: 30,
      protectWindowDays: 90,
      defaultSourceGroupId: "g1",
      effectiveFrom: null,
      effectiveTo: null,
      updatedAt: D("2026-10-01"),
    },
    partyKind: "PERSON",
    parentPartyId: null,
    typeCode: null,
    tu: null,
    tuNhan: null,
    ...p,
  };
}

describe("[L2-BV-01] đối chứng dương", () => {
  it("chuỗi đủ, ngày thu trong hạn ⇒ được bảo vệ đến hạn của referral", () => {
    const r = xetBaoVeCampaign(aff(), NGAY_THU, "g1");
    expect(r).toEqual({ baoVe: true, baoVeDen: HAN });
    expect(xetLienKetCampaign(aff(), NGAY_THU, "g1")).toEqual({ hopLe: true });
  });
});

describe("[L2-BV-02] mỗi điều kiện sai MỘT mình", () => {
  const cac: [string, AffiliateChoHoaHong | null, string | null, LyDoKhongBaoVe][] = [
    ["không có campaign", null, "g1", "KHONG_CO_CAMPAIGN"],
    ["không có thành viên", aff({ thanhVien: null }), "g1", "KHONG_CO_THANH_VIEN"],
    ["không có referral VALID", aff({ referral: null }), "g1", "KHONG_CO_REFERRAL_HOP_LE"],
    ["nguồn của attribution khác nguồn referral đã giải", aff(), "g2", "NGUON_KHONG_KHOP"],
    ["attribution không có nguồn", aff(), null, "NGUON_KHONG_KHOP"],
    ["referral không có hạn bảo vệ (không đoán)", aff({ referral: { protectedUntil: null, sourceGroupId: "g1" } }), "g1", "REFERRAL_KHONG_CO_HAN_BAO_VE"],
    ["quá hạn bảo vệ", aff({ referral: { protectedUntil: D("2026-12-19"), sourceGroupId: "g1" } }), "g1", "HET_HAN_BAO_VE"],
    ["thành viên chưa có hiệu lực vào ngày thu", aff({ thanhVien: { effectiveFrom: D("2026-12-21"), effectiveTo: null } }), "g1", "THANH_VIEN_CHUA_HIEU_LUC"],
    ["thành viên đã hết hiệu lực vào ngày thu", aff({ thanhVien: { effectiveFrom: D("2026-01-01"), effectiveTo: D("2026-12-20") } }), "g1", "THANH_VIEN_DA_HET_HIEU_LUC"],
    ["campaign ngoài thời gian hiệu lực (chưa bắt đầu)", aff({ chup: { ...aff().chup, effectiveFrom: D("2026-12-21") } }), "g1", "CAMPAIGN_NGOAI_HIEU_LUC"],
    ["campaign ngoài thời gian hiệu lực (đã kết thúc)", aff({ chup: { ...aff().chup, effectiveTo: D("2026-12-20") } }), "g1", "CAMPAIGN_NGOAI_HIEU_LUC"],
  ];
  for (const [ten, a, nguon, lyDo] of cac) {
    it(`${ten} ⇒ ${lyDo}`, () => {
      expect(xetBaoVeCampaign(a, NGAY_THU, nguon)).toEqual({ baoVe: false, lyDo });
    });
  }
  it("mỗi lý do có câu tiếng Việt (không mã trần ra màn)", () => {
    for (const [, , , lyDo] of cac) expect(NHAN_KHONG_BAO_VE[lyDo].length).toBeGreaterThan(10);
  });
});

describe("[L2-BV-03] biên ngày", () => {
  it("đúng hạn chót ⇒ còn bảo vệ; thu CÙNG NGÀY VN nhưng muộn hơn giờ nhận (cả sau 1 mili-giây, cả 13 giờ sau) ⇒ VẪN bảo vệ; sang NGÀY VN kế ⇒ hết", () => {
    expect(xetBaoVeCampaign(aff(), HAN, "g1").baoVe).toBe(true);
    // HAN = 10:00 VN ngày 03/01. Cùng ngày, muộn hơn: còn bảo vệ (bản so từng mili-giây từng báo HET_HAN_BAO_VE ở đây — reviewer Tài chính 13/10/2026)
    expect(xetBaoVeCampaign(aff(), new Date(HAN.getTime() + 1), "g1").baoVe).toBe(true);
    expect(xetBaoVeCampaign(aff(), new Date(HAN.getTime() + 13 * 3_600_000), "g1").baoVe).toBe(true); // 23:00 VN ngày 03/01
    // 00:00 VN ngày 04/01 = 17:00Z ngày 03/01 ⇒ ngày kế
    expect(xetBaoVeCampaign(aff(), new Date("2027-01-03T17:00:00.000Z"), "g1")).toEqual({ baoVe: false, lyDo: "HET_HAN_BAO_VE" });
    // 23:59:59.999 VN ngày 03/01 = 16:59:59.999Z ⇒ còn trong ngày
    expect(xetBaoVeCampaign(aff(), new Date("2027-01-03T16:59:59.999Z"), "g1").baoVe).toBe(true);
  });
  it("thành viên: `effectiveTo` là biên MỞ (đúng mốc ⇒ đã hết), `effectiveFrom` là biên ĐÓNG (đúng mốc ⇒ đã có)", () => {
    const a = aff({ thanhVien: { effectiveFrom: NGAY_THU, effectiveTo: new Date(NGAY_THU.getTime() + 1) } });
    expect(xetBaoVeCampaign(a, NGAY_THU, "g1").baoVe).toBe(true);
    expect(xetBaoVeCampaign(a, new Date(NGAY_THU.getTime() + 1), "g1")).toEqual({ baoVe: false, lyDo: "THANH_VIEN_DA_HET_HIEU_LUC" });
  });
});

describe("[L2-BV-04] trạng thái SỐNG không phải thước đo", () => {
  it("campaign ENDED/PAUSED (không đóng dấu effectiveTo) vẫn bảo vệ referral đã nhận cho ngày thu TRƯỚC khi nó kết thúc — kết quả không đổi theo `status`", () => {
    for (const status of ["ACTIVE", "PAUSED", "ENDED", "DRAFT"]) {
      expect(xetBaoVeCampaign(aff({ chup: { ...aff().chup, status } }), NGAY_THU, "g1").baoVe, status).toBe(true);
    }
  });
});

describe("[L2-BV-05] liên kết hợp lệ ≠ còn hạn bảo vệ", () => {
  it("hết hạn bảo vệ ⇒ không bảo vệ NHƯNG liên kết vẫn hợp lệ (so bóng D-D gọi chênh theo chính sách campaign là dự kiến dù quá hạn)", () => {
    const het = aff({ referral: { protectedUntil: D("2026-12-19"), sourceGroupId: "g1" } });
    expect(xetBaoVeCampaign(het, NGAY_THU, "g1").baoVe).toBe(false);
    expect(xetLienKetCampaign(het, NGAY_THU, "g1")).toEqual({ hopLe: true });
  });
});
