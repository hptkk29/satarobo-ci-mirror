// PDF phiếu nhận xét buổi học (site GV). Guard ownership BUỔI (canManageSessionRecord —
// nhận cả GV dạy thay/thực dạy, FIX #3) + ĐÃ LƯU phiếu (notes/rubric != null) → 404
// "lưu trước". ⚠️ Câu 46: chỉ tên HV.
// Phần DỰNG PDF nằm ở `lib/pdf/session-eval-response.ts` (dùng chung với hồ sơ học viên ở admin).
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { canManageSessionRecord } from "@/app/(admin)/admin/sessions/[id]/_feedback-core";
import { feedbackHasContent } from "@/lib/lms/feedback-content";
import {
  CHON_BUOI_PHIEU,
  CHON_PHIEU_BUOI,
  sessionEvalPdfResponse,
} from "@/lib/pdf/session-eval-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    select: CHON_BUOI_PHIEU,
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
      select: CHON_PHIEU_BUOI,
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

  return sessionEvalPdfResponse({ sdb, sess, fb, studentName: student.name });
}
