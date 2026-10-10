// app/(teacher)/teacher/cham-bai/page.tsx — "Bài tập & kiểm tra" (route giữ /cham-bai).
//
// Parity site GV 18/08 — trang chính 3 TAB (port satarobo-ui-giaovien assignments/page):
//   · Bài đã giao         — bảng bài ở lớp mình + popup "Giao bài" (AssignDialog).
//   · Kho bài tập của tôi — AssignmentBankPanel (soạn 8 loại câu hỏi, sửa, xoá, preview).
//   · Thư viện admin      — mẫu trung tâm cài sẵn (đọc-only + xem nhanh).
// Mức sâu giữ nguyên qua searchParams:
//   (b) ?assignmentId=…   → chi tiết 1 bài: roster + tình trạng nộp + link chấm.
//   (c) ?submissionId=…   → nội dung bài nộp + GradeForm (chấm nhanh | chấm rubric).
//   (d) ?compose=giao     → CŨ (full page) — nay redirect về trang chính (dialog).
//
// Data: Assignment (Loại B, không centerId) → cách ly qua classId ∈ assignedClassIds.
// AssignmentSubmission tương tự (guard theo assignment.classId). Action chấm TÁI DÙNG
// gradeSubmission/gradeSubmissionRubric của admin (gate bên trong: requireRole +
// classCenterVisible + canGradeClassWork — GV chỉ chấm lớp mình phụ trách).
// ⚠️ Câu 46: payload client CHỈ tên học viên — KHÔNG SĐT/email/tên PH.
import { redirect } from "next/navigation";
import Link from "next/link";
import type { SubmissionStatus } from "@prisma/client";
import { Ban, FileX2 } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { rosterWhere } from "@/lib/enrollment-scope";
import { PageHeader } from "../_components/ui/page-header";
import { EmptyState } from "../_components/ui/empty-state";
import { GradeForm } from "./_components/grade-form";
import { type AssignmentRow } from "./_components/assignment-list";
import { AssignmentsTabs } from "./_components/assignments-tabs";
import { BatchGrade } from "./_components/batch-grade";
import { resolveTemplateOwnerId } from "../kho-bai-tap/_owner";
import { buildAssignmentWindowView, loadTeacherAssignData } from "./_data";
import { BackLink } from "../_components/ui/back-link";
import { BangPhanTrang } from "@/components/ui/bang-phan-trang";

export const metadata = { title: "Bài tập & kiểm tra | Giáo viên Sata Robo" };

/** Trạng thái nộp được tính là "đã nộp" (khớp computeAssignmentSummary phía home). */
const SUBMITTED_STATUSES: SubmissionStatus[] = ["SUBMITTED", "LATE", "GRADED"];

const submitFmt = new Intl.DateTimeFormat("vi-VN", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  // NĂM là bắt buộc: bài nộp có thể thuộc lớp khoá trước, mà "20:00 Thứ 5, 27/08"
  // không nói được năm nào — giáo viên chấm bù cuối khoá đọc ra một mốc mơ hồ
  // (QA vòng 1, BUG-020).
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Ho_Chi_Minh",
});
// Cột "Hạn nộp" + pill trạng thái nay dựng ở buildAssignmentWindowView (_data.ts) —
// dùng chung với tab Bài tập của Class Hub để hai màn không nói khác nhau.

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

