import "server-only";

import type { InboxChannel } from "@prisma/client";
import { khoaTinDaCo } from "@/lib/inbox/tin-da-co";

/**
 * Trong một lô `channelMessageId`, những khoá nào ĐÃ có dòng `InboxMessage`.
 *
 * Chỉ dùng cho cron đối soát: nó quét lại 30 phút mỗi 5 phút, nên ~5/6 số tin mỗi lượt
 * là tin đã nạp. Trước bản này, mỗi tin trùng đi thẳng vào `create` rồi ăn P2002 —
 * đúng về dữ liệu nhưng mỗi lượt để lại hàng loạt `prisma:error` + dòng ERROR trên
 * Postgres, che mất lỗi thật. Tra một lượt theo lô rồi bỏ qua là hết tiếng ồn.
 *
 * KHÔNG thay khoá UNIQUE: webhook và cron vẫn có thể đua nhau giữa lúc tra và lúc ghi,
 * nhánh bắt P2002 trong `lib/inbox/ingest.ts` vẫn là lưới cuối.
 *
 * Truy vấn thật nằm ở `lib/inbox/tin-da-co.ts` (luật cổng truy cập hộp thư).
 */
export async function traTinDaCo(channel: InboxChannel, khoa: string[]): Promise<Set<string>> {
  return khoaTinDaCo(channel, khoa);
}
