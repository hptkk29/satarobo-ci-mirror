import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { ExamStatus, type Prisma } from "@prisma/client";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const dynamic = "force-dynamic";

const STATUS_INFO: Record<ExamStatus, { label: string; color: string }> = {
  DRAFT: { label: "Đang soạn", color: "bg-muted text-foreground" },
  PUBLISHED: { label: "Đã publish", color: "bg-state-success-soft text-state-success-ink" },
  CLOSED: { label: "Đóng", color: "bg-state-warning-soft text-state-warning-ink" },
  ARCHIVED: { label: "Lưu trữ", color: "bg-muted text-muted-foreground" },
};

const VALID_STATUSES = Object.values(ExamStatus);

interface SearchParams {
  searchParams: Promise<{
    q?: string;
    status?: string;
    classId?: string;
  }>;
}

export default async function ExamsPage({ searchParams }: SearchParams) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("exams:view"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // Cách ly cơ sở: Exam KHÔNG có centerId trực tiếp (không nằm trong SCOPED_MODELS).
  // Đề gắn cơ sở qua class.centerId → scope thủ công theo tầm nhìn cơ sở của model Class.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const visibleClassCenters = getModelVisibleCenterIds("Class", actor);

  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const statusFilter =
    sp.status && VALID_STATUSES.includes(sp.status as ExamStatus)
      ? (sp.status as ExamStatus)
      : undefined;
  const classFilter = sp.classId?.trim() || undefined;

  const where: Prisma.ExamWhereInput = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(classFilter ? { classId: classFilter } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { examCode: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  // Đề có gắn lớp ở cơ sở ngoài tầm nhìn → ẩn. Đề KHÔNG gắn lớp (classId null) là đề
  // dùng chung, không thuộc cơ sở nào → vẫn cho xem. SUPER_ADMIN/HO trả "ALL" → bỏ lọc.
  if (visibleClassCenters !== "ALL") {
    where.AND = [
      {
        OR: [
          { classId: null },
          { class: { centerId: { in: visibleClassCenters } } },
        ],
      },
    ];
  }

  const [exams, classes] = await Promise.all([
    sdb.exam.findMany({
      where,
      include: {
        class: { select: { name: true, classCode: true } },
        lesson: {
          select: { order: true, title: true, curriculum: { select: { name: true } } },
        },
        _count: { select: { examQuestions: true, attempts: true } },
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

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <FileText className="h-6 w-6 text-primary" />
            Đề thi
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {exams.length > 0 ? `${exams.length} đề thi` : "Chưa có đề thi nào"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/exams/import-word"
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary px-4 py-2 text-sm font-semibold text-primary hover:bg-primary-soft"
          >
            <FileText className="h-4 w-4" />
            Import Word
          </Link>
          <Link
            href="/exams/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Tạo đề mới
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
          placeholder="Tìm tiêu đề / mã đề..."
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
                  Lớp / Bài
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Trạng thái
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Câu
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Lượt
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Thời lượng
                </th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {exams.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    Chưa có đề thi nào khớp bộ lọc.{" "}
                    <Link href="/exams/new" className="text-primary hover:underline">
                      Tạo mới →
                    </Link>
                  </td>
                </tr>
              ) : (
                exams.map((e) => {
                  const statusInfo = STATUS_INFO[e.status];
                  return (
                    <tr key={e.id} className="hover:bg-muted/60">
                      <td className="px-3 py-3">
                        <div className="font-medium text-foreground">{e.title}</div>
                        {e.examCode && (
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {e.examCode}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {e.class && (
                          <div className="font-medium">{e.class.name}</div>
                        )}
                        {e.lesson && (
                          <div className="text-muted-foreground">
                            {e.lesson.curriculum.name} — Bài {e.lesson.order}:{" "}
                            {e.lesson.title}
                          </div>
                        )}
                        {!e.class && !e.lesson && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center text-sm tabular-nums text-foreground">
                        {e._count.examQuestions}
                      </td>
                      <td className="px-3 py-3 text-center text-sm tabular-nums text-foreground">
                        {e._count.attempts}
                      </td>
                      <td className="px-3 py-3 text-sm tabular-nums text-muted-foreground">
                        {e.durationMinutes}′
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <Link
                            href={`/exams/${e.id}/builder`}
                            className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted"
                          >
                            Builder
                          </Link>
                          <Link
                            href={`/exams/${e.id}/attempts`}
                            className="rounded-md border border-primary-soft px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
                          >
                            Bài làm
                          </Link>
                        </div>
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