export default async function TeacherAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    assignmentId?: string;
    submissionId?: string;
    compose?: string;
    lockClassId?: string;
    back?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate

  const { assignmentId, submissionId, compose, lockClassId, back } =
    await searchParams;
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));
  const classIds = [...actor.assignedClassIds];

  // ── (c) Chấm 1 bài nộp ───────────────────────────────────────────────────────
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
        student: { select: { name: true } }, // câu 46: CHỈ tên HV, KHÔNG contact PH
        assignment: {
          select: {
            id: true,
            title: true,
            totalPoints: true,
            classId: true,
            class: { select: { name: true } },
          },
        },
      },
    });

    // Guard đọc TRƯỚC khi render: bài phải thuộc lớp mình được phân — chống IDOR
    // đổi submissionId trên URL (action đã tự gate lần nữa khi ghi).
    if (!sub || !actor.assignedClassIds.has(sub.assignment.classId)) {
      return <NotYours />;
    }

    if (sub.status === "NOT_SUBMITTED") {
      return (
        <div>
          <BackLink
            className="mb-4"
            href={`?assignmentId=${sub.assignment.id}`}
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
          href={`?assignmentId=${sub.assignment.id}`}
          label="Chi tiết bài tập"
        />
        <PageHeader
          title={`Chấm bài — ${sub.student.name}`}
          subtitle={`${sub.assignment.title} · Lớp ${sub.assignment.class.name}`}
        />
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
        />
      </div>
    );
  }

  // ── (b) Chi tiết 1 bài: roster + tình trạng nộp ──────────────────────────────
  if (assignmentId) {
    // Roster đọc QUA quan hệ class (đã guard assignedClassIds) thay vì query
    // Enrollment trực tiếp: enrollment dev có centerId=null → scopedDb lọc mất khi
    // truy vấn thẳng; đọc qua class (đã thuộc actor) khớp cách _count đếm ở mức (a).
    const asg = await sdb.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        title: true,
        classId: true,
        totalPoints: true,
        kind: true, // CLASSWORK/HOMEWORK — cùng _count.questions xác định isTest
        class: {
          select: {
            name: true,
            // "ket-khoa" chứ KHÔNG phải "dang-hoc": bài tập là bản ghi của QUÁ KHỨ.
            // Lọc theo ghi danh đang hoạt động thì lớp đã kết khoá (mọi em COMPLETED)
            // cho roster RỖNG ⇒ tiêu đề in "Đã nộp 2/0" và bảng ra empty state "Lớp
            // chưa có học viên đang học" trong khi bài nộp vẫn còn chờ chấm và server
            // action vẫn cho phép chấm — giáo viên không mở được bài nào
            // (QA vòng 1, BUG-025). Ba tầng lọc đi qua rosterWhere, đừng viết tay.
            enrollments: {
              where: rosterWhere("ket-khoa"),
              select: { student: { select: { id: true, name: true } } }, // câu 46: chỉ tên HV
              orderBy: { student: { name: "asc" } },
            },
          },
        },
        submissions: {
          select: {
            id: true,
            studentId: true,
            status: true,
            score: true,
          },
        },
        _count: { select: { questions: true } }, // >0 → hình thức "Kiểm tra"
      },
    });
    if (!asg || !actor.assignedClassIds.has(asg.classId)) return <NotYours />;

    // Roster active của lớp + ghép bài nộp (HV chưa nộp vẫn hiện "Chưa nộp").
    const roster = asg.class.enrollments;
    const subByStudent = new Map(asg.submissions.map((s) => [s.studentId, s]));
    const submittedCount = asg.submissions.filter((s) =>
      SUBMITTED_STATUSES.includes(s.status),
    ).length;

    // Bài "Kiểm tra" (có câu hỏi online HOẶC bài trên lớp CLASSWORK) → cho chấm cả lớp
    // (HV kiểm tra offline không nộp online). Bài tập về nhà (HOMEWORK) chấm theo bài nộp.
    const isTest = asg._count.questions > 0 || asg.kind === "CLASSWORK";
    const batchRoster = roster.map((e) => ({
      studentId: e.student.id,
      name: e.student.name, // câu 46: chỉ tên HV
      score: subByStudent.get(e.student.id)?.score ?? null,
    }));

    return (
      <div>
        <BackLink className="mb-4" href="?" label="Bài tập & kiểm tra" />
        <PageHeader
          title={asg.title}
          subtitle={`Lớp ${asg.class.name} · Thang điểm ${asg.totalPoints} · Đã nộp ${submittedCount}/${roster.length}`}
          actions={
            isTest ? (
              <BatchGrade
                assignmentId={asg.id}
                totalPoints={asg.totalPoints}
                roster={batchRoster}
              />
            ) : undefined
          }
        />
        {/* BangPhanTrang: vùng cuộn ngang ôm RIÊNG cái bảng, thanh phân trang nằm
            ngoài — bọc kiểu cũ thì cuộn sang phải là thanh phân trang trôi mất. */}
        <div className="t-card overflow-hidden">
          <BangPhanTrang
            className="pb-3"
            tenDonVi="học viên"
            khoaGhiNho="gv-cham-bai-roster"
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
                        href={`?submissionId=${sub.id}`}
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

  // ── (d) ?compose=giao — luồng full-page CŨ, nay giao bài bằng popup ở trang chính.
  // Giữ redirect để link cũ (bookmark, hub bản trước) không chết.
  if (compose === "giao") {
    const backHref =
      back && back.startsWith("/teacher/") ? back : "/teacher/cham-bai";
    void lockClassId;
    redirect(backHref);
  }

  // ── (a) Trang chính 3 tab (parity assignments/page.tsx của bản mock) ─────────
  const [{ ownerId }, canAuthor, canAssign] = await Promise.all([
    resolveTemplateOwnerId(sdb, session.user.id),
    checkPermission("assignments:author-own"),
    checkPermission("assignments:assign-own"),
  ]);

  const [assignments, classCounts, data] = await Promise.all([
    classIds.length
      ? sdb.assignment.findMany({
          where: {
            classId: { in: classIds },
            status: { in: ["PUBLISHED", "CLOSED"] },
          },
          select: {
            id: true,
            title: true,
            description: true,
            classId: true,
            status: true,
            kind: true,
            dueAt: true,
            // 25/08 — cửa nộp bù GV mở: cột "Trạng thái" suy từ (status, dueAt, lateUntil).
            lateUntil: true,
            lateReason: true,
            // Nguồn = AI SOẠN đề: template của người khác → "Admin"; của mình/không
            // template → "Tự tạo" (templateId != null không đủ — kho GV cũng là template).
            template: { select: { createdById: true } },
            classSession: { select: { date: true, topic: true } },
            class: { select: { name: true } },
            _count: {
              select: {
                questions: true, // >0 → hình thức "Kiểm tra"
                submissions: { where: { status: { in: SUBMITTED_STATUSES } } },
              },
            },
          },
          orderBy: { assignedAt: "desc" },
        })
      : Promise.resolve([]),
    // Sĩ số (mẫu số cột "Đã nộp") = số HV đang học của lớp.
    classIds.length
      ? sdb.class.findMany({
          where: { id: { in: classIds } },
          select: {
            id: true,
            // Mẫu số cột "Đã nộp" phải CÙNG MỘT TẬP với roster của màn chi tiết
            // (rosterWhere("ket-khoa")), nếu không thì danh sách in "2/0" còn màn chi
            // tiết lại liệt kê 2 em — hai con số chọi nhau cho cùng một bài
            // (QA vòng 1, BUG-025).
            _count: {
              select: { enrollments: { where: rosterWhere("ket-khoa") } },
            },
          },
        })
      : Promise.resolve([]),
    loadTeacherAssignData(sdb, { ownerId, classIds }),
  ]);
  const enrollBy = new Map(
    classCounts.map((c) => [c.id, c._count.enrollments]),
  );

  const sessionFmt = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  });

  // MỘT mốc `now` cho cả bảng — mỗi dòng tự gọi `new Date()` là bảng có thể vừa
  // "Đang mở" vừa "Đã đóng" cho hai bài cùng hạn khi render rơi đúng phút hạn.
  const now = new Date();

  const rows: AssignmentRow[] = assignments.map((a) => {
    // Hạn nộp + trạng thái + dữ liệu dialog gia hạn (guard dueAt epoch 1970 nằm trong).
    const win = buildAssignmentWindowView(a, now);
    return {
      id: a.id,
      title: a.title,
      classId: a.classId,
      className: a.class.name,
      // Cột Hình thức theo KIND (khớp lựa chọn khi giao + tab kho); logic BatchGrade
      // mức (b) vẫn tự cộng thêm điều-kiện-có-câu-hỏi, không đổi.
      isTest: a.kind === "CLASSWORK",
      fromAdmin: a.template != null && a.template.createdById !== ownerId,
      sessionLabel: a.classSession
        ? `${sessionFmt.format(a.classSession.date)} · ${a.classSession.topic?.trim() || "Buổi học"}`
        : null,
      description: a.description?.trim() || null,
      submitted: a._count.submissions,
      total: enrollBy.get(a.classId) ?? 0,
      // Không có quyền giao bài thì tắt luôn nút gia hạn: bấm vào cũng chỉ ăn lỗi
      // "Không có quyền" từ action. (Cờ đi kèm dữ liệu vì AssignmentsTabs không
      // chuyền prop xuống AssignmentList.)
      win: canAssign ? win : { ...win, canExtend: false },
    };
  });

  return (
    <div>
      <PageHeader
        title="Bài tập & kiểm tra"
        subtitle="Bài đã giao ở các lớp bạn phụ trách và kho đầu bài bạn tự soạn."
      />
      {/* GV chưa có lớp VẪN vào được tab "Kho bài tập của tôi" (soạn đề trước) —
          tab Bài đã giao tự hiện trạng thái rỗng, nút Giao bài tự ẩn (0 lớp). */}
      <AssignmentsTabs
        rows={rows}
        data={data}
        canAuthor={canAuthor}
        canAssign={canAssign}
      />
    </div>
  );
}

function NotYours() {
  return (
    <div>
      <BackLink className="mb-4" href="?" label="Bài tập & kiểm tra" />
      <EmptyState icon={Ban} title="Bài tập không thuộc lớp bạn phụ trách." />
    </div>
  );
}
