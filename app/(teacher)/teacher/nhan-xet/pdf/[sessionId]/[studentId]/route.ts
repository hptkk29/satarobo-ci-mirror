// PDF phiếu nhận xét buổi học (site GV). Guard ownership BUỔI (canManageSessionRecord —
// nhận cả GV dạy thay/thực dạy, FIX #3) + ĐÃ LƯU phiếu (notes/rubric != null) → 404
// "lưu trước". ⚠️ Câu 46: chỉ tên HV.
import { createElement, type ReactElement } from "react";
import { NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { canManageSessionRecord } from "@/app/(admin)/admin/sessions/[id]/_feedback-core";
import { feedbackHasContent } from "@/lib/lms/feedback-content";
import {
  normalizeEvalNotes,
  normalizeEvalRatings,
} from "@/lib/lms/session-eval-rubric";
import { withFreshFonts } from "@/lib/pdf/brand";
import { SessionEvalPdf } from "@/lib/pdf/session-eval";
import { buildSessionNumberMap } from "@/lib/lms/session-order";
import {
  deriveSessionLabel,
  resolveDisplayProjectName,
} from "@/lib/lms/session-project-name";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeFilename(sName: string): string {
  return sName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .replace(/_+/g, "_");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string; studentId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const { sessionId, studentId } = await params;

  const sdb = scopedDb(actorGiangDay(await resolveActor(session.user.id)));
  const sess = await sdb.classSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      centerId: true, // model scoped — findUnique lọc hậu kỳ theo field này
      classId: true,
      substituteTeacherId: true,
      actualTeacherId: true,
      date: true,
      topic: true,
      plan: { select: { customTitle: true, order: true } },
      lesson: { select: { order: true, title: true, moduleCode: true } },
      class: {
        select: {
          name: true,
          centerId: true,
          course: { select: { name: true } },
        },
      },
    },
  });
  if (!sess)
    return NextResponse.json(
      { error: "Không tìm thấy buổi học" },
      { status: 404 },
    );

  // FIX #3 — ownership theo BUỔI (lớp phân công ∪ dạy thay ∪ thực dạy), khớp gate
  // của saveSessionFeedback/saveSessionEval — GV dạy thay xuất được PDF phiếu mình lưu.
  const allowed = await canManageSessionRecord(
    {
      id: session.user.id,
      role: session.user.role,
      centerId: session.user.centerId,
    },
    sess,
  );
  if (!allowed)
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });

  const [fb, student] = await Promise.all([
    sdb.studentSessionFeedback.findUnique({
      where: {
        classSessionId_studentId: { classSessionId: sessionId, studentId },
      },
      select: {
        projectName: true,
        notes: true,
        rubric: true,
        comment: true,
        rating: true,
        updatedAt: true,
        createdById: true,
      },
    }),
    sdb.student.findUnique({
      where: { id: studentId },
      select: { name: true },
    }),
  ]);
  // 19/08 — điều kiện cũ `rubric == null && notes == null` loại nhầm phiếu lưu qua
  // `saveSessionFeedback` (/teacher/nhan-xet, editor ở /admin/sessions/[id]) vốn chỉ có
  // comment + sao. Đó là phiếu THẬT: phụ huynh đọc được trên portal, admin thấy trên thẻ
  // nhận xét — riêng nút "Xem phiếu" thì trả JSON 404, đúng cảm giác "phiếu tôi lưu bị mất".
  // Nay chỉ chặn phiếu THỰC SỰ trống (GV mở phiếu rồi bỏ đi, không điền gì).
  if (!feedbackHasContent(fb)) {
    return NextResponse.json(
      { error: "Chưa có phiếu nhận xét — hãy lưu phiếu trước khi xuất PDF" },
      { status: 404 },
    );
  }
  if (!student)
    return NextResponse.json(
      { error: "Không tìm thấy học viên" },
      { status: 404 },
    );

  const gv = fb.createdById
    ? await sdb.user.findUnique({
        where: { id: fb.createdById },
        select: { name: true },
      })
    : null;

  const dateLabel = sess.date.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  });

  // 26/08 — tên dự án in ra PDF gửi phụ huynh suy từ BUỔI, không lấy bản sao đông
  // cứng trên phiếu (xem resolveDisplayProjectName). Số buổi tính trên TOÀN BỘ buổi
  // của lớp, không phải chỉ mình buổi này.
  const sessionNo =
    buildSessionNumberMap(
      await sdb.classSession.findMany({
        where: { classId: sess.classId },
        select: { id: true, date: true },
      }),
    ).get(sess.id) ?? null;
  // NHÃN BUỔI cho phiếu GỬI PHỤ HUYNH. `sess.topic` thô với giáo trình Sata chính là
  // chuỗi "Buổi học"/"Buổi 10", nên bản cũ (`sess.topic ?? "Buổi học"`) in ra
  // "Buổi học: Buổi học" trên tài liệu ra ngoài — đây là bản in trên PROD, không phải
  // chuyện của UAT (QA vòng 1, BUG-008).
  const nhanBuoi =
    deriveSessionLabel({
      sessionNumber: sessionNo,
      planTitle: sess.plan?.customTitle,
      planOrder: sess.plan?.order,
      lessonTitle: sess.lesson?.title,
      lessonOrder: sess.lesson?.order,
      moduleCode: sess.lesson?.moduleCode,
      topic: sess.topic,
    }) || "Buổi học";
  const duAn = resolveDisplayProjectName(
    {
      sessionNumber: sessionNo,
      planTitle: sess.plan?.customTitle,
      planOrder: sess.plan?.order,
      lessonTitle: sess.lesson?.title,
      lessonOrder: sess.lesson?.order,
      moduleCode: sess.lesson?.moduleCode,
      topic: sess.topic,
    },
    fb.projectName,
  );

  let pdf: Buffer;
  try {
    pdf = await withFreshFonts(() =>
      renderToBuffer(
        createElement(SessionEvalPdf, {
          data: {
            studentName: student.name,
            courseName: sess.class.course.name,
            className: sess.class.name,
            sessionTopic: nhanBuoi,
            dateLabel,
            projectName: duAn,
            notes: normalizeEvalNotes(fb.notes),
            ratings: normalizeEvalRatings(fb.rubric),
            evaluatedByName: gv?.name ?? null,
            comment: fb.comment,
          },
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

  // Tên tệp mang đủ ngữ cảnh: phụ huynh và giáo viên đều lưu nhiều phiếu vào một thư
  // mục, `PhieuNhanXet-Dang_Cong_Tri.pdf` của 10 buổi khác nhau thì đè lên nhau.
  const filename = `${[
    "NhanXet",
    safeFilename(student.name),
    safeFilename(sess.class.name),
    sessionNo ? `Buoi${sessionNo}` : null,
    safeFilename(dateLabel),
  ]
    .filter(Boolean)
    .join("_")}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
