// lib/media-review/settings.ts — đọc cấu hình vận hành của cổng duyệt media.
import "server-only";
import { db } from "@/lib/db";
import {
  MEDIA_REVIEW_DEADLINE_HOUR_DEFAULT,
  MEDIA_REVIEW_DEADLINE_KEY,
} from "./deadline";

/**
 * Giờ chốt (0–23, giờ VN). Cấu hình sai kiểu / thiếu dòng → về mặc định 10h.
 *
 * KHÔNG ném khi cấu hình hỏng: hạn chốt chỉ để đánh dấu trễ, hỏng cấu hình mà làm sập
 * cả màn duyệt là đổi một phiền toái nhỏ thành một sự cố.
 */
export async function getReviewDeadlineHour(): Promise<number> {
  const row = await db.systemSetting.findUnique({
    where: { key: MEDIA_REVIEW_DEADLINE_KEY },
    select: { valueJson: true },
  });
  const v = row?.valueJson;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || n > 23) return MEDIA_REVIEW_DEADLINE_HOUR_DEFAULT;
  return Math.trunc(n);
}
