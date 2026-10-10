// hub-assignments-tab.tsx — Tab "Bài tập & Kiểm tra" của Class Hub (3 mức inline).
//
//   · List:  bài đã giao ở lớp (7 cột) + nút "Giao bài" (AssignDialog khoá 1 lớp).
//   · Detail (?asgId=): roster + tình trạng nộp + điểm; bài đã nộp → "Chấm".
//   · Grade  (?asgId=&subId=): GradeForm (chấm nhanh 0..thang | rubric 6 tiêu chí),
//     TÁI DÙNG gradeSubmission/gradeSubmissionRubric (gate quyền trong action). Chấm
//     xong quay về roster (backHref) để chấm HV kế.
//
// Assignment (Loại B, không centerId) → cách ly qua classId ∈ assignedClassIds
// (guard ở caller + kiểm lại sub.assignment.classId===classId chống IDOR).
// ⚠️ Câu 46: payload client CHỈ tên học viên — KHÔNG SĐT/email/tên PH.
import Link from "next/link";
import { Ban, Eye, FileX2, Library, PencilLine } from "lucide-react";
import type { SubmissionStatus } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { rosterWhere } from "@/lib/enrollment-scope";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "../../_components/ui/empty-state";
import { GradeForm } from "../../cham-bai/_components/grade-form";
import { AssignDialog } from "../../cham-bai/_components/assign-dialog";
import { LateWindowDialog } from "../../cham-bai/_components/late-window-dialog";
import {
  buildAssignmentWindowView,
  loadTeacherAssignData,
  type AssignmentWindowView,
} from "../../cham-bai/_data";
import { resolveTemplateOwnerId } from "../../kho-bai-tap/_owner";
import { BackLink } from "../../_components/ui/back-link";
import { BangPhanTrang } from "@/components/ui/bang-phan-trang";

const SUBMITTED_STATUSES: SubmissionStatus[] = ["SUBMITTED", "LATE", "GRADED"];

/** Màu pill theo trạng thái SUY của cửa nộp (khớp bảng ở /teacher/cham-bai). */
const WINDOW_BADGE: Record<AssignmentWindowView["state"], string> = {
  draft: "border-border bg-muted text-muted-foreground",
  open: "border-state-success-soft bg-state-success-soft text-state-success-ink dark:border-state-success",
  "late-open":
    "border-state-warning-soft bg-state-warning-soft text-state-warning-ink dark:border-state-warning",
  closed: "border-state-info-soft bg-state-info-soft text-state-info-ink dark:border-state-info",
  archived: "border-border bg-muted text-muted-foreground",
};

const SUB_STATUS: Record<SubmissionStatus, { label: string; cls: string }> = {
  NOT_SUBMITTED: { label: "Chưa nộp", cls: "bg-muted text-muted-foreground" },
  SUBMITTED: {
    label: "Đã nộp",
    cls: "bg-state-warning-soft text-state-warning-ink",
  },
  LATE: {
    label: "Nộp muộn",
    cls: "bg-state-warning-soft text-state-warning-ink",
  },
  GRADED: {
    label: "Đã chấm",
    cls: "bg-state-success-soft text-state-success-ink",
  },
};

// Cột "Hạn nộp" dựng ở buildAssignmentWindowView (cham-bai/_data.ts) — dùng chung với
// trang /teacher/cham-bai để hai bảng bài tập không nói khác nhau.
const submitFmt = new Intl.DateTimeFormat("vi-VN", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Ho_Chi_Minh",
});

