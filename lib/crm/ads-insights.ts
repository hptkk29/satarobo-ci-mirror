// lib/crm/ads-insights.ts — R1-07: đồng bộ Ads Insights (Meta) theo ngày/kênh (SR.QD.217).
// parseMetaInsights + canEditAds THUẦN; upsertAdsInsight (unique date,channel); syncMetaAds (live).
import type { AdsInsightDaily } from "@prisma/client";
import { db } from "@/lib/db";

export class AdsError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AdsError";
    this.code = code;
  }
}

export type AdsInsightRecord = {
  date: Date;
  channel: string;
  spend: number;
  impressions: number;
  clicks: number;
};

/** Parse response Meta Insights → records (THUẦN, C7.1). */
export function parseMetaInsights(json: unknown, channel = "facebook"): AdsInsightRecord[] {
  if (!json || typeof json !== "object") return [];
  const data = (json as { data?: unknown[] }).data;
  if (!Array.isArray(data)) return [];
  const out: AdsInsightRecord[] = [];
  for (const rowRaw of data) {
    const row = rowRaw as { date_start?: string; spend?: string | number; impressions?: string | number; clicks?: string | number };
    if (!row.date_start) continue;
    out.push({
      date: new Date(row.date_start),
      channel,
      spend: Number(row.spend ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
    });
  }
  return out;
}

/** C7.3 — chỉ HO_MARKETING / SUPER_ADMIN được sửa số liệu ads. THUẦN. */
export function canEditAds(actor: {
  isSuperAdmin: boolean;
  orgRoles: { roleCode: string }[];
}): boolean {
  return actor.isSuperAdmin || actor.orgRoles.some((r) => r.roleCode === "HO_MARKETING");
}

/** Upsert 1 bản ghi insight (C7.1 sync / C7.2 nhập tay đè). unique (date,channel). */
export async function upsertAdsInsight(
  record: AdsInsightRecord & { source?: string },
): Promise<AdsInsightDaily> {
  return db.adsInsightDaily.upsert({
    where: { date_channel: { date: record.date, channel: record.channel } },
    update: {
      spend: record.spend,
      impressions: record.impressions,
      clicks: record.clicks,
      source: record.source ?? "META_API",
    },
    create: {
      date: record.date,
      channel: record.channel,
      spend: record.spend,
      impressions: record.impressions,
      clicks: record.clicks,
      source: record.source ?? "META_API",
    },
  });
}

/**
 * Đồng bộ Ads Insights từ Meta Graph API (live). Cần META_PAGE_ACCESS_TOKEN +
 * META_AD_ACCOUNT_ID. KHÔNG gọi trong test (chỉ chạy thật khi có token).
 */
export async function syncMetaAds(opts: {
  since: string; // YYYY-MM-DD
  until: string;
  accessToken?: string;
  adAccountId?: string;
}): Promise<{ synced: number }> {
  const token = opts.accessToken ?? process.env.META_PAGE_ACCESS_TOKEN;
  const acct = opts.adAccountId ?? process.env.META_AD_ACCOUNT_ID;
  if (!token || !acct) {
    throw new AdsError("META_CREDENTIALS_MISSING", "Thiếu META_PAGE_ACCESS_TOKEN / META_AD_ACCOUNT_ID.");
  }
  const url =
    `https://graph.facebook.com/v21.0/act_${acct}/insights` +
    `?fields=spend,impressions,clicks&time_increment=1` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since: opts.since, until: opts.until }))}` +
    `&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) throw new AdsError("META_API_ERROR", `Meta API lỗi ${res.status}`);
  const json = await res.json();
  const records = parseMetaInsights(json, "facebook");
  for (const r of records) await upsertAdsInsight({ ...r, source: "META_API" });
  return { synced: records.length };
}
