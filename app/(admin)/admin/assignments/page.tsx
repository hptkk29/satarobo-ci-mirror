import Link from "next/link";
import { ClipboardList, FileStack, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { AssignmentStatus, SubmissionStatus, type Prisma } from "@prisma/client";
import { formatDateOrDash } from "@/lib/format/date";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const dynamic = "force-dynamic";

const STATUS_INFO: Record<AssignmentStatus, { label: string; color: string }> = {
  DRAFT: { label: "Đang soạn", color: "bg-muted text-foreground" },
  PUBLISHED: { label: "Đã giao", color: "bg-state-success-soft text-state-success-ink" },
  CLOSED: { label: "Đã đóng", color: "bg-state-warning-soft text-state-warning-ink" },
  ARCHIVED: { label: "Lưu trữ", color: "bg-muted text-muted-foreground" },
};

const VALID_STATUSES = Object.values(AssignmentStatus);

// Bao cả mốc epoch 1970 (seed cũ) → "—", không chỉ null.
const fmtDate = formatDateOrDash;

interface SearchParams {
  searchParams: Promise<{
    q?: string;
    status?: string;
    classId?: string;
  }>;
}

export default async function AssignmentsPage({ searchParams }: SearchParams) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("assignments:view"))) {
    redirect("/dashboard?error=unauthorized");
  }
  const canCreateAssignment = await checkPermission("assignments:create");

  // Cách ly cơ sở: Assignment KHÔNG nằm trong SCOPED_MODELS (không có centerId trực
  // tiếp) → scopedDb không auto-scope. Scope thủ công qua class.centerId, dùng cùng
  // tầm nhìn cơ sở của model Class (đã isolate ở /admin/classes).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const visibleClassCenters = getModelVisibleCenterIds("Class", actor);

  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const statusFilter =
    sp.status && VALID_STATUSES.includes(sp.status as AssignmentStatus)
      ? (sp.status as AssignmentStatus)
      : undefined;
  const classFilter = sp.classId?.trim() || undefined;

  const where: Prisma.AssignmentWhereInput = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(classFilter ? { classId: classFilter } : {}),
    ...(q
      ? { title: { contains: q, mode: "insensitive" as const } }
      : {}),
  };

  // Scope thủ công qua class.centerId (Assignment phụ thuộc cơ sở qua lớp).
  if (visibleClassCenters !== "ALL") {
    where.class = { centerId: { in: visibleClassCenters } };
  }

  const [assignments, classes] = await Promise.all([
    sdb.assignment.findMany({
      where,
      include: {
        class: { select: { name: true, classCode: true } },
        lesson: { select: { order: true, title: true } },
        _count: { select: { submissions: true, documents: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    sdb.class.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, classCode: true },
      take: 200,
    }),
  ]);

  // Stats: how many SUBMITTED / GRADED per assignment
  // (assignmentId đã giới hạn trong danh sách assignment đã được scope ở trên).
  const stats =
    assignments.length > 0
      ? await sdb.assignmentSubmission.groupBy({
          by: ["assignmentId", "status"],
          where: { assignmentId: { in: assignments.map((a) => a.id) } },
          _count: { _all: true },
        })
      : [];

  const statsByAssignment = new Map<
    string,
    { submitted: number; graded: number; late: number; total: number }
  >();
  for (const s of stats) {
    const cur = statsByAssignment.get(s.assignmentId) ?? {
      submitted: 0,
      graded: 0,
      late: 0,
      total: 0,
    };
    cur.total += s._count._all;
    if (s.status === SubmissionStatus.SUBMITTED)
      cur.submitted += s._count._all;
    if (s.status === SubmissionStatus.LATE) cur.late += s._count._all;
    if (s.status === SubmissionStatus.GRADED) cur.graded += s._count._all;
    statsByAssignment.set(s.assignmentId, cur);
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <ClipboardList className="h-6 w-6 text-primary" />
            Bài tập
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {assignments.length > 0
              ? `${assignments.length} bài tập`
              : "Chưa có bài tập nào"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canCreateAssignment && (
            <Link
              href="/assignments/templates"
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary-soft bg-card px-4 py-2 text-sm font-semibold text-primary hover:bg-primary-soft"
            >
              <FileStack className="h-4 w-4" />
              Mẫu bài tập
            </Link>
          )}
          <Link
            href="/assignments/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Tạo bài tập mới
          </Link>
        </div>
      </div>

      <form
        method="GET"
        className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="Tìm tiêu đề..."
          className="lg:col-span-2 rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <select
          name="status"
          defaultValue={statusFilter ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Mọi trạng thái</option>
          {Object.entries(STATUS_INFO).map(([v, { label }]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="classId"
          defaultValue={classFilter ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Mọi lớp</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.classCode ? `${c.classCode} · ` : ""}
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 sm:col-span-2 lg:col-span-4"
        >
          Áp dụng bộ lọc
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <PhanTrangBang cuonNgang>
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tiêu đề
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Lớp
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hạn nộp
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Trạng thái
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tài liệu
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Nộp / Chấm
                </th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {assignments.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    Chưa có bài tập nào khớp bộ lọc.{" "}
                    <Link
                      href="/assignments/new"
                      className="text-primary hover:underline"
                    >
                      Tạo mới →
                    </Link>
                  </td>
                </tr>
              ) : (
                assignments.map((a) => {
                  const statusInfo = STATUS_INFO[a.status];
                  const s = statsByAssignment.get(a.id) ?? {
                    submitted: 0,
                    graded: 0,
                    late: 0,
                    total: 0,
                  };
                  const submittedTotal = s.submitted + s.late + s.graded;
                  return (
                    <tr key={a.id} className="hover:bg-muted/60">
                      <td className="px-3 py-3">
                        <div className="font-medium text-foreground line-clamp-1">
                          {a.title}
                        </div>
                        {a.lesson && (
                          <div className="text-xs text-muted-foreground">
                            Bài {a.lesson.order}: {a.lesson.title}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        <div className="font-medium">{a.class.name}</div>
                        {a.class.classCode && (
                          <div className="text-muted-foreground tabular-nums">
                            {a.class.classCode}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm tabular-nums text-muted-foreground">
                        {fmtDate(a.dueAt)}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center text-sm tabular-nums text-foreground">
                        {a._count.documents}
                      </td>
                      <td className="px-3 py-3 text-center text-xs tabular-nums">
                        {s.total > 0 ? (
                          <>
                            <span className="font-semibold text-foreground">
                              {submittedTotal}
                            </span>
                            <span className="text-muted-foreground">/{s.total}</span>
                            {s.graded > 0 && (
                              <span className="ml-1 text-state-success-ink">
                                ({s.graded}✓)
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link
                          href={`/assignments/${a.id}/edit`}
                          className="inline-flex items-center gap-1 rounded-md border border-primary-soft px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
                        >
                          Mở
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
