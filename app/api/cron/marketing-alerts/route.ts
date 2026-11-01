import { withCron } from "@/lib/cron/handler";
import { runMarketingAlerts } from "@/lib/crm/marketing-alerts";

export const dynamic = "force-dynamic";

// R1-09 C9.5 + R1-12 C12.3 — cron hằng ngày: alert chốt chi phí / báo cáo trễ.
// API-18: withCron = verifyCronAuth + try/catch có cấu trúc (giữ shape { ok, data }).
export const GET = withCron("marketing-alerts", async () => {
  const result = await runMarketingAlerts();
  return { ok: true, data: result };
});
