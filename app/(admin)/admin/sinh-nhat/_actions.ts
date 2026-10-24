"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { getSetting } from "@/lib/settings/service";
import { planBirthdays } from "@/lib/students/birthday";
import { notifyUpcomingBirthdays } from "@/lib/students/birthday-notify";
import { sendBirthdayGreetings } from "@/lib/students/birthday-zns";

// Sinh nhật học viên — action của màn /admin/sinh-nhat.
// Cách ly cơ sở: StudentBirthdayGreeting ∈ SCOPED_MODELS → đọc qua scopedDb, và
// passesScope TRƯỚC KHI GHI (scopedDb KHÔNG che write — thiếu chỗ này là IDOR:
// Sale cơ sở A đánh dấu "đã chúc" cho học viên cơ sở B).

type Result = { ok: boolean; error?: string };

async function gate(action: "students:view-all" | "students:edit") {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Chưa đăng nhập", uid: null, actor: null };
  if (!(await checkPermission(action)))
    return { ok: false as const, error: "Không có quyền", uid: null, actor: null };
  const actor = await resolveActor(session.user.id);
  return { ok: true as const, uid: session.user.id, actor };
}

/** Đánh dấu đã chúc mừng — việc biến khỏi chuông + khu "Cần xử lý" ở lần mở sau. */
export async function markBirthdayCelebrated(id: string): Promise<Result> {
  const g = await gate("students:view-all");
  if (!g.ok) return g;
  const actor: Actor = g.actor;
  const sdb = scopedDb(actor);

  const row = await sdb.studentBirthdayGreeting.findUnique({
    where: { id },
    select: { centerId: true, celebratedAt: true },
  });
  if (!row || !passesScope("StudentBirthdayGreeting", row, actor)) {
    return { ok: false, error: "Không tìm thấy" };
  }
  if (row.celebratedAt) return { ok: true }; // bấm 2 lần → không đổi gì

  await sdb.studentBirthdayGreeting.update({
    where: { id },
    data: { celebratedAt: new Date(), celebratedById: g.uid },
  });
  revalidatePath("/sinh-nhat");
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Bỏ đánh dấu (bấm nhầm) — cho việc hiện lại. */
export async function undoBirthdayCelebrated(id: string): Promise<Result> {
  const g = await gate("students:view-all");
  if (!g.ok) return g;
  const actor: Actor = g.actor;
  const sdb = scopedDb(actor);

  const row = await sdb.studentBirthdayGreeting.findUnique({
    where: { id },
    select: { centerId: true },
  });
  if (!row || !passesScope("StudentBirthdayGreeting", row, actor)) {
    return { ok: false, error: "Không tìm thấy" };
  }
  await sdb.studentBirthdayGreeting.update({
    where: { id },
    data: { celebratedAt: null, celebratedById: null },
  });
  revalidatePath("/sinh-nhat");
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Chạy tay 3 pha của cron.
 *
 * Lý do tồn tại: Vercel Cron KHÔNG chạy trên môi trường `test`, không có nút này
 * thì không nghiệm thu được luồng sinh nhật trước khi lên prod. Gate `students:edit`
 * (Super/QLCS/Sale) — cùng quyền với đường xác thực thứ hai của route cron.
 */
export async function runBirthdayScan(): Promise<Result & { summary?: string }> {
  const g = await gate("students:edit");
  if (!g.ok) return g;

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

    revalidatePath("/sinh-nhat");
    revalidatePath("/dashboard");
    return {
      ok: true,
      summary: `Quét ${plan.scanned} HV · ${plan.planned} sinh nhật sắp tới · bỏ qua ${plan.skippedNoSession} (không có buổi học) · báo ${notify.notified} người · ZNS gửi ${zns.sent}, mô phỏng ${zns.simulated}, bỏ qua ${zns.skipped}, lỗi ${zns.failed}`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Quét thất bại" };
  }
}
