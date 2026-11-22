// R1-07 — parseMetaInsights + canEditAds (THUẦN). Pure.
import { describe, it, expect } from "vitest";
import { parseMetaInsights, canEditAds } from "@/lib/crm/ads-insights";

describe("[R1-07] parseMetaInsights (C7.1)", () => {
  it("parse response Meta → records theo ngày", () => {
    const json = {
      data: [
        { date_start: "2026-06-01", spend: "100.5", impressions: "1000", clicks: "50" },
        { date_start: "2026-06-02", spend: 200, impressions: 2000, clicks: 80 },
      ],
    };
    const recs = parseMetaInsights(json);
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({ channel: "facebook", spend: 100.5, impressions: 1000, clicks: 50 });
    expect(recs[0]?.date.toISOString().slice(0, 10)).toBe("2026-06-01");
  });

  it("payload không hợp lệ → rỗng", () => {
    expect(parseMetaInsights(null)).toEqual([]);
    expect(parseMetaInsights({})).toEqual([]);
    expect(parseMetaInsights({ data: [{ spend: 1 }] })).toEqual([]); // thiếu date_start
  });
});

describe("[R1-07-C7.3] canEditAds", () => {
  it("HO_MARKETING / SUPER_ADMIN → true; khác → false", () => {
    expect(canEditAds({ isSuperAdmin: true, orgRoles: [] })).toBe(true);
    expect(canEditAds({ isSuperAdmin: false, orgRoles: [{ roleCode: "HO_MARKETING" }] })).toBe(true);
    expect(canEditAds({ isSuperAdmin: false, orgRoles: [{ roleCode: "CENTER_MANAGER" }] })).toBe(false);
    expect(canEditAds({ isSuperAdmin: false, orgRoles: [] })).toBe(false);
  });
});
