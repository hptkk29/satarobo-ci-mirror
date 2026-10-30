import type { Prisma } from "@prisma/client";

/**
 * Dời danh tính hộp thư (`InboxIdentity.leadId`) từ lead phụ sang lead chính.
 *
 * CHỈ dùng cho `lib/lead/gop-lead.ts` (gộp hai lead cùng một gia đình). Nằm ở `lib/inbox/`
 * vì luật `cong-truy-cap.test.ts`: chỉ thư mục này được chạm thẳng bảng `Inbox*`.
 * Không gộp `inboxOrgScopeWhere` — đây không phải đường ĐỌC phục vụ người dùng, mà là một
 * phép dời khoá ngoại trong giao dịch gộp; hai lead đã được kiểm cùng số điện thoại.
 */
export async function doiLeadChoDanhTinh(
  tx: Prisma.TransactionClient,
  phuId: string,
  chinhId: string,
): Promise<number> {
  const r = await tx.inboxIdentity.updateMany({
    where: { leadId: phuId },
    data: { leadId: chinhId },
  });
  return r.count;
}
