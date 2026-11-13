import Link from "next/link";
import { ChevronLeft, ClipboardList } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { getModelVisibleCenterIds, scopedDb } from "@/lib/db-scope";
import { AttemptStatus } from "@prisma/client";
import { GradeButton } from "../../_components/grade-button";
import { checkPermission } from "@/lib/auth/check-permission";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const dynamic = "force-dynamic";

const ATTEMPT_STATUS_INFO: Record<
  AttemptStatus,
  { label: string; color: string }
> = {
  IN_PROGRESS: { label: "Đang làm", color: "bg-state-warning-soft text-state-warning-ink" },
  SUBMITTED: { label: "Đã nộp", color: "bg-state-info-soft text-state-info-ink" },
  GRADED: { label: "Đã chấm", color: "bg-state-success-soft text-state-success-ink" },
  REVIEWED: { label: "Đã xem", color: "bg-primary-soft text-primary" },
};

function fmtDateTime(d: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ExamAttemptsPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("exams:view"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const { id } = await params;

  // Loại B (Nhóm 01 L1) — Exam/ExamAttempt KHÔNG ∈ SCOPED_MODELS → lọc tay:
  // đề gắn lớp cơ sở khác → 404 (notFound); đề ngân hàng (classId null) xem được
  // nhưng attempts lọc theo student.centerId (nested include KHÔNG auto-scope, AC7).
  // Vá 24/07 — scope per-model thay isHoLevel trần: role HO chỉ cross-center khi
  // CÓ quyền module scope ALL (Toại TRAINING@HO: Class/Student = [CS1] → đề lớp
  // CS2 mở URL trực tiếp = 404, attempts HV CS2 = ẩn). SUPER_ADMIN = "ALL".
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const classScope = getModelVisibleCenterIds("Class", actor);
  const studentScope = getModelVisibleCenterIds("Student", actor);

  const exam = await sdb.exam.findFirst({
    where: {
      id,
      ...(classScope === "ALL"
        ? {}
        : {
            OR: [
              { classId: null },
              { class: { centerId: { in: classScope } } },
            ],
          }),
    },
    include: {
      attempts: {
        ...(studentScope === "ALL"
          ? {}
          : { where: { student: { centerId: { in: studentScope } } } }),
        orderBy: [{ status: "asc" }, { submittedAt: "desc" }],
        include: {
          student: {
            select: {
              id: true,
              name: true,
              studentCode: true,
              avatarUrl: true,
            },
          },
          gradedBy: { select: { fullName: true } },
        },
      },
      _count: { select: { examQuestions: true } },
    },
  });

  if (!exam) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/exams"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <ClipboardList className="h-6 w-6 text-primary" />
            Bài làm: <span className="text-primary">{exam.title}</span>
          </h1>
          <Link
            href={`/exams/${id}/builder`}
            className="text-sm font-semibold text-primary hover:underline"
          >
            ← Builder
          </Link>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {exam._count.examQuestions} câu · Tổng điểm {exam.totalPoints} · Đạt ≥{" "}
          {exam.passingScore} · Thời lượng {exam.durationMinutes}′
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <PhanTrangBang cuonNgang>
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Học viên
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Trạng thái
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Bắt đầu
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Nộp
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Điểm
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Đạt?
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  GV chấm
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {exam.attempts.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    Chưa có học viên nào làm bài.
                  </td>
                </tr>
              ) : (
                exam.attempts.map((a) => {
                  const statusInfo = ATTEMPT_STATUS_INFO[a.status];
                  return (
                    <tr key={a.id} className="hover:bg-muted/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {a.student.avatarUrl ? (
                            <img
                              src={a.student.avatarUrl}
                              alt={a.student.name}
                              className="h-8 w-8 rounded-full border border-border object-cover"
                            />
                          ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                              {a.student.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="font-medium text-foreground">
                              {a.student.name}
                            </div>
                            {a.student.studentCode && (
                              <div className="text-xs text-muted-foreground tabular-nums">
                                {a.student.studentCode}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">
                        {fmtDateTime(a.startedAt)}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">
                        {fmtDateTime(a.submittedAt)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums font-semibold text-foreground">
                        {a.totalScore !== null && a.totalScore !== undefined
                          ? `${a.totalScore}/${exam.totalPoints}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {a.passed === true ? (
                          <span className="inline-flex rounded-full bg-state-success-soft px-2 py-0.5 text-xs font-semibold text-state-success-ink">
                            Đạt
                          </span>
                        ) : a.passed === false ? (
                          <span className="inline-flex rounded-full bg-state-danger-soft px-2 py-0.5 text-xs font-semibold text-state-danger-ink">
                            Không đạt
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {a.gradedBy?.fullName ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <GradeButton
                          attemptId={a.id}
                          disabled={a.status === "IN_PROGRESS"}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>

      <div className="rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground">
        <strong>Auto-chấm:</strong> chỉ chấm các câu MC/TF/SA. ESSAY/CODE giữ
        điểm thủ công (set qua Prisma Studio hoặc dialog manual grade tương
        lai). Public take-exam UI sẽ tạo ra ExamAttempt qua flow riêng (E4+).
      </div>
    </div>
  );
}
