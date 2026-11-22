// lib/crm/marketing-alerts.ts — R1-09 C9.5 + R1-12 C12.3: alert chốt chi phí / báo cáo trễ.
// Cron chạy hằng ngày; sau ngày 05 mà kỳ tháng trước chưa CONFIRMED / chưa có báo cáo
// → StaffNotification cho SUPER_ADMIN (dedupeKey chống spam).
import { db } from "@/lib/db";
import { notifyStaff } from "@/lib/notifications/notify";
import { previousMonthKey, isMonthlyDeadlinePassed } from "@/lib/crm/marketing-report";

/** userId của SUPER_ADMIN đang hiệu lực (qua UserOrgRole). */
export async function getSuperAdminUserIds(now = new Date()): Promise<string[]> {
  const rows = await db.userOrgRole.findMany({
    where: {
      status: "ACTIVE",
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      role: { code: "SUPER_ADMIN" },
    },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

// Một lời gọi cho CẢ danh sách SUPER_ADMIN — fan-out realtime gộp thành một lô. Không
// `reopen`: cron chạy mỗi ngày, kéo lại chưa-đọc là dội chuông sáng nào cũng có cho tới
// khi ai đó chốt sổ.
const notifyAll = (userIds: string[], dedupeKey: string, title: string, body: string): Promise<number> =>
  notifyStaff({
    userIds,
    dedupeKey,
    category: "MARKETING_ALERT",
    title,
    body,
    href: "/marketing/funnel",
  });

/**
 * C9.5 — sau ngày 05, kỳ chi phí tháng trước chưa CONFIRMED → alert.
 * C12.3 — sau ngày 05, chưa có báo cáo tháng tháng trước → alert.
 */
export async function runMarketingAlerts(now = new Date()): Promise<{ alerts: number }> {
  if (!isMonthlyDeadlinePassed(now)) return { alerts: 0 };
  const period = previousMonthKey(now);
  const admins = await getSuperAdminUserIds(now);
  if (admins.length === 0) return { alerts: 0 };

  let alerts = 0;

  const cost = await db.marketingCostPeriod.findUnique({ where: { period } });
  if (!cost || cost.status !== "CONFIRMED") {
    alerts += await notifyAll(
      admins,
      `cost-unconfirmed:${period}`,
      `Chi phí marketing kỳ ${period} chưa CONFIRMED`,
      `Đã quá ngày 05 — kỳ ${period} chưa được chốt chi phí.`,
    );
  }

  const reportCount = await db.marketingReport.count({ where: { periodType: "MONTH", periodKey: period } });
  if (reportCount === 0) {
    alerts += await notifyAll(
      admins,
      `report-missing:${period}`,
      `Thiếu báo cáo marketing tháng ${period}`,
      `Đã quá ngày 05 — chưa có báo cáo tháng ${period}.`,
    );
  }

  return { alerts };
}
