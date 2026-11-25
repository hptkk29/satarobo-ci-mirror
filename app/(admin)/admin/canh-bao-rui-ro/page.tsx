import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { ResolveButtons } from "./_components/alert-actions";

export const metadata = { title: "Cảnh báo rủi ro HV | Admin" };
export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  CONSECUTIVE_ABSENCE: "Nghỉ 2 buổi liên tiếp",
  HIGH_ABSENCE: "Nghỉ vượt ngưỡng",
  MISSED_SUBMISSIONS: "Không nộp bài nhiều lần",
  NEEDS_SUPPORT: "GV đánh dấu cần hỗ trợ",
  NEARING_END_NO_RENEWAL: "Sắp hết khoá chưa tái đăng ký",
  OVERDUE_PAYMENT: "Công nợ quá hạn",
};
const SEV_BADGE: Record<string, string> = {
  LOW: "bg-muted text-muted-foreground",
  MEDIUM: "bg-state-warning-soft text-state-warning-ink",
  HIGH: "bg-state-danger-soft text-state-danger-ink",
};

export default async function RiskAlertPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkAnyPermission(PAGE_GATES["/canh-bao-rui-ro"]))) redirect("/dashboard");

  // Cách ly cơ sở: StudentRiskAlert ∈ SCOPED_MODELS → scopedDb tự inject centerId IN
  // tầm-nhìn-cơ-sở của actor (SUPER_ADMIN/HO bypass → ALL). Thay manual centerScope cũ.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const alerts = await sdb.studentRiskAlert.findMany({
    where: { status: { in: ["OPEN", "ESCALATED"] } },
    orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
    take: 200,
    select: {
      id: true, type: true, severity: true, status: true, detail: true, createdAt: true,
      student: { select: { id: true, name: true } },
    },
  });

  return (
    <div className="max-w-4xl p-6">
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <AlertTriangle className="h-6 w-6 text-state-danger-ink" /> Cảnh báo rủi ro học viên
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Học viên có nguy cơ rời bỏ — cần chăm sóc kịp thời.</p>
      </div>

      {alerts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Không có cảnh báo nào.
        </p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Link href={`/students/${a.student.id}/edit`} className="font-semibold text-primary hover:underline">
                    {a.student.name}
                  </Link>
                  <span className="ml-2 text-sm text-muted-foreground">{TYPE_LABEL[a.type] ?? a.type}</span>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${SEV_BADGE[a.severity]}`}>
                  {a.severity}{a.status === "ESCALATED" ? " · escalated" : ""}
                </span>
              </div>
              {a.detail && <p className="mt-1 text-sm text-muted-foreground">{a.detail}</p>}
              <div className="mt-3">
                <ResolveButtons id={a.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
