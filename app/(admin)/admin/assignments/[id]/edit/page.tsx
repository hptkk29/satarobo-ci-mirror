import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import type { Prisma } from "@prisma/client";
import { AssignmentForm, type AssignmentFormValue } from "../../_components/assignment-form";
import { DocumentPicker } from "../../_components/document-picker";
import {
  QuestionBank,
  type AssignmentQuestionData,
} from "../../_components/question-bank";
import {
  SubmissionRow,
  type SubmissionRowData,
} from "../../_components/submission-row";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditAssignmentPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("assignments:edit"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const { id } = await params;

  // Cách ly cơ sở: Assignment KHÔNG nằm trong SCOPED_MODELS (không có centerId trực
  // tiếp) → scopedDb không auto-scope. Scope thủ công qua class.centerId, dùng cùng
  // tầm nhìn cơ sở của model Class. findUnique → findFirst để lọc theo quan hệ;
  // ngoài tầm nhìn → null → notFound() (trang đã xử lý null ở dưới).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const visibleClassCenters = getModelVisibleCenterIds("Class", actor);

  const assignmentWhere: Prisma.AssignmentWhereInput = { id };
  if (visibleClassCenters !== "ALL") {
    assignmentWhere.class = { centerId: { in: visibleClassCenters } };
  }

  const [assignment, classes, lessons, documentBank] = await Promise.all([
    sdb.assignment.findFirst({
      where: assignmentWhere,
      include: {
        documents: {
          include: {
            document: {
              select: {
                id: true,
                title: true,
                fileName: true,
                fileSize: true,
                fileUrl: true,
                type: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        submissions: {
          include: {
            student: {
              select: {
                name: true,
                studentCode: true,
                parentPhone: true,
                phone: true,
              },
            },
            gradedBy: { select: { fullName: true } },
            // BGĐ 31/07 — HV nộp NHIỀU file: phải lấy đủ danh sách (cột đơn fileUrl
            // chỉ là file ĐẦU — người chấm từng thấy 1/N file, chấm thiếu).
            files: {
              select: { id: true, fileUrl: true, fileName: true, fileSize: true },
              orderBy: { createdAt: "asc" },
            },
          },
          orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        },
        questions: {
          include: {
            choices: { orderBy: { order: "asc" } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    sdb.class.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, classCode: true },
      take: 200,
    }),
    // Lesson/Document = học liệu toàn cục (không center-scope) → sdb pass-through.
    sdb.lesson.findMany({
      where: { curriculum: { isActive: true } },
      include: { curriculum: { select: { name: true } } },
      orderBy: [{ curriculumId: "asc" }, { order: "asc" }],
      take: 500,
    }),
    sdb.document.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        fileName: true,
        fileSize: true,
        fileUrl: true,
        type: true,
      },
      take: 500,
    }),
  ]);

  if (!assignment) notFound();

  const formValue: AssignmentFormValue = {
    id: assignment.id,
    title: assignment.title,
    kind: assignment.kind,
    description: assignment.description,
    instructions: assignment.instructions,
    classId: assignment.classId,
    lessonId: assignment.lessonId,
    totalPoints: assignment.totalPoints,
    dueAt: assignment.dueAt,
    allowText: assignment.allowText,
    allowFile: assignment.allowFile,
    status: assignment.status,
  };

  const attached = assignment.documents.map((ad) => ({
    id: ad.id,
    documentId: ad.documentId,
    title: ad.document.title,
    fileName: ad.document.fileName,
    fileSize: ad.document.fileSize,
    fileUrl: ad.document.fileUrl,
    type: ad.document.type,
  }));

  const questions: AssignmentQuestionData[] = assignment.questions.map((q) => ({
    id: q.id,
    type: q.type,
    text: q.text,
    correctAnswer: q.correctAnswer,
    choices: q.choices.map((c) => ({
      text: c.text,
      isCorrect: c.isCorrect,
      order: c.order,
    })),
  }));

  const submissions: SubmissionRowData[] = assignment.submissions.map((s) => ({
    id: s.id,
    status: s.status,
    textAnswer: s.textAnswer,
    fileUrl: s.fileUrl,
    fileName: s.fileName,
    fileSize: s.fileSize,
    mimeType: s.mimeType,
    files: s.files.map((f) => ({
      id: f.id,
      url: f.fileUrl,
      name: f.fileName,
      size: f.fileSize,
    })),
    submittedAt: s.submittedAt,
    score: s.score,
    feedback: s.feedback,
    gradedAt: s.gradedAt,
    studentName: s.student.name,
    studentCode: s.student.studentCode,
    studentParentPhone: s.student.parentPhone ?? s.student.phone,
    totalPoints: assignment.totalPoints,
    gradedByName: s.gradedBy?.fullName ?? null,
  }));

  const submittedTotal = submissions.filter(
    (s) => s.status === "SUBMITTED" || s.status === "LATE" || s.status === "GRADED",
  ).length;
  const gradedTotal = submissions.filter((s) => s.status === "GRADED").length;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/assignments"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="text-2xl font-bold text-foreground">
          Sửa bài tập:{" "}
          <span className="font-bold text-primary">{assignment.title}</span>
        </h1>
      </div>

      <AssignmentForm
        assignment={formValue}
        classes={classes}
        lessons={lessons.map((l) => ({
          id: l.id,
          order: l.order,
          title: l.title,
          curriculumName: l.curriculum.name,
        }))}
      />

      <DocumentPicker
        assignmentId={assignment.id}
        documentBank={documentBank}
        initialAttached={attached}
      />

      <QuestionBank assignmentId={assignment.id} questions={questions} />

      {assignment.status !== "DRAFT" && (
        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border p-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Bài nộp của học viên ({submissions.length})
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {submittedTotal > 0
                ? `Đã nộp ${submittedTotal}/${submissions.length} · Đã chấm ${gradedTotal}`
                : "Chưa có HS nào nộp bài."}
            </p>
          </header>
          {submissions.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Chưa có bản nộp bài nào. Cần publish trước để hệ thống tự tạo
              bản nộp rỗng cho HS đang học.
            </div>
          ) : (
            <PhanTrangBang cuonNgang>
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Học viên
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Trạng thái
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Nộp lúc
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Nội dung
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Điểm
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Nhận xét
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Hành động
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {submissions.map((s) => (
                    <SubmissionRow key={s.id} row={s} />
                  ))}
                </tbody>
              </table>
            </PhanTrangBang>
          )}
        </section>
      )}

      {assignment.status === "DRAFT" && (
        <div className="rounded-lg border border-state-warning-soft bg-state-warning-soft p-4 text-sm text-state-warning-ink">
          <strong>DRAFT:</strong> Hệ thống chưa tạo bản nộp bài cho HS.
          Bấm <strong>Publish</strong> ở trên để mở cho lớp.
        </div>
      )}
    </div>
  );
}
