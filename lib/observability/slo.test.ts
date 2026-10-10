// R6-G3 — SLO metrics: threshold→alert + dedupe.
import { describe, it, expect } from "vitest";
import { evaluateSlo, dedupeAlerts, SLO_THRESHOLDS } from "./slo";

describe("[R6-G3] SLO metrics + alert", () => {
  it("[R6-G3-T1-01] metric vượt ngưỡng → alert; trong ngưỡng → không", () => {
    const alerts = evaluateSlo({ eventPending: 80, webhookFail: 2, emailQueueBacklog: 10, cronLagMinutes: 5 });
    const keys = alerts.map((a) => a.key);
    expect(keys).toContain("eventPending"); // 80 > 50
    expect(keys).not.toContain("webhookFail"); // 2 < 10
    expect(alerts.find((a) => a.key === "eventPending")!.threshold).toBe(50);
  });

  it("[R6-G3-T1-02] nhiều metric vượt → nhiều alert (phủ cả 4 metric OTP của P4)", () => {
    const alerts = evaluateSlo({
      eventPending: 100,
      webhookFail: 20,
      emailQueueBacklog: 200,
      cronLagMinutes: 60,
      otpSentToday: 301,
      otpDeliveryFailToday: 21,
      znsUserErrorToday: 31,
      otpCostTodayVnd: 90_001,
      znsNotifyFailedToday: 11,
    });
    expect(alerts).toHaveLength(SLO_THRESHOLDS.length);
  });

  it("[R6-G3-T1-03] không metric nào vượt → không alert", () => {
    expect(evaluateSlo({ eventPending: 0, webhookFail: 0, emailQueueBacklog: 0, cronLagMinutes: 0 })).toHaveLength(0);
  });

  it("[R6-G3-T6-01] dedupe: alert đã bắn gần đây → bỏ (không spam)", () => {
    const alerts = evaluateSlo({ eventPending: 80, webhookFail: 20 });
    expect(alerts).toHaveLength(2);
    // eventPending đã bắn → chỉ còn webhookFail.
    const fresh = dedupeAlerts(alerts, ["eventPending"]);
    expect(fresh.map((a) => a.key)).toEqual(["webhookFail"]);
    // cả 2 đã bắn → rỗng.
    expect(dedupeAlerts(alerts, ["eventPending", "webhookFail"])).toHaveLength(0);
  });
});
