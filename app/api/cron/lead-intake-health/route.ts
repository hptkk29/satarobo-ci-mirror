import { withCron } from "@/lib/cron/handler";
import { runIntakeHealthAlerts } from "@/lib/lead/intake/health";

export const dynamic = "force-dynamic";

// P4 — canh sức khoẻ đường nhận lead (form Sale / quatang / 3 webhook cũ).
// Chạy mỗi giờ: bắt cụm lỗi trong 1 giờ, và bắt nguồn từng chạy đều nay tịt hẳn.
// Vì sao cần: form vẫn hiện, người nhập vẫn thấy trang cảm ơn — hỏng đường này
// KHÔNG có triệu chứng nào nhìn thấy được. Xem `lib/lead/intake/health.ts`.
export const GET = withCron("lead-intake-health", async () => {
  const result = await runIntakeHealthAlerts();
  return { ok: true, data: result };
});
