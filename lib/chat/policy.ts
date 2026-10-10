// lib/chat/policy.ts — US-16 AC2: mốc ĐỒNG Ý quy định sử dụng chat của phụ huynh.
//
// NỘI DUNG chính sách + `CHAT_POLICY_VERSION` nằm ở `lib/chat/policy-content.ts` (không
// chạm DB) vì màn chính sách là Client Component — để chung file này là kéo Prisma vào
// bundle client.
//
// ⚠️ KHÔNG `"use server"` (luật E-bis #1): file này export hằng + hàm thường. Cửa cho
// Client Component là `app/(portal)/portal/tin-nhan/actions.ts`.
//
// ⚠️ KHÔNG `import "server-only"` — cùng lý do đã ghi ở `lib/chat/queries.ts`: module phải
// chạy được dưới vitest node + `tsx`. Chốt chặn không lọt xuống client là `@/lib/db`.
//
// ⚠️ ĐỌC BẰNG `db` TRẦN (luật E-bis #5): `ChatPolicyAcceptance` không có `centerId` nên
// không thuộc SCOPED_MODELS; và câu hỏi "người này đã đồng ý chưa" là câu hỏi MỨC HỆ THỐNG
// về chính người đang đăng nhập — cách ly cơ sở ở đây chỉ tạo ra lỗi câm.
import { cache } from "react";
import { db } from "@/lib/db";
import { CHAT_POLICY_VERSION } from "@/lib/chat/policy-content";

/**
 * Người này đã đồng ý bản chính sách ĐANG PHÁT HÀNH chưa.
 *
 * `cache` của React: một request có thể hỏi nhiều lần (layout gác + page tự gác lại —
 * defense-in-depth, xem `app/(portal)/portal/tin-nhan/layout.tsx`) nhưng chỉ đi DB một lần.
 * KHÔNG dùng cache xuyên-request (`safeCache`): đây là trạng thái của MỘT người; vừa bấm
 * đồng ý xong mà còn đọc bản cũ 5 phút thì đúng bằng "bấm mà không vào được".
 */
export const hasAcceptedChatPolicy = cache(async (userId: string): Promise<boolean> => {
  if (!userId) return false;
  const row = await db.chatPolicyAcceptance.findUnique({
    where: { userId_version: { userId, version: CHAT_POLICY_VERSION } },
    select: { userId: true },
  });
  return row !== null;
});

/**
 * Ghi mốc đồng ý. Idempotent: bấm 2 lần / 2 tab đua nhau vẫn ra đúng 1 dòng, và
 * `acceptedAt` giữ nguyên lần ĐẦU (mốc cần lưu là lần đầu, không phải lần bấm gần nhất).
 */
export async function recordChatPolicyAcceptance(userId: string): Promise<void> {
  await db.chatPolicyAcceptance.upsert({
    where: { userId_version: { userId, version: CHAT_POLICY_VERSION } },
    create: { userId, version: CHAT_POLICY_VERSION },
    update: {}, // cố ý rỗng — không dời acceptedAt
  });
}

/**
 * Tập userId đã đồng ý bản hiện hành, trong một danh sách cho trước (dashboard pilot).
 * Trả `Set` để tầng gọi không phải tự dựng lại.
 */
export async function getChatPolicyAcceptedUserIds(
  userIds: readonly string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db.chatPolicyAcceptance.findMany({
    where: { userId: { in: [...userIds] }, version: CHAT_POLICY_VERSION },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}
