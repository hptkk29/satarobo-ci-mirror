// lib/lead/stale-lead-config.ts — C-05: cầu nối giữa Cấu hình vận hành và đồng hồ thuần.
//
// TÁCH RIÊNG khỏi `stale-lead.ts` để file kia ở lại THUẦN: nó không kéo theo
// `@/lib/settings/service` → `@/lib/db`, nên test chạy được không cần DB và component
// client import được hằng/nhãn. Cùng khuôn `lib/lms/media-review-deadline-config.ts`.
//
// Hai key `centerOverridable: true` (quyết định 12(a) 24/08/2026) ⇒ PHẢI truyền
// `orgUnitId` của cơ sở. Bỏ trống thì rơi về GLOBAL → default 2/7, không phải lỗi.
import "server-only";
import { getSetting } from "@/lib/settings/service";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { DEFAULT_STALE_LEAD_THRESHOLDS, type StaleLeadThresholds } from "./stale-lead";

/** Ngưỡng hiện hành cho MỘT đơn vị (Center → Global → default). */
export async function loadStaleLeadThresholds(
  orgUnitId?: string | null,
): Promise<StaleLeadThresholds> {
  const [warnDays, dangerDays] = await Promise.all([
    getSetting("crm.staleLeadWarnDays", { orgUnitId }),
    getSetting("crm.staleLeadDangerDays", { orgUnitId }),
  ]);
  return { warnDays, dangerDays };
}

/**
 * Ngưỡng theo TỪNG cơ sở đang xem + một bộ GLOBAL cho dòng chưa gán cơ sở.
 *
 * Vì sao không lấy một bộ ngưỡng chung cho cả bảng: bộ lọc A-02 cho chọn nhiều cơ sở
 * cùng lúc, mà ngưỡng thì `centerOverridable`. Lấy chung là cùng một phiếu đổi màu tuỳ
 * người xem đang mở một cơ sở hay nhiều cơ sở — kiểu mâu thuẫn không ai giải thích nổi.
 *
 * Đọc cấu hình ĐÚNG MỘT LẦN cho mỗi cơ sở (`getSetting` có cache, nhưng 2 key × N dòng
 * vẫn là hàng trăm lượt vô ích trong một lượt vẽ bảng).
 */
export async function loadStaleLeadThresholdsByCenter(
  centerIds: readonly string[],
): Promise<{
  byCenter: Map<string, StaleLeadThresholds>;
  fallback: StaleLeadThresholds;
}> {
  const byCenter = new Map<string, StaleLeadThresholds>();
  // GLOBAL trước — cũng là thứ dùng cho lead chưa gán cơ sở, và là chỗ rơi về khi một
  // cơ sở chưa có OrgUnit tương ứng (`orgUnitIdForCenter` trả null).
  const fallback = await loadStaleLeadThresholds(null).catch(
    () => DEFAULT_STALE_LEAD_THRESHOLDS,
  );

  for (const centerId of centerIds) {
    try {
      const orgUnitId = await orgUnitIdForCenter(centerId);
      byCenter.set(centerId, orgUnitId ? await loadStaleLeadThresholds(orgUnitId) : fallback);
    } catch {
      // Cấu hình đọc hụt KHÔNG được làm trắng bảng lead rớt: rơi về ngưỡng chung.
      byCenter.set(centerId, fallback);
    }
  }
  return { byCenter, fallback };
}
