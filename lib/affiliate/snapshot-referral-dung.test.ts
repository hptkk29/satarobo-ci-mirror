// @vitest-environment node
/**
 * [SNW-*] — MỘT nơi DỰNG bản chụp `signals.affiliate` / `sourceSnapshot` cho cả đường tự động lẫn đường duyệt tay (AFF-L3b). THUẦN.
 *
 * Vì sao cần: nếu hai đường dựng bản chụp bằng hai đoạn mã, có ngày một khoá lệch tên — và `docAffiliateChoHoaHong` (cổng của engine) trả `null` IM LẶNG, hoa hồng của đối tác biến mất mà không
 * lỗi nào báo. Nên mọi bản chụp đều đi qua `dungSnapshotReferral`, và ca dưới đây ghim: (a) hình dạng, (b) engine đọc lại được, (c) đường tự động THẬT SỰ gọi hàm này.
 *   [SNW-01] hình dạng đã chốt
 *   [SNW-02] tu = null ⇒ không tu/tuNhan; có căn cứ tự giới thiệu ⇒ ghi
 *   [SNW-03] engine đọc lại được (docSnapshotAffiliate + quaCongAffiliate)
 *   [SNW-04] không khoá lạ (không PII lọt vào)
 *   [SNW-05] LƯỚI DÂY NỐI: `nhan-referral.ts` (đường tự động) dựng bản chụp bằng hàm này, đúng MỘT lần, không còn tự ghép `tuNhan:`
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { quaCongAffiliate } from "./campaign-cho-hoa-hong";
import { docSnapshotAffiliate, dungSnapshotReferral } from "./snapshot-referral";

const V = { affiliateCode: "CTV_AN", campaignCode: "THU_2026", method: "MANUAL", typeCode: "CTV", tagCodes: ["B", "A"], tu: "MAC_DINH_CAMPAIGN" as const, origin: "VANG" as const, canCuTuGioiThieu: [] };

describe("[SNW] dungSnapshotReferral", () => {
  it("[SNW-01] khoá đúng hình dạng: mã nhãn sắp, tu+tuNhan khi có bậc, origin; KHÔNG có canCu khi rỗng", () => {
    expect(dungSnapshotReferral(V)).toEqual({
      affiliateCode: "CTV_AN",
      campaignCode: "THU_2026",
      method: "MANUAL",
      typeCode: "CTV",
      tagCodes: ["A", "B"],
      tu: "MAC_DINH_CAMPAIGN",
      tuNhan: "Nguồn mặc định của campaign",
      origin: "VANG",
    });
  });

  it("[SNW-02] tu = null ⇒ không ghi tu/tuNhan; có căn cứ tự giới thiệu ⇒ ghi", () => {
    const r = dungSnapshotReferral({ ...V, tu: null, canCuTuGioiThieu: ["SDT"] });
    expect(r).not.toHaveProperty("tu");
    expect(r).not.toHaveProperty("tuNhan");
    expect(r.canCuTuGioiThieu).toEqual(["SDT"]);
  });

  it("[SNW-03] engine đọc lại được: ra đúng hai mã + bậc, và qua cổng khi người giới thiệu là đối tác", () => {
    const sn = docSnapshotAffiliate({ affiliate: dungSnapshotReferral(V) });
    expect(sn).toEqual({ affiliateCode: "CTV_AN", campaignCode: "THU_2026", tu: "MAC_DINH_CAMPAIGN", tuNhan: "Nguồn mặc định của campaign", typeCode: "CTV" });
    expect(quaCongAffiliate({ referrerKind: "AFFILIATE", referrerAffiliateId: "p1", snapshot: sn })).toBe(true);
  });

  it("[SNW-04] chỉ đúng chín khoá có tên — không có chỗ cho SĐT/email/tên lọt vào", () => {
    const khoa = Object.keys(dungSnapshotReferral({ ...V, canCuTuGioiThieu: ["EMAIL"] })).sort();
    expect(khoa).toEqual(["affiliateCode", "campaignCode", "canCuTuGioiThieu", "method", "origin", "tagCodes", "tu", "tuNhan", "typeCode"]);
  });

  it("[SNW-05] đường tự động dựng bản chụp BẰNG hàm này (một lần) và không tự ghép `tuNhan:` (chữ do hàm dựng sinh)", () => {
    const nguon = readFileSync(resolve(process.cwd(), "lib/affiliate/nhan-referral.ts"), "utf8")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(nguon.match(/dungSnapshotReferral\(/g)?.length).toBe(1);
    expect(nguon).not.toMatch(/tuNhan\s*:/);
  });
});
