/**
 * «Giữ chỗ» lượt bấm `clk` — phép DUY NHẤT quyết một `clk` đã bị biểu mẫu khác dùng hay chưa (R9 · N1-3, docs/source-commission/12 §11.12).
 *
 * INSERT vào `AffiliateClickClaim` (PK = clickId) là nguyên tử: N yêu cầu song song cùng `clk` ⇒ đúng MỘT cái thắng, các cái còn lại gặp lỗi trùng khoá. Đây là chỗ DUY NHẤT chặn được đua —
 * một câu «đã có referral dùng chưa» (đọc rồi ghi sau khi tạo lead) không chặn được, và hạ referral xuống xem tay SAU khi lead đã mang attribution Affiliate thì quá muộn.
 *
 * Gửi lại CHÍNH biểu mẫu đó (cùng `idempotencyKey`) vẫn là người giữ chỗ ⇒ `true`.
 * Lỗi KHÁC lỗi trùng khoá (DB đứt…) KHÔNG nuốt: ném lên để lượt này không đi tiếp với một `clk` chưa được giữ.
 */
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * NHẢ chỗ giữ của CHÍNH khoá này — khi lượt tạo lead THẤT BẠI hoặc không ghi dòng referral nào (nếu không, lần gửi lại với eventId mới gặp `DA_DUNG` và mất ghi công tự động).
 * Chỉ xoá khi (clickId, idempotencyKey) KHỚP ⇒ không bao giờ nhả chỗ của biểu mẫu khác. KHÔNG gọi khi dòng referral đã được ghi.
 */
export async function nhaChoClick(clickId: string, idempotencyKey: string): Promise<void> {
  await db.affiliateClickClaim.deleteMany({ where: { clickId, idempotencyKey } });
}

export async function giuChoClick(clickId: string, idempotencyKey: string): Promise<boolean> {
  try {
    await db.affiliateClickClaim.create({ data: { clickId, idempotencyKey } });
    return true;
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
    const dangGiu = await db.affiliateClickClaim.findUnique({ where: { clickId }, select: { idempotencyKey: true } });
    return dangGiu?.idempotencyKey === idempotencyKey;
  }
}
