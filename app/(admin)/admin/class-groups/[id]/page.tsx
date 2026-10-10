import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { GroupMembers } from "../_components/group-members";
import { GroupEnrollPanel } from "../_components/group-enroll-panel";

export const metadata = { title: "Chi tiết nhóm lớp | Admin" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Đang hoạt động",
  GRADUATED: "Đã tốt nghiệp",
  DISBANDED: "Đã giải thể",
  PLANNED: "Dự kiến",
  RECRUITING: "Đang tuyển",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã huỷ",
};

interface Props {
  params: Promise<{ id: string }>;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

export default async function ClassGroupDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("class_group:view-all"))) {
    redirect("/dashboard?error=unauthorized");
  }
  const canManage = await checkPermission("class_group:edit");

  // Cách ly cơ sở: ClassGroup ∈ SCOPED_MODELS → sdb.classGroup.findFirst auto-inject
  // centerId IN tầm-nhìn. Nhóm thuộc cơ sở khác → group = null → notFound (chống IDOR).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const { id } = await params;
  const group = await sdb.classGroup.findFirst({
    where: { id, deletedAt: null },
    include: {
      center: { select: { name: true, code: true } },
      classes: {
        where: { deletedAt: null },
        include: {
          course: { select: { name: true, code: true } },
          _count: { select: { enrollments: true } },
        },
        orderBy: [{ startDate: "asc" }],
      },
      students: {
        where: { deletedAt: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true, studentCode: true },
      },
    },
  });
  if (!group) notFound();

  // % tiến độ đơn giản: số lớp đã COMPLETED / tổng lớp.
  const total = group.classes.length;
  const done = group.classes.filter((c) => c.status === "COMPLETED").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="max-w-5xl p-6">
      <Link
        href="/class-groups"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">
              {group.displayCode}
            </h1>
            <span className="rounded bg-state-success-soft px-2 py-0.5 text-xs text-state-success-ink">
              {STATUS_LABEL[group.status]}
            </span>
          </div>
          {group.name && <p className="mt-1 text-foreground">{group.name}</p>}
          <p className="mt-1 text-sm text-muted-foreground">
            {group.center.name} · Mã định danh:{" "}
            <span className="font-mono">{group.code}</span>
          </p>
        </div>
        {canManage && (
          <Link
            href={`/class-groups/${group.id}/edit`}
            className="rounded border border-border px-3 py-2 text-sm hover:bg-muted"
          >
            Sửa
          </Link>
        )}
      </div>

      {/* Tiến độ */}
      <div className="mb-6 rounded-xl border border-border bg-card p-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-semibold text-foreground">
            Lộ trình nhóm — {done}/{total} khoá hoàn thành
          </span>
          <span className="font-bold text-state-info-ink">{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* P2 — thành viên cố định của nhóm + gán cả nhóm vào lớp */}
      <GroupMembers groupId={group.id} members={group.students} canManage={canManage} />
      {canManage && (
        <GroupEnrollPanel
          groupId={group.id}
          members={group.students}
          classes={group.classes.map((c) => ({ id: c.id, name: c.name }))}
        />
      )}

      {/* Các lớp/khoá đã & đang học */}
      <h2 className="mb-3 text-lg font-bold text-foreground">
        Các khoá nhóm đã & đang học ({total})
      </h2>
      {total === 0 ? (
        <div className="rounded-xl bg-muted p-6 text-center text-sm text-muted-foreground">
          Chưa có lớp nào gán vào nhóm này. Khi tạo/sửa lớp, chọn nhóm lớp này để
          gán.
        </div>
      ) : (
        <ol className="space-y-2">
          {group.classes.map((c, i) => (
            <li
              key={c.id}
              className="flex items-center gap-4 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-state-info-soft text-sm font-bold text-state-info-ink">
                {i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/classes/${c.id}`}
                  className="font-semibold text-foreground hover:text-state-info-ink hover:underline"
                >
                  {c.name}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {c.course.name}
                  {c.classCode ? ` · ${c.classCode}` : ""} ·{" "}
                  {fmtDate(c.startDate)} → {fmtDate(c.endDate)} ·{" "}
                  {c._count.enrollments} HV
                </div>
              </div>
              <span className="flex-shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {STATUS_LABEL[c.status] ?? c.status}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
