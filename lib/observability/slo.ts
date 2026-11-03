// lib/observability/slo.ts — R6-G3: metric SLO + alert (event pending, webhook fail,
// email queue, cron lag). evaluateSlo() THUẦN (ngưỡng→alert, T1); dedupe để không spam (T6).
// AUTH-SĐT P4 — thêm 4 metric OTP/Zalo (trước đây 0 cái cho kênh xác thực).
import { db } from "@/lib/db";

export type SloMetricKey =
  | "eventPending"
  | "webhookFail"
  | "emailQueueBacklog"
  | "cronLagMinutes"
  | "otpSentToday"
  | "otpDeliveryFailToday"
  | "znsUserErrorToday"
  | "otpCostTodayVnd"
  | "znsNotifyFailedToday";

export type SloThreshold = { key: SloMetricKey; label: string; max: number };

/** Ngưỡng cảnh báo mỗi metric (vượt → alert). */
export const SLO_THRESHOLDS: SloThreshold[] = [
  { key: "eventPending", label: "DomainEvent PENDING tồn", max: 50 },
  { key: "webhookFail", label: "Event FAILED (webhook/handler)", max: 10 },
  { key: "emailQueueBacklog", label: "Email queue chờ gửi", max: 100 },
  { key: "cronLagMinutes", label: "Cron trễ (phút)", max: 30 },
  // AUTH-SĐT P4 — ngưỡng khớp mặc định SystemSetting otp.globalDailyCap (300)
  // + ngân sách QĐ-E (~90.000đ/ngày, 300đ/tin ZNS). Alert nổ TRƯỚC kill-switch
  // (500) để người trực còn thời gian phản ứng.
  { key: "otpSentToday", label: "Tin OTP đã gửi hôm nay", max: 300 },
  { key: "otpDeliveryFailToday", label: "OTP gửi hỏng hôm nay", max: 20 },
  { key: "znsUserErrorToday", label: "ZNS lỗi người nhận (-118/-139/-141) hôm nay", max: 30 },
  { key: "otpCostTodayVnd", label: "Chi phí ZNS hôm nay (đ, ước)", max: 90_000 },
  // ZNS THÔNG BÁO (ZaloMessageLog — cấp TK/học phí/điểm danh/công nợ) trước đây
  // ngoài vùng đo hoàn toàn: mọi caller `.catch(()=>{})` nên FAILED chất đống im
  // lặng (vd đặt env template chưa duyệt → 100% hỏng mà không ai biết).
  { key: "znsNotifyFailedToday", label: "ZNS thông báo FAILED hôm nay", max: 10 },
];

export type SloAlert = { key: SloMetricKey; label: string; value: number; threshold: number };

/** THUẦN — metric nào vượt ngưỡng → alert (T1). */
export function evaluateSlo(
  metrics: Partial<Record<SloMetricKey, number>>,
  thresholds: SloThreshold[] = SLO_THRESHOLDS,
): SloAlert[] {
  const out: SloAlert[] = [];
  for (const t of thresholds) {
    const value = metrics[t.key] ?? 0;
    if (value > t.max) out.push({ key: t.key, label: t.label, value, threshold: t.max });
  }
  return out;
}

/**
 * THUẦN — bỏ alert đã bắn gần đây (dedupe, T6). `firedKeys` = key đã alert trong cửa sổ.
 * Trả về alert MỚI cần gửi.
 */
export function dedupeAlerts(alerts: SloAlert[], firedKeys: Iterable<string>): SloAlert[] {
  const fired = new Set(firedKeys);
  return alerts.filter((a) => !fired.has(a.key));
}

/** Đơn giá 1 tin ZNS Xác thực (QĐ-E) — dùng ước tính chi phí, không phải hoá đơn. */
const ZNS_COST_VND = 300;

/** Thu thập metric từ DB (now để tính cron lag + mốc "hôm nay"). */
export async function collectSloMetrics(now: Date = new Date()): Promise<Record<SloMetricKey, number>> {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const [
    eventPending,
    webhookFail,
    emailQueueBacklog,
    lastDone,
    otpSentToday,
    otpDeliveryFailToday,
    znsSentToday,
    znsUserErrorToday,
    znsNotifyFailedToday,
  ] = await Promise.all([
    db.domainEvent.count({ where: { status: "PENDING" } }),
    db.domainEvent.count({ where: { status: "FAILED" } }),
    db.emailQueue.count({ where: { status: "PENDING" } }),
    db.domainEvent.findFirst({ where: { status: "DONE" }, orderBy: { processedAt: "desc" }, select: { processedAt: true } }),
    // AUTH-SĐT P6 — LOẠI kênh OFFLINE: mã cấp tại quầy không đi qua nhà mạng nào,
    // đếm vào đây là thổi phồng "tin đã gửi" so với ngưỡng 300 và làm cảnh báo kêu
    // oan đúng lúc ZNS đang hỏng (chính là lúc kênh OFFLINE được dùng nhiều nhất).
    db.otpDeliveryLog.count({
      where: {
        status: "SENT",
        channel: { not: "OFFLINE" },
        createdAt: { gte: startOfToday },
      },
    }),
    db.otpDeliveryLog.count({ where: { status: "FAILED", createdAt: { gte: startOfToday } } }),
    db.otpDeliveryLog.count({
      where: { status: "SENT", channel: "ZALO", createdAt: { gte: startOfToday } },
    }),
    // Lỗi NGƯỜI NHẬN (không phải lỗi hệ thống) — key ổn định từ lib/zalo/otp-provider.ts.
    db.otpDeliveryLog.count({
      where: {
        status: "FAILED",
        channel: "ZALO",
        createdAt: { gte: startOfToday },
        OR: [
          { error: { startsWith: "ZNS_NO_ZALO_ACCOUNT" } },
          { error: { startsWith: "ZNS_USER_REFUSED" } },
          { error: { startsWith: "ZNS_USER_UNREACHABLE" } },
        ],
      },
    }),
    db.zaloMessageLog.count({ where: { status: "FAILED", createdAt: { gte: startOfToday } } }),
  ]);
  // Cron lag = phút kể từ event DONE gần nhất (proxy "dispatcher còn chạy"). Không có → 0.
  const lastProcessed = lastDone?.processedAt ?? null;
  const cronLagMinutes = lastProcessed ? Math.floor((now.getTime() - lastProcessed.getTime()) / 60000) : 0;
  return {
    eventPending,
    webhookFail,
    emailQueueBacklog,
    cronLagMinutes,
    otpSentToday,
    otpDeliveryFailToday,
    znsUserErrorToday,
    // Chỉ tin ZNS gửi THÀNH CÔNG mới tính tiền (ZBS 31/07: tin fail không trừ phí).
    otpCostTodayVnd: znsSentToday * ZNS_COST_VND,
    znsNotifyFailedToday,
  };
}

/** Tiện ích: thu thập + đánh giá (chưa dedupe — caller lo persistence dedupe). */
export async function checkSlo(now?: Date): Promise<SloAlert[]> {
  return evaluateSlo(await collectSloMetrics(now));
}
