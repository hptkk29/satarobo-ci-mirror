// F-20 — cầu nối giữa Cấu hình vận hành và hàm thuần tính hạn duyệt.
//
// TÁCH RIÊNG khỏi `media-review-deadline.ts` để file kia ở lại THUẦN: nó không kéo
// theo `@/lib/settings/service` → `@/lib/db`, nên test chạy được mà không cần DB.
//
// Hai key này `centerOverridable: true` ⇒ luôn truyền `orgUnitId` của cơ sở dạy khi
// có. Bỏ trống thì rơi về GLOBAL → default (10h sáng hôm sau), không phải lỗi.
import { getSetting } from "@/lib/settings/service";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import {
  computeReviewDeadline,
  type ReviewDeadlineConfig,
} from "./media-review-deadline";
import type { FolderWithDeadline, MediaFolder } from "./media-review-overdue";

/** Đọc cấu hình hạn duyệt hiện hành (Center → Global → default). */
export async function loadReviewDeadlineConfig(
  orgUnitId?: string | null,
): Promise<ReviewDeadlineConfig> {
  const [hour, offsetDays] = await Promise.all([
    getSetting("media.reviewDeadlineHour", { orgUnitId }),
    getSetting("media.reviewDeadlineOffsetDays", { orgUnitId }),
  ]);
  return { hour, offsetDays };
}

/**
 * Hạn duyệt cho một buổi dạy theo cấu hình HIỆN HÀNH.
 *
 * ⚠️ Chỉ gọi lúc SINH RA folder duyệt rồi lưu kết quả lại (F-20-2 — đóng băng).
 * Đừng gọi mỗi lần hiển thị: làm vậy là hạn của quá khứ chạy theo cấu hình hôm nay
 * và báo cáo SLA đổi số ngược thời gian.
 */
export async function resolveReviewDeadlineFor(
  sessionAt: Date,
  orgUnitId?: string | null,
): Promise<Date> {
  return computeReviewDeadline(sessionAt, await loadReviewDeadlineConfig(orgUnitId));
}

/** Phần lớp cần biết để tra ra cấu hình hạn của cơ sở dạy. */
export interface DeadlineClassInfo {
  id: string;
  centerId: string | null;
  orgUnitId: string | null;
}

/**
 * F-21 — gắn hạn duyệt cho từng folder ảnh, theo cấu hình của CƠ SỞ dạy.
 *
 * Đọc cấu hình ĐÚNG MỘT LẦN cho mỗi cơ sở rồi dùng lại: `getSetting` có cache, nhưng
 * 2 key × N folder vẫn là hàng trăm lượt vô ích trong một lượt quét.
 *
 * Lớp không tra ra, hoặc cấu hình hỏng khiến `computeReviewDeadline` ném → BỎ folder
 * đó (và để lại vết trong log), chứ không đoán bừa một cái hạn: hạn chính là mốc
 * người ta bị ghi "phê duyệt trễ".
 */
export async function attachDeadlines(
  folders: readonly MediaFolder[],
  classById: ReadonlyMap<string, DeadlineClassInfo>,
): Promise<FolderWithDeadline[]> {
  const cfgTheoOrg = new Map<string, ReviewDeadlineConfig>();
  const orgTheoCenter = new Map<string, string | null>();
  const out: FolderWithDeadline[] = [];

  for (const f of folders) {
    const cls = classById.get(f.classId);
    if (!cls) continue;

    let orgUnitId = cls.orgUnitId;
    if (!orgUnitId && cls.centerId) {
      // Ghi kép `centerId → orgUnitId` chỉ có từ P1 · US-07; lớp cũ hơn còn null.
      if (!orgTheoCenter.has(cls.centerId)) {
        orgTheoCenter.set(cls.centerId, await orgUnitIdForCenter(cls.centerId));
      }
      orgUnitId = orgTheoCenter.get(cls.centerId) ?? null;
    }

    const cacheKey = orgUnitId ?? "";
    let cfg = cfgTheoOrg.get(cacheKey);
    if (!cfg) {
      cfg = await loadReviewDeadlineConfig(orgUnitId);
      cfgTheoOrg.set(cacheKey, cfg);
    }

    try {
      out.push({ ...f, deadlineAt: computeReviewDeadline(f.folderAt, cfg) });
    } catch (err) {
      console.warn(`[F-21] không tính được hạn duyệt cho folder ${f.key}:`, err);
    }
  }
  return out;
}
