import Link from "next/link";
import { redirect } from "next/navigation";
import { HeartHandshake } from "lucide-react";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/auth/permissions";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import type { Prisma } from "@prisma/client";
import { CompleteCareButton } from "../canh-bao-rui-ro/_components/alert-actions";
import { formatDateVN } from "@/lib/format/date";

export const metadata = { title: "Chăm sóc học viên | Admin" };
export const dynamic = "force-dynamic";

export default async function CareTaskPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Gate 10/07: parent-requests:manage (QL co so, Sale/CSKH, Giao vu). Bo hack
  // `hasRole(SALES_CSM)` - Sale von da giu chinh action do. GV khong vao: trang
  // khong loc theo lop phan cong.
  if (!(await checkAnyPermission(PAGE_GATES["/cham-soc-hv"]))) redirect("/dashboard");

  const isSuper = hasRole(session.user, "SUPER_ADMIN");
  const isCM = hasRole(session.user, "CENTER_MANAGER");
  const isSalesOnly = hasRole(session.user, "SALES_CSM") && !isSuper && !isCM;
  const centerScope = isCM && !isSuper ? session.user.centerId : null;

  const where: Prisma.StudentCareTaskWhereInput = isSalesOnly
    ? { status: "OPEN", assignedToId: session.user.id }
    : { status: "OPEN", ...(centerScope ? { centerId: centerScope } : {}) };

  // Cách ly cơ sở: StudentCareTask ∈ SCOPED_MODELS (có centerId) → scopedDb tự inject
  // `centerId IN visibleCenterIds`. Giữ nguyên filter UI (centerScope CM / assignedTo sale).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const tasks = await sdb.studentCareTask.findMany({
    where,
    orderBy: { dueAt: "asc" },
    take: 200,
    select: { id: true, title: true, description: true, dueAt: true, student: { select: { id: true, name: true } } },
  });
  const now = new Date();

  return (
    <div className="max-w-4xl p-6">
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <HeartHandshake className="h-6 w-6 text-primary" /> Việc chăm sóc học viên
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Task chăm sóc phát sinh từ cảnh báo rủi ro / sau đăng ký.</p>
      </div>

      {tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Không có việc chăm sóc nào.
        </p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-4">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{t.title}</p>
                <p className="text-xs text-muted-foreground">
                  <Link href={`/students/${t.student.id}/edit`} className="text-primary hover:underline">{t.student.name}</Link>
                  {" · "}hạn {formatDateVN(t.dueAt)}
                  {t.dueAt < now && <span className="ml-1 font-semibold text-state-danger-ink">(quá hạn)</span>}
                </p>
              </div>
              <CompleteCareButton id={t.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
