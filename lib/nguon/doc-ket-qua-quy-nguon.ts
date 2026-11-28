// lib/nguon/doc-ket-qua-quy-nguon.ts — ĐỌC luật quy nguồn đã THẮNG của một lead, cho module Affiliate (AFF-P1).
//
// `LeadAttribution` chỉ được đọc/ghi thẳng trong `lib/nguon/**` (ngoại lệ luật Nền #3, lưới `[QN-W11]`). Affiliate cần biết «luật `AFFILIATE_REFERRAL` có thật sự thắng cho lead này không»
// để chốt trạng thái dòng referral (hợp lệ / giữ người ghi nhận đầu / xem tay) — đi qua hàm này, không tự `leadAttribution.findUnique`.
// Chỉ trả hai trường, không lộ lead/khách. Gọi TRONG cùng transaction với lúc quy nguồn nên thấy đúng dòng vừa ghi.
import type { Prisma, PrismaClient } from "@prisma/client";

type Khach = PrismaClient | Prisma.TransactionClient;

export type KetQuaQuyNguonCuaLead = { matchedRule: string; referrerAffiliateId: string | null };

/** null ⇒ lead chưa có dòng quy nguồn (cờ `nguon.enabled` tắt, hoặc ghi chưa xong). */
export async function docKetQuaQuyNguonCuaLead(client: Khach, leadId: string): Promise<KetQuaQuyNguonCuaLead | null> {
  const a = await client.leadAttribution.findUnique({
    where: { leadId },
    select: { matchedRule: true, referrerAffiliateId: true },
  });
  return a ? { matchedRule: a.matchedRule, referrerAffiliateId: a.referrerAffiliateId } : null;
}
