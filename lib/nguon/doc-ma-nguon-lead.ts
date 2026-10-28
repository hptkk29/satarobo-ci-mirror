/**
 * lib/nguon/doc-ma-nguon-lead.ts — MÃ NGUỒN HIỆN HÀNH của một tập lead (id lead → mã nhóm), cho nơi chỉ cần DẪN NGƯỜI DÙNG tới trang chi tiết nguồn (hàng chờ sổ → «Mở nguồn»).
 *
 * Vì sao ở đây: đọc thẳng bảng quy nguồn chỉ được phép trong `lib/nguon/**` (`[QN-W11]`). Hàm CHỈ ĐỌC và chỉ trả mã nhóm (danh mục chung, không PII, không người giới thiệu). Nơi gọi chịu trách nhiệm
 * đưa vào những lead đã qua cổng tầm nhìn của người xem (hàng chờ sổ đã lọc theo cơ sở trước khi tra).
 */
import type { Prisma, PrismaClient } from "@prisma/client";

type Khach = PrismaClient | Prisma.TransactionClient;

export async function docMaNguonCuaLead(client: Khach, leadIds: readonly string[]): Promise<Map<string, string>> {
  const ra = new Map<string, string>();
  if (leadIds.length === 0) return ra;
  const dong = await client.leadAttribution.findMany({ where: { leadId: { in: [...new Set(leadIds)] } }, select: { leadId: true, group: { select: { code: true } } } });
  for (const d of dong) ra.set(d.leadId, d.group.code);
  return ra;
}
