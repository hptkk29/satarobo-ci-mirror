// PDF phiếu đánh giá Trial (site GV). Chỉ HV trải nghiệm của GV + ĐÃ LƯU phiếu
// (getTeacherTrialRubricContext guard own-teacher; existing null → 404 "lưu trước").
//
// Đợt C (22/08/2026) — phần DỰNG phiếu chuyển sang `lib/pdf/trial-eval-response.ts`
// dùng chung với site Sale. Cùng một loại phiếu mà hai bản sao là hai bản sẽ trôi
// khác nhau. Guard thì KHÔNG dùng chung: bên này own-teacher, bên kia cách ly cơ sở.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTeacherTrialRubricContext } from "@/lib/lms/teacher-schedule";
import { trialEvalPdfResponse } from "@/lib/pdf/trial-eval-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ enrollmentId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  const { enrollmentId } = await params;
  // GĐ4 — một ca có nhiều phiếu (mỗi buổi một phiếu). `?sessionId=` chọn buổi cần in;
  // KHÔNG truyền thì vẫn lấy buổi đang xếp như trước, để link cũ đã gửi đi không vỡ.
  const sessionId =
    new URL(req.url).searchParams.get("sessionId")?.trim() || undefined;

  const ctx = await getTeacherTrialRubricContext(
    session.user.id,
    enrollmentId,
    sessionId,
  );
  if (!ctx) {
    return NextResponse.json(
      { error: "Không tìm thấy học viên trải nghiệm" },
      { status: 404 },
    );
  }
  if (!ctx.existing) {
    return NextResponse.json(
      { error: "Buổi này chưa có phiếu đánh giá — hãy lưu phiếu trước khi xuất PDF" },
      { status: 404 },
    );
  }

  // Kèm số buổi vào tên file: một ca nay có nhiều phiếu, cùng tên là đè lên nhau
  // trong thư mục Tải xuống.
  const seq =
    ctx.sessions.find((s) => s.id === ctx.trialClassSessionId)?.seq ?? null;

  return trialEvalPdfResponse({
    studentName: ctx.studentName,
    existing: ctx.existing,
    filenameSuffix: seq != null ? `-Buoi${seq}` : undefined,
  });
}
