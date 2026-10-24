import { createElement, type ReactElement } from "react";
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getStudentProgress } from "@/lib/progress";
import { withFreshFonts } from "@/lib/pdf/brand";
import {
  ProgressReportPdf,
  type ProgressReportData,
} from "@/lib/pdf/progress-report";
import { checkPermission } from "@/lib/auth/check-permission";
import { chanXuat } from "@/lib/export/chan-xuat";

export const dynamic = "force-dynamic";
// PDF generation needs Node APIs (fs for font loading); pin runtime.
export const runtime = "nodejs";

const DAY_LABELS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function safeFilename(s: string): string {
  // Strip diacritics + spaces for HTTP-header-safe filename
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .replace(/_+/g, "_");
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await checkPermission("students:view-all"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Cổng VAI (chốt 27/09/2026): danh sách vai giao ở Cấu hình vận hành → Quyền xuất
  // dữ liệu. Cộng dồn với cổng đọc ngay trên, KHÔNG thay nó.
  const chan = await chanXuat("tien-do-hoc-vien", session);
  if (chan) return chan;


  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { studentId, classId } =
    (body as { studentId?: string; classId?: string }) ?? {};
  if (!studentId || !classId) {
    return NextResponse.json(
      { error: "Thiếu studentId hoặc classId" },
      { status: 400 },
    );
  }

  // Cách ly cơ sở: Student/Class ∈ SCOPED_MODELS → sdb tự inject centerId; HV/lớp cơ sở
  // khác → null → 404 (CM không xuất PDF tiến độ chéo cơ sở). Submission/Attempt phía
  // dưới đã ràng theo studentId + classId vừa xác minh trong scope.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const [student, cls] = await Promise.all([
    sdb.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: {
        id: true,
        name: true,
        studentCode: true,
        dateOfBirth: true,
        currentGrade: true,
        school: true,
        parentName: true,
        parentPhone: true,
        phone: true,
      },
    }),
    sdb.class.findFirst({
      where: { id: classId, deletedAt: null },
      include: {
        course: { select: { name: true } },
        center: { select: { name: true } },
        teacher: { select: { name: true } },
      },
    }),
  ]);

  if (!student) {
    return NextResponse.json({ error: "Không tìm thấy học viên" }, { status: 404 });
  }
  if (!cls) {
    return NextResponse.json({ error: "Không tìm thấy lớp" }, { status: 404 });
  }

  // Format schedule string from D3 fields.
  const days = (cls.scheduleDays ?? [])
    .slice()
    .sort((a, b) => a - b)
    .map((d) => DAY_LABELS[d] ?? "")
    .filter(Boolean)
    .join(" · ");
  const time =
    cls.startTime && cls.endTime ? `${cls.startTime}–${cls.endTime}` : "";
  const schedule = [days, time].filter(Boolean).join(" ") || "—";

  const [progress, submissions, attempts] = await Promise.all([
    getStudentProgress(studentId, classId),
    sdb.assignmentSubmission.findMany({
      where: { studentId, assignment: { classId } },
      include: { assignment: { select: { title: true, totalPoints: true } } },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    sdb.examAttempt.findMany({
      where: { studentId, exam: { classId } },
      include: { exam: { select: { title: true } } },
      orderBy: [{ submittedAt: "desc" }, { startedAt: "desc" }],
      take: 5,
    }),
  ]);

  const reportData: ProgressReportData = {
    generatedAt: new Date(),
    student: {
      name: student.name,
      studentCode: student.studentCode,
      dateOfBirth: student.dateOfBirth,
      currentGrade: student.currentGrade,
      school: student.school,
      parentName: student.parentName ?? "—",
      parentPhone: student.parentPhone ?? student.phone ?? "—",
    },
    class: {
      name: cls.name,
      classCode: cls.classCode,
      courseName: cls.course.name,
      centerName: cls.center?.name ?? "—",
      teacherName: cls.teacher?.name ?? null,
      schedule,
      startDate: cls.startDate,
    },
    progress: {
      totalSessions: progress.totalSessions,
      attendedSessions: progress.attendedSessions,
      attendanceRate: progress.attendanceRate,
      totalLessons: progress.totalLessons,
      coveredLessons: progress.coveredLessons,
      lessonCoverageRate: progress.lessonCoverageRate,
      totalAssignments: progress.totalAssignments,
      submittedAssignments: progress.submittedAssignments,
      averageScore: progress.averageScore,
    },
    recentAssignments: submissions.map((s) => ({
      title: s.assignment.title,
      submittedAt: s.submittedAt,
      status: s.status,
      score: s.score,
      totalPoints: s.assignment.totalPoints,
    })),
    recentExams: attempts.map((a) => ({
      title: a.exam.title,
      submittedAt: a.submittedAt,
      totalScore: a.totalScore,
      passed: a.passed,
    })),
  };

  let pdfBuffer: Buffer;
  try {
    // ProgressReportPdf returns a <Document>; renderToBuffer's typing only
    // accepts ReactElement<DocumentProps>, so cast through the function-
    // component element since TS can't infer the JSX return.
    pdfBuffer = await withFreshFonts(() =>
      renderToBuffer(
        createElement(ProgressReportPdf, {
          data: reportData,
        }) as unknown as ReactElement<DocumentProps>,
      ),
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: `Lỗi tạo PDF: ${err instanceof Error ? err.message : "Unknown"}`,
      },
      { status: 500 },
    );
  }

  // Audit log — store snapshot of progress metrics for historical reference.
  try {
    let generatedById: string | null = null;
    if (session.user.id) {
      const u = await sdb.user.findUnique({
        where: { id: session.user.id },
        select: { employeeId: true },
      });
      generatedById = u?.employeeId ?? null;
    }
    await sdb.progressReportLog.create({
      data: {
        studentId,
        classId,
        generatedById,
        reportTitle: `Báo cáo tiến độ — ${student.name} — ${cls.name}`,
        metadata: { progress: reportData.progress as unknown as object },
      },
    });
  } catch {
    // Audit log failure shouldn't block the user from getting the PDF
    // they just generated; log silently.
  }

  const safeStudent = safeFilename(student.name);
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `BaoCao-${safeStudent}-${dateStr}.pdf`;

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
