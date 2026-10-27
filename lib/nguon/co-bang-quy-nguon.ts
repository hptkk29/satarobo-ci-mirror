// lib/nguon/co-bang-quy-nguon.ts — bảng quy nguồn (`LeadAttribution`) đã có trong DB này chưa. CHỈ ĐỌC.
//
// Vì sao là tệp riêng ở lib/nguon: lưới `[QN-W11]` chỉ cho SQL thô gọi tên bảng nguồn nằm trong lib/nguon/** và scripts/nguon/**. Precheck cutover (lib/hoa-hong) cần câu hỏi «migration
// quy nguồn đã chạy chưa» mà KHÔNG được tự viết SQL — nó hỏi hàm này. Tệp mới (không sửa tệp nào của hướng khác); cùng câu `to_regclass` mà `di-tru-tinh-trang.ts` dùng.
import type { Prisma, PrismaClient } from "@prisma/client";

export async function coBangQuyNguon(client: PrismaClient | Prisma.TransactionClient): Promise<boolean> {
  const r = await client.$queryRaw<{ co: boolean }[]>`SELECT to_regclass('public."LeadAttribution"') IS NOT NULL AS co`;
  return r[0]?.co === true;
}
