import { type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { ok, fail } from "@/lib/api/response";
import { runElearningReminders } from "@/lib/elearning/cron-reminders";
import { isElearningEnabled, isElearningReminderEnabled } from "@/lib/flags";

export const dynamic = "force-dynamic";

// EL-06 — cron nhắc, mỗi 15 phút LỆCH PHA (`7,22,37,52 * * * *`).
//
// MỘT cron duy nhất tính CẢ 7 mốc của §12.2 trong mã, không phải bảy lịch. Nhịp
// 15 phút chứ không phải nhịp ngày vì mốc T-2 GIỜ không có cách nào phục vụ
// được bằng một lần chạy mỗi đêm.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return fail("UNAUTHENTICATED", "Không có quyền gọi tác vụ nền", { status: 401 });
  }
  if (!isElearningEnabled()) return ok({ skipped: "flag OFF" });
  // Cờ RIÊNG (đặc tả EL-06 mục 7) chỉ chặn việc NHẮC: truyền xuống chứ KHÔNG return sớm ở đây, vì cùng khe
  // cron còn chạy vòng đời chứng nhận (chốt hết hạn · giao lại vòng) — không phải "nhắc" nên không được đứng
  // theo cờ. OFF: `TrnReminder` giữ `PENDING`; bật lại thì mốc trễ >24h chuyển SKIPPED (`quaCuaSoBu`).
  return ok(await runElearningReminders(new Date(), { nhacBat: isElearningReminderEnabled() }));
}
