import { withCron } from "@/lib/cron/handler";
import { chayDonDep } from "@/lib/ai-lead/dich-vu/don-dep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// AI Lead Gateway (design §7) — DỌN + NHẮC, 10 phút/lần (`vercel.json` `*/10 * * * *`, `deploy/crontab.example` khối PROD + dòng TEST):
// xoá nonce cũ · xoá bản ghi idempotency quá 7 ngày · EXPIRED hồ sơ quá `ai.draftExpireHours` chưa ai nhận (ghi audit hệ thống) · nhắc SLA `ai_lead.sla:`.
// KHÔNG ghi tiền / quyền / lead.
//
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch JSON có cấu trúc. Đồng hồ là HÀM (luật 19 ở lib).
// `chayDonDep` tự bắt lỗi từng giai đoạn và chỉ ghi MÃ — withCron `console.error(err)` nguyên lỗi nên không được để lỗi Prisma thô nổi lên tới đây.
export const GET = withCron("ai-lead-don-dep", async () => {
  const kq = await chayDonDep({ dongHo: () => new Date() });
  return { ok: kq.ok, data: kq };
});