export async function HubAssignmentsTab({
  actor,
  classId,
  className,
  assignmentId,
  submissionId,
}: {
  actor: Actor;
  classId: string;
  className: string;
  assignmentId?: string;
  submissionId?: string;
}) {
  const sdb = scopedDb(actorGiangDay(actor));

  // ── Grade: chấm 1 bài nộp ────────────────────────────────────────────────────
  if (submissionId) {
    const sub = await sdb.assignmentSubmission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        textAnswer: true,
        fileUrl: true,
        fileName: true,
        fileSize: true,
        // BGĐ 31/07 — bài nộp nhiều file.
        files: {
          select: { id: true, fileUrl: true, fileName: true, fileSize: true },
          orderBy: { createdAt: "asc" },
        },
        score: true,
        feedback: true,
        student: { select: { name: true } }, // câu 46: CHỈ tên HV
        assignment: {
          select: { id: true, title: true, totalPoints: true, classId: true },
        },
      },
    });
    // Guard đọc: bài phải thuộc ĐÚNG lớp đang mở (chống IDOR đổi subId trên URL).
    if (!sub || sub.assignment.classId !== classId) {
      return (
        <div>
          <BackLink
            className="mb-4"
            href={`?classId=${classId}&tab=bai-tap`}
            label="Bài tập & Kiểm tra"
          />
          <EmptyState
            icon={Ban}
            title="Bài nộp không thuộc lớp bạn phụ trách."
          />
        </div>
      );
    }
    const backToDetail = `?classId=${classId}&tab=bai-tap&asgId=${sub.assignment.id}`;
    if (sub.status === "NOT_SUBMITTED") {
      return (
        <div>
          <BackLink
            className="mb-4"
            href={backToDetail}
            label="Chi tiết bài tập"
          />
          <EmptyState
            icon={FileX2}
            title="Học viên chưa nộp bài — chưa thể chấm."
          />
        </div>
      );
    }
    return (
      <div>
        <BackLink
          className="mb-4"
          href={backToDetail}
          label="Chi tiết bài tập"
        />
        <div className="mb-4">
          <h2 className="text-lg font-bold text-foreground">
            Chấm bài — {sub.student.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            {sub.assignment.title} · Lớp {className}
          </p>
        </div>
        <GradeForm
          submissionId={sub.id}
          studentName={sub.student.name}
          totalPoints={sub.assignment.totalPoints}
          submittedAtText={
            sub.submittedAt ? submitFmt.format(sub.submittedAt) : null
          }
          isLate={sub.status === "LATE"}
          graded={sub.status === "GRADED"}
          textAnswer={sub.textAnswer}
          fileUrl={sub.fileUrl}
          fileName={sub.fileName}
          fileSize={sub.fileSize}
          files={sub.files.map((f) => ({
            id: f.id,
            url: f.fileUrl,
            name: f.fileName,
            size: f.fileSize,
          }))}
          initialScore={sub.score}
          initialFeedback={sub.feedback}
          backHref={backToDetail}
        />
      </div>
    );
  }

  // ── Detail: roster + tình trạng nộp ──────────────────────────────────────────
  if (assignmentId) {
    // Roster đọc QUA quan hệ class (đã guard) — enrollment dev centerId=null bị
    // scopedDb lọc nếu query thẳng (pattern cham-bai).
    const asg = await sdb.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        title: true,
        classId: true,
        totalPoints: true,
        class: {
          select: {
            // "ket-khoa" — khớp /teacher/cham-bai. Đây là bản sao THỨ HAI của cùng
            // bảng bài tập; để lệch scope là hai màn in hai mẫu số cho cùng một bài.
            enrollments: {
              where: rosterWhere("ket-khoa"),
              select: { student: { select: { id: true, name: true } } }, // câu 46: chỉ tên
              orderBy: { student: { name: "asc" } },
            },
          },
        },
        submissions: {
          select: { id: true, studentId: true, status: true, score: true },
        },
      },
    });
    if (!asg || asg.classId !== classId) {
      return (
        <div>
          <BackLink
            className="mb-4"
            href={`?classId=${classId}&tab=bai-tap`}
            label="Bài tập & Kiểm tra"
          />
          <EmptyState
            icon={Ban}
            title="Bài tập không thuộc lớp bạn phụ trách."
          />
        </div>
      );
    }
    const roster = asg.class.enrollments;
    const subByStudent = new Map(asg.submissions.map((s) => [s.studentId, s]));
    const submittedCount = asg.submissions.filter((s) =>
      SUBMITTED_STATUSES.includes(s.status),
    ).length;

    return (
      <div>
        <BackLink
          className="mb-4"
          href={`?classId=${classId}&tab=bai-tap`}
          label="Bài tập & Kiểm tra"
        />
        <div className="mb-4">
          <h2 className="text-lg font-bold text-foreground">{asg.title}</h2>
          <p className="text-sm text-muted-foreground">
            Thang điểm {asg.totalPoints} · Đã nộp {submittedCount}/
            {roster.length}
          </p>
        </div>
        <div className="t-card overflow-hidden">
          <BangPhanTrang
            className="pb-3"
            tenDonVi="học viên"
            khoaGhiNho="gv-lop-cham-bai-roster"
            colSpan={4}
            trong="Lớp chưa có học viên đang học."
            tableClassName="min-w-[560px] border-collapse text-left"
            theadClassName="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
            head={
              <tr>
                <th scope="col" className="px-5 py-3">
                  Học viên
                </th>
                <th scope="col" className="px-5 py-3">
                  Tình trạng
                </th>
                <th scope="col" className="px-5 py-3">
                  Điểm
                </th>
                <th scope="col" className="px-5 py-3 text-right">
                  <span className="sr-only">Chấm</span>
                </th>
              </tr>
            }
            rows={roster.map((e) => {
              const sub = subByStudent.get(e.student.id);
              const st = SUB_STATUS[sub?.status ?? "NOT_SUBMITTED"];
              const canGrade =
                sub != null && SUBMITTED_STATUSES.includes(sub.status);
              return (
                <tr
                  key={e.student.id}
                  className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                >
                  <td className="px-5 py-3.5 font-medium text-foreground">
                    {e.student.name}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${st.cls}`}
                    >
                      {st.label}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-foreground">
                    {sub?.score != null ? `${sub.score}/${asg.totalPoints}` : "—"}
                  </td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    {canGrade && sub ? (
                      <Link
                        href={`?classId=${classId}&tab=bai-tap&asgId=${asg.id}&subId=${sub.id}`}
                        className="rounded-sm text-sm font-semibold text-primary-ink outline-none hover:text-primary-ink-hover focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {sub.status === "GRADED" ? "Xem / sửa" : "Chấm"} →
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          />
        </div>
      </div>
    );
  }

  // ── List: bài đã giao ở lớp + Giao bài (popup, parity 18/08) ─────────────────
  const [{ ownerId }, canAuthor, canAssign] = await Promise.all([
    resolveTemplateOwnerId(sdb, actor.userId),
    checkPermission("assignments:author-own"),
    checkPermission("assignments:assign-own", { classId }),
  ]);
  const [assignments, cls, assignData] = await Promise.all([
    sdb.assignment.findMany({
      where: { classId, status: { in: ["PUBLISHED", "CLOSED"] } },
      select: {
        id: true,
        title: true,
        status: true,
        kind: true,
        dueAt: true,
        // 25/08 — cửa nộp bù GV mở: cột "Trạng thái" suy từ (status, dueAt, lateUntil).
        lateUntil: true,
        lateReason: true,
        // Nguồn = AI SOẠN đề (template người khác → "Đào tạo"); templateId != null
        // không đủ vì đề kho GV cũng là template.
        template: { select: { createdById: true } },
        classSession: { select: { date: true, topic: true } },
        _count: {
          select: {
            questions: true,
            submissions: { where: { status: { in: SUBMITTED_STATUSES } } },
          },
        },
      },
      orderBy: { assignedAt: "desc" },
    }),
    sdb.class.findUnique({
      where: { id: classId },
      select: {
        _count: {
          select: {
            enrollments: { where: rosterWhere("ket-khoa") },
          },
        },
      },
    }),
    // Kho + thư viện + buổi học, khoá về đúng lớp đang mở (dialog Giao bài).
    loadTeacherAssignData(sdb, {
      ownerId,
      classIds: [...actor.assignedClassIds],
      lockClassId: classId,
    }),
  ]);
  const rosterCount = cls?._count.enrollments ?? 0;

  const sessionFmt = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  });

  // MỘT mốc `now` cho cả bảng — mỗi dòng tự gọi `new Date()` là hai bài cùng hạn có
  // thể ra hai trạng thái khác nhau khi render rơi đúng phút hạn.
  const now = new Date();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Bài tập về nhà và bài kiểm tra của lớp. Chọn đầu bài từ kho bạn tự
          soạn hoặc thư viện do trung tâm cài sẵn.
        </p>
        {canAssign && (
          <AssignDialog
            classes={assignData.classes}
            sessions={assignData.sessions}
            courses={assignData.courses}
            mine={assignData.mine}
            library={assignData.library}
            canAuthor={canAuthor}
          />
        )}
      </div>

      {/* BangPhanTrang: vùng cuộn ngang ôm RIÊNG cái bảng, thanh phân trang nằm ngoài
          — bọc kiểu cũ thì cuộn sang phải là thanh phân trang trôi mất khỏi màn hình.
          Cột "Nguồn" gộp vào ô Nội dung để chỗ cho cột thao tác mà không tràn ngang. */}
      <div className="t-card overflow-hidden">
        <BangPhanTrang
          className="pb-3"
          tenDonVi="bài"
          khoaGhiNho="gv-lop-bai-tap"
          colSpan={6}
          trong="Chưa giao bài nào cho lớp — bấm “Giao bài” để chọn đầu bài từ thư viện."
          tableClassName="min-w-[720px] border-collapse text-left"
          theadClassName="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          head={
            <tr>
              <th scope="col" className="px-5 py-3">
                Nội dung
              </th>
              <th scope="col" className="px-5 py-3">
                Hình thức
              </th>
              <th scope="col" className="px-5 py-3">
                Hạn nộp
              </th>
              <th scope="col" className="px-5 py-3">
                Đã nộp
              </th>
              <th scope="col" className="px-5 py-3">
                Trạng thái
              </th>
              <th scope="col" className="px-5 py-3 text-right">
                <span className="sr-only">Thao tác</span>
              </th>
            </tr>
          }
          rows={assignments.map((a) => {
            // Cột Hình thức theo KIND (khớp dialog giao + tab kho).
            const isTest = a.kind === "CLASSWORK";
            const fromAdmin =
              a.template != null && a.template.createdById !== ownerId;
            // Trạng thái SUY (25/08): cột `status` đứng nguyên PUBLISHED sau khi quá
            // hạn, nên bảng cũ ghi "Đang mở" cho cả bài hết hạn từ tháng trước.
            const win = buildAssignmentWindowView(a, now);
            return (
              <tr
                key={a.id}
                className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
              >
                <td className="max-w-sm px-5 py-3.5">
                  <p className="font-semibold text-foreground">{a.title}</p>
                  {a.classSession && (
                    <p className="text-xs text-primary-ink">
                      Buổi: {sessionFmt.format(a.classSession.date)} ·{" "}
                      {a.classSession.topic?.trim() || "Buổi học"}
                    </p>
                  )}
                  <span className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    {fromAdmin ? (
                      <>
                        <Library className="h-3.5 w-3.5" aria-hidden /> Đào tạo
                      </>
                    ) : (
                      <>
                        <PencilLine className="h-3.5 w-3.5" aria-hidden /> Tự tạo
                      </>
                    )}
                  </span>
                </td>
                <td className="px-5 py-3.5">
                  {isTest ? (
                    <Badge
                      variant="outline"
                      className="border-primary-soft bg-primary-soft text-primary-ink dark:border-primary"
                    >
                      Kiểm tra
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-state-info-soft bg-state-info-soft text-state-info-ink dark:border-state-info"
                    >
                      Bài tập
                    </Badge>
                  )}
                </td>
                <td className="px-5 py-3.5 whitespace-nowrap text-foreground">
                  {win.dueText ?? "—"}
                  {/* Hạn gốc vẫn là mốc quyết định bài nộp có bị ghi "muộn" hay không,
                      nên cửa nộp bù hiện THÊM chứ không thay chỗ nó. */}
                  {win.lateUntilText && (
                    <p className="text-xs font-semibold text-state-warning-ink">
                      Nộp bù đến {win.lateUntilText}
                    </p>
                  )}
                </td>
                <td className="px-5 py-3.5 whitespace-nowrap font-semibold text-foreground">
                  {a._count.submissions}/{rosterCount}
                </td>
                <td className="px-5 py-3.5 whitespace-nowrap">
                  <Badge variant="outline" className={WINDOW_BADGE[win.state]}>
                    {win.label}
                  </Badge>
                </td>
                <td className="px-5 py-3.5 text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-3">
                    {canAssign && (
                      <LateWindowDialog assignmentId={a.id} title={a.title} win={win} />
                    )}
                    <Link
                      href={`?classId=${classId}&tab=bai-tap&asgId=${a.id}`}
                      className="inline-flex items-center gap-1 rounded-sm text-sm font-semibold text-primary-ink outline-none hover:text-primary-ink-hover focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Eye className="h-4 w-4" aria-hidden />
                      {isTest ? "Chấm điểm" : "Chi tiết"}
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        />
      </div>
    </div>
  );
}
