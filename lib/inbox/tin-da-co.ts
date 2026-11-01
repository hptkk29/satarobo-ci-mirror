import "server-only";

import type { InboxChannel } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Trong một lô `channelMessageId`, khoá nào ĐÃ có dòng `InboxMessage`.
 *
 * Nằm ở `lib/inbox/` vì luật cổng truy cập (`lib/inbox/cong-truy-cap.test.ts`): chỉ thư mục này
 * được chạm thẳng bảng `Inbox*`. Không gộp `inboxOrgScopeWhere` là CỐ Ý: hàm không trả nội dung
 * tin, chỉ trả lại đúng các khoá người gọi đưa vào (đã biết) để bỏ qua bản trùng — và khoá
 * `[channel, channelMessageId]` là UNIQUE toàn hệ thống, không theo cơ sở. Người gọi duy nhất
 * là cron đối soát ZaloCRM (tiến trình hệ thống, không có actor).
 */
export async function khoaTinDaCo(channel: InboxChannel, khoa: string[]): Promise<Set<string>> {
  if (khoa.length === 0) return new Set();
  const dong = await db.inboxMessage.findMany({
    where: { channel, channelMessageId: { in: khoa } },
    select: { channelMessageId: true },
  });
  return new Set(dong.map((d) => d.channelMessageId).filter((k): k is string => k !== null));
}
