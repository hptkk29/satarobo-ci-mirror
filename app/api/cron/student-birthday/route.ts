import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { safeEqual } from "@/lib/security/safe-equal";
import { getSetting } from "@/lib/settings/service";
import { planBirthdays } from "@/lib/students/birthday";
import { notifyUpcomingBirthdays } from "@/lib/students/birthday-notify";
import { sendBirthdayGreetings } from "@/lib/students/birthday-zns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// Cron sinh nhật học viên — chạy 01:00 UTC = 08:00 giờ VN (cùng khung class-reminder).
//
// Giờ chạy KHÔNG tuỳ tiện: tin ZNS mục đích Chăm sóc khách hàng dính khung cấm
// 22:00–06:00 giờ VN (mã lỗi -133). Dời cron ra ngoài 06:00–22:00 là tin bị chặn.
//
// Ba pha một lượt, pha sau không phụ thuộc pha trước thành công:
//   1. planBirthdays        — quét sinh nhật sắp tới, chọn buổi tổ chức, ghi sổ
//   2. notifyUpcomingBirthdays — báo Sale/QLCS/GV khi buổi tổ chức tới hạn
//   3. sendBirthdayGreetings   — gửi ZNS cho phụ huynh ĐÚNG hôm sinh nhật
//
// ⚠️ Vercel Cron KHÔNG chạy trên môi trường `test` → không nghiệm thu được bằng
// lịch. Vì vậy route nhận HAI đường xác thực (cùng mẫu /api/cron/email-queue):
// CRON_SECRET, hoặc admin đang đăng nhập có quyền `students:edit` — chính là quyền
// đứng sau nút "Chạy quét sinh nhật" trên /admin/sinh-nhat.
// =============================================================================

async function authorize(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get("authorization");
    if (safeEqual(header ?? "", `Bearer ${secret}`)) return true;
  }
  const session = await auth();
  return !!session?.user && (await checkPermission("students:edit"));
}

export async function GET(req: NextRequest) {
  if (!(await authorize(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const now = new Date();
    const [lookaheadDays, lookbackDays, alertDaysBefore] = await Promise.all([
      getSetting("student.birthdayLookaheadDays"),
      getSetting("student.birthdayLookbackDays"),
      getSetting("student.birthdayAlertDaysBefore"),
    ]);

    const plan = await planBirthdays(now, { lookaheadDays, lookbackDays });
    const notify = await notifyUpcomingBirthdays(now, { alertDaysBefore });
    const zns = await sendBirthdayGreetings(now);

    const stats = { plan, notify, zns };
    console.log("[cron] student-birthday:", JSON.stringify(stats));
    return NextResponse.json(
      { ok: true, stats },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[cron:student-birthday]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "cron failed" },
      { status: 500 },
    );
  }
}

export const POST = GET;
