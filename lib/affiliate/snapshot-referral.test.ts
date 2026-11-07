// @vitest-environment node
/**
 * [AFP-SNAP-*] — đọc bản chụp `signals.affiliate` (AFF-P2). THUẦN.
 *
 * Vì sao ca này quan trọng: từ bản chụp này engine SUY RA campaign của khoản thu và CHỤP vào sổ bất biến. Đọc nhầm ⇒ ghi nhầm campaign vào sổ không sửa được.
 * Nên nó phải từ chối (trả `null`) MỌI hình dạng nó không hiểu, và không bao giờ bịa ra một campaign.
 */
import { describe, expect, it } from "vitest";

import { quaCongAffiliate } from "./campaign-cho-hoa-hong";
import { docSnapshotAffiliate } from "./snapshot-referral";

const GOC = { affiliateCode: "CTV_AN", campaignCode: "THU_2026", method: "LINK", typeCode: "CTV", tagCodes: [], tu: "RULE_LOAI", tuNhan: "Theo loại đối tác", origin: "KHOP" };

describe("[AFP-SNAP-01] hình dạng đúng ⇒ đọc ra đúng mã", () => {
  it("[AFP-SNAP-01] lấy affiliateCode · campaignCode · tu · tuNhan · typeCode; bỏ phần còn lại", () => {
    expect(docSnapshotAffiliate({ affiliate: GOC, nguon: { x: 1 } })).toEqual({
      affiliateCode: "CTV_AN",
      campaignCode: "THU_2026",
      tu: "RULE_LOAI",
      tuNhan: "Theo loại đối tác",
      typeCode: "CTV",
    });
  });

  it("[AFP-SNAP-01b] tu / tuNhan / typeCode vắng hoặc sai kiểu ⇒ null, KHÔNG làm hỏng cả bản chụp (hai mã là thứ duy nhất bắt buộc)", () => {
    const r = docSnapshotAffiliate({ affiliate: { affiliateCode: "A", campaignCode: "B", tu: 3, tuNhan: "", typeCode: null } });
    expect(r).toEqual({ affiliateCode: "A", campaignCode: "B", tu: null, tuNhan: null, typeCode: null });
  });
});

describe("[AFP-SNAP-02] hình dạng lạ ⇒ null (không đoán campaign)", () => {
  const LA: [string, unknown][] = [
    ["signals null", null],
    ["signals không phải đối tượng", "chuoi"],
    ["signals là mảng", [GOC]],
    ["không có khoá affiliate (attribution cũ / luật khác)", { nguon: {} }],
    ["affiliate là mảng", { affiliate: [GOC] }],
    ["affiliate null", { affiliate: null }],
    ["thiếu campaignCode", { affiliate: { affiliateCode: "A" } }],
    ["thiếu affiliateCode", { affiliate: { campaignCode: "B" } }],
    ["campaignCode rỗng / toàn khoảng trắng", { affiliate: { affiliateCode: "A", campaignCode: "  " } }],
    ["affiliateCode sai kiểu", { affiliate: { affiliateCode: 7, campaignCode: "B" } }],
  ];
  it.each(LA)("%s", (_ten, signals) => {
    expect(docSnapshotAffiliate(signals)).toBeNull();
  });
});

describe("[AFP-GATE-01] cổng chỉ mở khi attribution thật sự là của Affiliate", () => {
  const snap = docSnapshotAffiliate({ affiliate: GOC })!;
  it("[AFP-GATE-01] đủ ba vế ⇒ mở; thiếu BẤT KỲ vế nào ⇒ đóng (đối chứng dương đi cùng ba đối chứng âm)", () => {
    expect(quaCongAffiliate({ referrerKind: "AFFILIATE", referrerAffiliateId: "a1", snapshot: snap })).toBe(true);
    expect(quaCongAffiliate({ referrerKind: "PARENT", referrerAffiliateId: "a1", snapshot: snap })).toBe(false);
    expect(quaCongAffiliate({ referrerKind: null, referrerAffiliateId: "a1", snapshot: snap })).toBe(false);
    expect(quaCongAffiliate({ referrerKind: "AFFILIATE", referrerAffiliateId: null, snapshot: snap })).toBe(false);
    expect(quaCongAffiliate({ referrerKind: "AFFILIATE", referrerAffiliateId: "a1", snapshot: null })).toBe(false);
  });
});
