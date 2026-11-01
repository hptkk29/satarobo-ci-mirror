// lib/nguon/doc-nguoi-gioi-thieu-affiliate.ts — ĐỌC `LeadAttribution` theo đối tác giới thiệu, cho module Affiliate.
//
// `LeadAttribution` KHÔNG mang `centerId`/`orgUnitId` (ngoại lệ luật Nền #3, chủ dự án chấp nhận 07/10/2026) nên CHỈ được đọc/ghi thẳng trong `lib/nguon/**`
// (lưới `[QN-W11]`). Module Affiliate cần biết «đối tác nào đã được ghi làm người giới thiệu» để khoá mã `?ref=` — đi qua hàm này, không tự `leadAttribution.findMany`.
// KHÔNG scope, chỉ trả TẬP id (không lộ lead/khách).
import type { Prisma, PrismaClient } from "@prisma/client";

type Khach = PrismaClient | Prisma.TransactionClient;

/** Trong `ids`, đối tác nào ĐÃ được ghi làm người giới thiệu ở ít nhất một attribution. */
export async function timDoiTacDaLamNguoiGioiThieu(client: Khach, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const gan = await client.leadAttribution.findMany({
    where: { referrerAffiliateId: { in: [...ids] } },
    select: { referrerAffiliateId: true },
    distinct: ["referrerAffiliateId"],
  });
  const ra = new Set<string>();
  for (const g of gan) if (g.referrerAffiliateId) ra.add(g.referrerAffiliateId);
  return ra;
}
