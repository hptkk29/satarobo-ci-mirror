import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRightLeft, ChevronLeft, ClipboardList, History } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission, checkPermissionDetail } from "@/lib/auth/check-permission";
import { maskPhone } from "@/lib/utils";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { ChangeStatusDialog } from "../../_components/change-status-dialog";
import { TransferDialog } from "../../_components/transfer-dialog";
import { formatDateVN } from "@/lib/format/date";

export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = new Set([
  "COMPLETED",
  "WITHDREW",
  "TRANSFERRED",
  "CANCELLED",
]);
const CAPACITY_COUNT_STATUSES = ["PENDING", "CONFIRMED", "STUDYING", "ACTIVE"];

const STATUS_INFO: Record<string, { label: string; color: string }> = {
  PENDING: { label: "Chờ xếp", color: "bg-muted text-foreground" },
  CONFIRMED: { label: "Đã xếp", color: "bg-state-warning-soft text-state-warning-ink" },
  STUDYING: { label: "Đang học", color: "bg-state-success-soft text-state-success-ink" },
  PAUSED: { label: "Bảo lưu", color: "bg-state-warning-soft text-state-warning-ink" },
  COMPLETED: { label: "Hoàn thành", color: "bg-state-info-soft text-state-info-ink" },
  WITHDREW: { label: "Đã rút", color: "bg-state-danger-soft text-state-danger-ink" },
  TRANSFERRED: { label: "Đã chuyển", color: "bg-primary-soft text-primary" },
  ACTIVE: { label: "Đang học (legacy)", color: "bg-state-success-soft text-state-success-ink" },
  CANCELLED: { label: "Đã huỷ", color: "bg-state-danger-soft text-state-danger-ink" },
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

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return formatDateVN(d);
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditEnrollmentPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("enrollments:edit"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const { id } = await params;
  const canViewAudit = await checkPermission("audit-logs:view");
  // US-03 (TS-02): DENY cấp trường từ grant nhóm — che parentPhone ở card học viên
  // (đồng nhất với trang /students và list /enrollments).
  const { fieldMask } = await checkPermissionDetail("students:view-all");
  const phoneMasked = fieldMask.includes("parentPhone");

  // Cách ly cơ sở: Enrollment NAY ∈ SCOPED_MODELS (FL3-02) → sdb.findUnique tự
  // IDOR-filter theo centerId denormalized; check thủ công qua class.centerId
  // bên dưới GIỮ làm lớp phòng thủ kép. targetClasses đọc qua sdb (auto-scope).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const visibleClassCenters = getModelVisibleCenterIds("Class", actor);

  const enrollment = await sdb.enrollment.findUnique({
    where: { id },
    // ⚠️ select kèm centerId — findUnique trên model scoped lọc hậu kỳ theo field này
    // (thiếu → passesScope fail → ẩn nhầm record hợp lệ với actor center-scope).
    select: {
      id: true,
      centerId: true,
      status: true,
      notes: true,
      enrolledAt: true,
      confirmedAt: true,
      startedAt: true,
      endedAt: true,
      transferReason: true,
      transferredToId: true,
      student: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          studentCode: true,
          parentName: true,
          parentPhone: true,
          phone: true,
        },
      },
      class: {
        select: {
          id: true,
          centerId: true,
          name: true,
          classCode: true,
          status: true,
          startDate: true,
          scheduleDays: true,
          startTime: true,
          endTime: true,
          center: { select: { name: true } },
          room: { select: { code: true } },
          course: { select: { name: true } },
          teacher: { select: { name: true } },
        },
      },
    },
  });
  if (!enrollment) notFound();

  // Cách ly cơ sở (chống IDOR): enrollment của cơ sở ngoài tầm nhìn → 404.
  if (
    visibleClassCenters !== "ALL" &&
    (enrollment.class.centerId == null ||
      !visibleClassCenters.includes(enrollment.class.centerId))
  ) {
    notFound();
  }

  const isTerminal = TERMINAL_STATUSES.has(enrollment.status);
  const statusInfo =
    STATUS_INFO[enrollment.status] ?? {
      label: enrollment.status,
      color: "bg-muted text-muted-foreground",
    };

  const [targetClasses, auditLogs] = await Promise.all([
    sdb.class.findMany({
      where: {
        deletedAt: null,
        id: { not: enrollment.class.id },
        status: { in: ["PLANNED", "RECRUITING", "ACTIVE"] },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        classCode: true,
        status: true,
        maxStudents: true,
        center: { select: { name: true } },
        _count: {
          select: {
            enrollments: {
              where: { status: { in: CAPACITY_COUNT_STATUSES as never[] } },
            },
          },
        },
      },
      take: 200,
    }),
    canViewAudit
      ? sdb.enrollmentAuditLog.findMany({
          where: { enrollmentId: id },
          orderBy: { createdAt: "desc" },
          take: 30,
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            changedByName: true,
            reason: true,
            extraData: true,
            createdAt: true,
          },
        })
      : Promise.resolve([] as never[]),
  ]);

  const scheduleDaysText = enrollment.class.scheduleDays?.length
    ? enrollment.class.scheduleDays
        .slice()
        .sort((a, b) => a - b)
        .map((d) => ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][d])
        .join(" · ")
    : "—";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/enrollments"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <ClipboardList className="h-6 w-6 text-primary" />
            Đăng ký: {enrollment.student.name}
          </h1>
          <span
            className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${statusInfo.color}`}
          >
            {statusInfo.label}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Student card */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Học viên
          </h2>
          <div className="flex items-start gap-3">
            {enrollment.student.avatarUrl ? (
              <img
                src={enrollment.student.avatarUrl}
                alt={enrollment.student.name}
                className="h-14 w-14 rounded-full border border-border object-cover"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-lg font-bold text-muted-foreground">
                {enrollment.student.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              <div className="text-lg font-bold text-foreground">
                {enrollment.student.name}
              </div>
              {enrollment.student.studentCode && (
                <div className="text-xs text-muted-foreground tabular-nums">
                  {enrollment.student.studentCode}
                </div>
              )}
              {enrollment.student.parentName && (
                <div className="mt-1 text-sm text-foreground">
                  PH: {enrollment.student.parentName}
                  {enrollment.student.parentPhone &&
                    ` · ${
                      phoneMasked
                        ? maskPhone(enrollment.student.parentPhone)
                        : enrollment.student.parentPhone
                    }`}
                </div>
              )}
              <Link
                href={`/students/${enrollment.student.id}/edit`}
                className="mt-2 inline-block text-xs font-semibold text-primary hover:underline"
              >
                Mở hồ sơ học viên →
              </Link>
            </div>
          </div>
        </section>

        {/* Class card */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Lớp học
          </h2>
          <div className="text-lg font-bold text-foreground">
            {enrollment.class.name}
          </div>
          {enrollment.class.classCode && (
            <div className="text-xs text-muted-foreground tabular-nums">
              {enrollment.class.classCode}
            </div>
          )}
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Khoá</dt>
            <dd className="text-foreground">{enrollment.class.course.name}</dd>
            <dt className="text-muted-foreground">Cơ sở</dt>
            <dd className="text-foreground">
              {enrollment.class.center?.name ?? "—"}
              {enrollment.class.room?.code &&
                ` · P. ${enrollment.class.room.code}`}
            </dd>
            <dt className="text-muted-foreground">GV chính</dt>
            <dd className="text-foreground">
              {enrollment.class.teacher?.name ?? "—"}
            </dd>
            <dt className="text-muted-foreground">Lịch</dt>
            <dd className="text-foreground">
              {scheduleDaysText}
              {enrollment.class.startTime && enrollment.class.endTime
                ? ` · ${enrollment.class.startTime}–${enrollment.class.endTime}`
                : ""}
            </dd>
            <dt className="text-muted-foreground">Khai giảng</dt>
            <dd className="text-foreground">{fmtDate(enrollment.class.startDate)}</dd>
          </dl>
          <Link
            href={`/classes/${enrollment.class.id}/edit`}
            className="mt-3 inline-block text-xs font-semibold text-primary hover:underline"
          >
            Mở chi tiết lớp →
          </Link>
        </section>
      </div>

      {/* Timeline */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Mốc thời gian
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 text-sm">
          <dt className="text-muted-foreground">Ngày đăng ký</dt>
          <dd className="text-foreground tabular-nums">
            {fmtDateTime(enrollment.enrolledAt)}
          </dd>
          <dt className="text-muted-foreground">Xác nhận xếp lớp</dt>
          <dd className="text-foreground tabular-nums">
            {fmtDateTime(enrollment.confirmedAt)}
          </dd>
          <dt className="text-muted-foreground">Bắt đầu học</dt>
          <dd className="text-foreground tabular-nums">
            {fmtDateTime(enrollment.startedAt)}
          </dd>
          <dt className="text-muted-foreground">Kết thúc</dt>
          <dd className="text-foreground tabular-nums">
            {fmtDateTime(enrollment.endedAt)}
          </dd>
        </dl>
        {enrollment.transferReason && (
          <div className="mt-3 rounded-lg border border-primary-soft bg-primary-soft p-3 text-sm">
            <div className="flex items-center gap-1 font-semibold text-primary">
              <ArrowRightLeft className="h-4 w-4" /> Đã chuyển lớp
            </div>
            <div className="mt-1 text-primary">
              Lý do: {enrollment.transferReason}
            </div>
            {enrollment.transferredToId && (
              <Link
                href={`/enrollments/${enrollment.transferredToId}/edit`}
                className="mt-1 inline-block text-xs font-semibold text-primary hover:underline"
              >
                Mở enrollment mới →
              </Link>
            )}
          </div>
        )}
        {enrollment.notes && (
          <div className="mt-3 rounded-lg border border-border bg-muted p-3 text-sm text-foreground">
            <strong className="text-foreground">Ghi chú:</strong> {enrollment.notes}
          </div>
        )}
      </section>

      {/* Actions */}
      {!isTerminal ? (
        <section className="flex flex-wrap gap-3">
          <ChangeStatusDialog
            enrollmentId={enrollment.id}
            currentStatus={enrollment.status}
            studentName={enrollment.student.name}
          />
          <TransferDialog
            enrollmentId={enrollment.id}
            currentClassId={enrollment.class.id}
            studentName={enrollment.student.name}
            targetClasses={targetClasses.map((c) => ({
              id: c.id,
              classCode: c.classCode,
              name: c.name,
              status: c.status,
              maxStudents: c.maxStudents,
              enrolledCount: c._count.enrollments,
              centerName: c.center?.name ?? null,
            }))}
          />
        </section>
      ) : (
        <section className="rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
          Enrollment đã ở trạng thái cuối ({statusInfo.label}) — không thể đổi
          trạng thái hoặc chuyển lớp.
        </section>
      )}

      {/* Audit log */}
      {canViewAudit && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <History className="h-4 w-4" />
            Audit log ({auditLogs.length})
          </h2>
          {auditLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có thay đổi nào được log.</p>
          ) : (
            <ul className="divide-y divide-border">
              {auditLogs.map((log) => {
                const fromLabel =
                  STATUS_INFO[log.fromStatus]?.label ?? log.fromStatus;
                const toLabel =
                  STATUS_INFO[log.toStatus]?.label ?? log.toStatus;
                const extra = log.extraData as Record<string, unknown> | null;
                return (
                  <li key={log.id} className="py-3 text-sm">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-semibold text-foreground">
                        {fromLabel} → {toLabel}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {fmtDateTime(log.createdAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      bởi <strong>{log.changedByName}</strong>
                    </div>
                    {log.reason && (
                      <div className="mt-1 text-sm text-foreground">
                        “{log.reason}”
                      </div>
                    )}
                    {extra && typeof extra === "object" && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {typeof extra.transferredToId === "string" && (
                          <>
                            → Enrollment đích:{" "}
                            <Link
                              href={`/enrollments/${extra.transferredToId}/edit`}
                              className="font-mono text-primary hover:underline"
                            >
                              {String(extra.transferredToId).slice(0, 12)}…
                            </Link>
                          </>
                        )}
                        {typeof extra.transferredFromId === "string" && (
                          <>
                            ← Enrollment gốc:{" "}
                            <Link
                              href={`/enrollments/${extra.transferredFromId}/edit`}
                              className="font-mono text-primary hover:underline"
                            >
                              {String(extra.transferredFromId).slice(0, 12)}…
                            </Link>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
