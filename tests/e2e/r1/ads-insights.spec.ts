/**
 * R1-07 — upsertAdsInsight unique (date,channel) + nhập tay đè (C7.1/C7.2). PG LOCAL.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { assertTestDb } from "../../e2e/_helpers/seed";
import { upsertAdsInsight, parseMetaInsights } from "../../../lib/crm/ads-insights";

test.describe("[R1-07] Ads Insights", () => {
  test.beforeEach(async () => {
    assertTestDb();
    await db.adsInsightDaily.deleteMany({});
  });

  test("[R1-07-C7.1] sync ghi AdsInsightDaily unique (date,channel)", async () => {
    const json = { data: [{ date_start: "2026-06-01", spend: 100, impressions: 1000, clicks: 50 }] };
    for (const r of parseMetaInsights(json)) await upsertAdsInsight({ ...r, source: "META_API" });
    // chạy lại cùng ngày/kênh → update, không tạo trùng
    for (const r of parseMetaInsights(json)) await upsertAdsInsight({ ...r, source: "META_API" });
    expect(await db.adsInsightDaily.count()).toBe(1);
    const row = await db.adsInsightDaily.findFirst({ where: { channel: "facebook" } });
    expect(row?.spend).toBe(100);
  });

  test("[R1-07-C7.2] nhập tay đè kênh chưa có API", async () => {
    const date = new Date("2026-06-01");
    await upsertAdsInsight({ date, channel: "google", spend: 50, impressions: 500, clicks: 20, source: "META_API" });
    await upsertAdsInsight({ date, channel: "google", spend: 80, impressions: 500, clicks: 20, source: "MANUAL" });
    const row = await db.adsInsightDaily.findFirst({ where: { channel: "google" } });
    expect(row?.spend).toBe(80);
    expect(row?.source).toBe("MANUAL");
    expect(await db.adsInsightDaily.count({ where: { channel: "google" } })).toBe(1);
  });
});
