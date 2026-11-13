import Link from "next/link";
import { redirect } from "next/navigation";
import { Cake } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getSetting } from "@/lib/settings/service";
import { formatDayKeyDMY, shiftDayKey, vnDayKey, vnDayStartUtc } from "@/lib/students/birthday-dates";
import { CelebrateButton, RunScanButton } from "./_components/birthday-actions";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "Sinh nhật học viên | Admin" };
export const dynamic = "force-dynamic";

/** Nhãn cột ZNS. SIMULATED phải nói rõ "chưa gửi thật" — đọc nhầm là không ai chúc bé. */
const ZNS_LABEL: Record<string, { text: string; cls: string }> = {
  SENT: { text: "Đã gửi", cls: "bg-state-success-soft text-state-success-ink" },
  SIMULATED: { text: "Mô phỏng (chưa gửi thật)", cls: "bg-state-warning-soft text-state-warning-ink" },
  SKIPPED: { text: "Bỏ qua (mẫu/SĐT chưa có)", cls: "bg-muted text-muted-foreground" },
  FAILED: { text: "Lỗi gửi", cls: "bg-state-danger-soft text-state-danger-ink" },
};

export default async function BirthdayPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkAnyPermission(PAGE_GATES["/sinh-nhat"]))) redirect("/dashboard");

  const canScan = await checkPermission("students:edit");
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const now = new Date();
  const todayKey = vnDayKey(now);
  const alertDays = await getSetting("student.birthdayAlertDaysBefore");

  // Cửa sổ hiển thị: 30 ngày quanh hôm nay (7 ngày đã qua để soát việc bị lỡ).
  // Cách ly cơ sở do scopedDb tự lo — StudentBirthdayGreeting ∈ SCOPED_MODELS.
  const rows = await sdb.studentBirthdayGreeting.findMany({
    where: {
      birthdayDate: {
        gte: vnDayStartUtc(shiftDayKey(todayKey, -7)),
        lt: vnDayStartUtc(shiftDayKey(todayKey, 31)),
      },
    },
    orderBy: [{ celebrationDate: "asc" }, { birthdayDate: "asc" }],
    take: 300,
    select: {
      id: true,
      birthdayDate: true,
      celebrationDate: true,
      celebrationSessionId: true,
      celebratedAt: true,
      znsStatus: true,
      student: { select: { id: true, name: true } },
    },
  });

  return (
    <div className="max-w-6xl p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Cake className="h-6 w-6 text-primary" /> Sinh nhật học viên
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hôm sinh nhật không có lớp thì buổi chúc mừng được xếp vào{" "}
            <strong>buổi học gần nhất trước đó</strong>. Hệ thống báo trước {alertDays} ngày so với
            buổi tổ chức (đổi ở Cấu hình vận hành). Học viên chưa xếp lớp / lớp đã kết thúc không
            hiện ở đây.
          </p>
        </div>
        {canScan && <RunScanButton />}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Không có sinh nhật nào trong 30 ngày tới. Nếu vừa nhập ngày sinh, bấm “Chạy quét sinh
          nhật”.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <PhanTrangBang cuonNgang>
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Học viên</th>
                  <th className="px-4 py-2">Ngày sinh nhật</th>
                  <th className="px-4 py-2">Buổi tổ chức</th>
                  <th className="px-4 py-2">Tin Zalo</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const birthdayKey = vnDayKey(r.birthdayDate);
                  const celebrationKey = r.celebrationDate ? vnDayKey(r.celebrationDate) : null;
                  const isToday = birthdayKey === todayKey;
                  const missed = !r.celebratedAt && celebrationKey !== null && celebrationKey < todayKey;
                  const zns = r.znsStatus ? ZNS_LABEL[r.znsStatus] : null;
  
                  return (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-medium text-foreground">
                        <Link
                          href={`/students/${r.student.id}/edit`}
                          className="text-primary hover:underline"
                        >
                          {r.student.name}
                        </Link>
                        {isToday && (
                          <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-bold text-primary">
                            HÔM NAY
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-foreground">{formatDayKeyDMY(birthdayKey)}</td>
                      <td className="px-4 py-2 text-foreground">
                        {celebrationKey ? (
                          r.celebrationSessionId ? (
                            <Link
                              href={`/sessions/${r.celebrationSessionId}`}
                              className="text-primary hover:underline"
                            >
                              {formatDayKeyDMY(celebrationKey)}
                            </Link>
                          ) : (
                            formatDayKeyDMY(celebrationKey)
                          )
                        ) : (
                          "—"
                        )}
                        {celebrationKey !== null && celebrationKey !== birthdayKey && (
                          <span className="block text-xs text-muted-foreground">tổ chức trước sinh nhật</span>
                        )}
                        {missed && (
                          <span className="block text-xs font-semibold text-state-danger-ink">
                            buổi đã qua, chưa chúc
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {zns ? (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${zns.cls}`}>
                            {zns.text}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">chưa tới ngày</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {r.celebratedAt && (
                            <span className="text-xs font-medium text-state-success-ink">đã chúc</span>
                          )}
                          <CelebrateButton id={r.id} done={r.celebratedAt !== null} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}
    </div>
  );
}
