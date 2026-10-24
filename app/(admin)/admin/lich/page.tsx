import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { monthGridRange, shiftMonth } from "@/lib/lms/calendar";
import { getAdminCalendarEvents } from "@/lib/lms/calendar-data";
import { MonthCalendar } from "@/components/lms/month-calendar";

export const dynamic = "force-dynamic";

function parseInt10(v: string | undefined, fallback: number): number {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export default async function AdminCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Vá 24/07 — trang trước đây KHÔNG gate quyền ngoài login. Cho qua nếu có ≥1 quyền
  // xem buổi/lớp (GV giữ sessions:view + classes:view-own nên vẫn vào được; cả 3
  // action đều GLOBAL trong seed → gọi trần an toàn theo R1 rbac-scope.test).
  if (
    !(await checkAnyPermission(["sessions:view", "classes:view-all", "classes:view-own"]))
  ) {
    redirect("/admin/dashboard");
  }
  const sp = await searchParams;
  const now = new Date();
  const year = parseInt10(sp.y, now.getFullYear());
  const month0 = parseInt10(sp.m, now.getMonth());

  const actor = await resolveActor(session.user.id);
  const { from, to } = monthGridRange(year, month0);
  const events = await getAdminCalendarEvents(actor, from, to);

  const prev = shiftMonth(year, month0, -1);
  const next = shiftMonth(year, month0, 1);
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Lịch dạy</h1>
        <div className="flex gap-2 text-sm">
          {/* href CHỈ-QUERY (giữ nguyên path hiện tại) — ĐỪNG viết `/admin/lich?…`.
              Trên host admin, mọi đường còn tiền tố `/admin` rơi vào nhánh `redirectPath`
              của `decideRoute`, mà `redirectTo` trong proxy.ts **xoá sạch query**
              (`url.search = ""`, chỉ giữ lại callbackUrl/reason). Hệ quả: bấm Trước/Sau
              thì về `/lich` trần và lịch hiện lại ĐÚNG THÁNG CŨ — không lỗi, không dấu vết.
              Dạng chỉ-query chạy đúng cả trên admin.satarobo.vn/lich LẪN localhost/admin/lich. */}
          <Link href={`?y=${prev.year}&m=${prev.month0}`} className="rounded border px-2 py-1">← Trước</Link>
          <Link href={`?y=${next.year}&m=${next.month0}`} className="rounded border px-2 py-1">Sau →</Link>
        </div>
      </div>
      <MonthCalendar year={year} month0={month0} events={events} />
    </div>
  );
}
