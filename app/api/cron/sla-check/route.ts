import { withCron } from "@/lib/cron/handler";
import { runSlaCheck } from "@/lib/crm/sla";

export const dynamic = "force-dynamic";

// R1-06 — Cron SLA (15'): quét lead vi phạm SLA → StaffNotification (dedupeKey).
// API-18: withCron = verifyCronAuth + try/catch có cấu trúc (giữ shape { ok, data }).
export const GET = withCron("sla-check", async () => {
  const result = await runSlaCheck();
  return { ok: true, data: result };
});
