// lib/portal/feed-read.ts — "phụ huynh đã đọc mục nào trên bảng tin".
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao có file này (04/09/2026)
//
// Badge chuông portal là HÀM CỦA THỜI GIAN, không phải của việc đọc:
//   · portal v1 — đếm "tin trong 7 ngày qua" (`lib/portal/notifications.ts`);
//   · portal v2 — coi là đã đọc sau 2 ngày TRÔI QUA (`READ_AFTER_MS`).
// Phụ huynh mở tin ra đọc xong con số (1) vẫn nằm nguyên đó.
//
// ⚠️ PROD CHẠY V2 (`PORTAL_V2_ENABLED="true"`, đo bằng `vercel env pull` 04/09).
// Vá riêng v1 là vá vào bản người dùng thật không dùng — đã suýt làm đúng như vậy.
// Nên trạng thái đọc đặt ở tầng CHUNG này, cả hai bản gọi vào.
//
// Khoá là **id MỤC BẢNG TIN**, không phải `Notification.id`: bảng tin v2 tổng hợp 7
// nhóm, phần lớn không phải dòng Notification (nhận xét buổi, học bù, học phí, học bạ,
// khảo sát) và mang id tổng hợp `nt-…` / `mk-need-…`.
// ─────────────────────────────────────────────────────────────────────────────
import { cache } from "react";

import { db } from "@/lib/db";

/** Tập id mục mà phụ huynh này đã đọc. Cache theo request. */
export const idsDaDoc = cache(async (parentUserId: string): Promise<Set<string>> => {
  const rows = await db.portalFeedRead.findMany({
    where: { userId: parentUserId },
    select: { itemId: true },
  });
  return new Set(rows.map((r) => r.itemId));
});

/**
 * Đánh dấu đã đọc. Trả số dòng MỚI thêm — nơi gọi dùng nó để biết có cần làm mới
 * badge không; lần mở thứ hai trả 0 nên không đẻ vòng làm mới vô tận.
 *
 * `skipDuplicates` chứ không upsert: `readAt` là lần ĐẦU tiên đọc, mở lại không được
 * dời mốc đó đi.
 */
export async function danhDauDaDoc(
  parentUserId: string,
  itemIds: string[],
): Promise<number> {
  if (itemIds.length === 0) return 0;
  const res = await db.portalFeedRead.createMany({
    data: itemIds.map((itemId) => ({ itemId, userId: parentUserId })),
    skipDuplicates: true,
  });
  return res.count;
}
