import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck2, ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { passesScope } from "@/lib/db-scope";
import { auditAllClassSessions } from "@/lib/classes/session-sync";
import { vnYmd } from "@/lib/time/vn";
import { vnHm } from "@/lib/classes/slots";
import { AuditRowActions } from "./_components/audit-row-actions";
import { PageHelp } from "@/components/admin/ui/page-help";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "Kiểm tra lịch buổi học | Admin" };
export const dynamic = "force-dynamic";

// =============================================================================
// 08/08/2026 — MÀN RÀ SOÁT "buổi học có khớp ngày khai giảng + lịch học không".
//
// Vì sao cần một màn riêng: lệch dãy buổi là lỗi IM LẶNG (endDate được tính lại theo
// lịch mới, còn ClassSession giữ dãy cũ). Không ai phát hiện được nếu phải mở từng lớp.
// Ca thật đã xảy ra: `sata3.15h45-17h15.T7.CS1-201` lệch 5 tuần, `sata2.09h-CN.CS1-101`
// tạo thẳng ACTIVE nên chưa từng có buổi nào.
// =============================================================================

const SEVERITY_LABEL: Record<string, { text: string; cls: string }> = {
  ANCHOR_WRONG: {
    text: "Neo sai ngày khai giảng",
    cls: "bg-state-danger-soft text-state-danger-ink",
  },
  NO_SESSIONS: {
    text: "Chưa có buổi nào",
    cls: "bg-state-danger-soft text-state-danger-ink",
  },
  DRIFT: {
    text: "Lệch giữa khoá",
    cls: "bg-state-warning-soft text-state-warning-ink",
  },
  NO_SCHEDULE: {
    text: "Thiếu lịch/khai giảng",
    cls: "bg-muted text-foreground",
  },
};

const fmt = (d: Date | null) => (d ? `${vnYmd(d)} ${vnHm(d)}` : "—");

export default async function ClassScheduleAuditPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("classes:view-all")))
    redirect("/dashboard?error=unauthorized");

  const actor = await resolveActor(session.user.id);
  const canEdit = await checkPermission("classes:edit");
  // `auditAllClassSessions` đọc bằng `db` trần (cần gom 4 truy vấn, không n+1) nên phải
  // tự lọc cách ly cơ sở ở đây — đúng luật `scopedDb` chỉ che READ khi đi qua nó.
  const all = await auditAllClassSessions();
  const rows = all.filter((r) =>
    passesScope("Class", { centerId: r.centerId }, actor),
  );

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/classes"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Lớp học
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <CalendarCheck2 className="h-6 w-6 text-primary" />
          Kiểm tra lịch buổi học
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lớp có lịch học lệch so với khai giảng
        </p>
      </div>

      <PageHelp>
        <p>
          Đối chiếu dãy buổi đã sinh với{" "}
          <strong>ngày khai giảng + lịch học</strong> của từng lớp (đã trừ ngày
          nghỉ). Chỉ liệt kê lớp có vấn đề — danh sách rỗng nghĩa là mọi lớp đều
          khớp.
        </p>
      </PageHelp>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-state-success-soft bg-state-success-soft p-6 text-center text-sm font-medium text-state-success-ink">
          Mọi lớp đang khớp lịch — không có buổi nào lệch ngày khai giảng.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <PhanTrangBang cuonNgang>
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Lớp</th>
                  <th className="px-4 py-3">Vấn đề</th>
                  <th className="px-4 py-3">Khai giảng</th>
                  <th className="px-4 py-3">Buổi 1 hiện tại</th>
                  <th className="px-4 py-3">Buổi 1 đúng lịch</th>
                  <th className="px-4 py-3 text-right">Buổi lệch</th>
                  <th className="px-4 py-3 text-right">Xử lý</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const sev = SEVERITY_LABEL[r.severity] ?? {
                    text: r.severity,
                    cls: "bg-muted text-foreground",
                  };
                  return (
                    <tr key={r.classId} className="align-top">
                      <td className="px-4 py-3">
                        <Link
                          href={`/classes/${r.classId}`}
                          className="font-semibold text-primary hover:underline"
                        >
                          {r.className}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {r.classStatus} · {r.sessionCount} buổi
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${sev.cls}`}
                        >
                          {sev.text}
                        </span>
                        {r.message && (
                          <p className="mt-1 max-w-md text-xs text-muted-foreground">
                            {r.message}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-foreground">
                        {r.startDate ? vnYmd(r.startDate) : "—"}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-foreground">
                        {fmt(r.actualFirst)}
                      </td>
                      <td className="px-4 py-3 tabular-nums font-semibold text-foreground">
                        {fmt(r.expectedFirst)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {r.wrongDateCount}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <AuditRowActions classId={r.classId} canEdit={canEdit} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        &quot;Xếp lại&quot; neo lại cả dãy buổi từ ngày khai giảng theo lịch
        hiện tại. Chỉ đổi ngày — không tạo, không xoá buổi; buổi đã điểm danh /
        có nhận xét / đã giao bài / có ảnh / đã hoàn tất giữ nguyên ngày và
        chiếm chỗ ngày đó.
      </p>
    </div>
  );
}
