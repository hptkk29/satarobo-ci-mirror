// GET /api/admin/reports/nhan-xet-buoi?studentId=…&feedbackId=…&feedbackId=… — PDF nhận xét của MỘT học viên cho MỘT HOẶC
// NHIỀU buổi (mỗi buổi một trang, xếp theo thứ tự buổi), cho QLCS / Sale lấy về gửi phụ huynh (nút "Xuất nhận xét"
// trên hồ sơ học viên).
//
// Route site giáo viên (`/teacher/nhan-xet/pdf/…`) nằm ở host giaovien nên QLCS/Sale không vào được; đây là cửa thứ hai,
// cùng nội dung (dựng ở `lib/pdf/session-eval-response.ts`), gác bằng quyền `session-feedback:share` + cách ly cơ sở:
// học viên VÀ từng buổi phải nằm trong tầm nhìn `scopedDb`, ngoài tầm nhìn → như không tồn tại (chống IDOR theo id phiếu).
// Mọi phiếu phải thuộc ĐÚNG học viên `studentId` — không cho trộn phiếu của học viên khác vào một tệp.
// ⚠️ Câu 46: PDF chỉ mang tên học viên — không SĐT / email phụ huynh.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { feedbackHasContent } from "@/lib/lms/feedback-content";
import { TOI_DA_BUOI_MOT_LAN } from "@/lib/students/xuat-nhan-xet";
import {
  CHON_BUOI_PHIEU,
  CHON_PHIEU_BUOI,
  sessionEvalBundlePdfResponse,
} from "@/lib/pdf/session-eval-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const khongThay = () => NextResponse.json({ error: "Không tìm thấy phiếu nhận xét" }, { status: 404 });

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkPermission("session-feedback:share"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const studentId = req.nextUrl.searchParams.get("studentId");
  if (!studentId) return NextResponse.json({ error: "Thiếu studentId" }, { status: 400 });
  const feedbackIds = [...new Set(req.nextUrl.searchParams.getAll("feedbackId").filter(Boolean))];
  if (feedbackIds.length === 0) return NextResponse.json({ error: "Chưa chọn buổi nào" }, { status: 400 });
  if (feedbackIds.length > TOI_DA_BUOI_MOT_LAN) {
    return NextResponse.json({ error: `Chọn tối đa ${TOI_DA_BUOI_MOT_LAN} buổi mỗi lần xuất` }, { status: 400 });
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const [student, fbs] = await Promise.all([
    sdb.student.findFirst({ where: { id: studentId, deletedAt: null }, select: { name: true } }),
    sdb.studentSessionFeedback.findMany({
      where: { id: { in: feedbackIds }, studentId },
      select: { id: true, ...CHON_PHIEU_BUOI },
    }),
  ]);
  // Thiếu một phiếu (sai id / của học viên khác) ⇒ từ chối CẢ lượt, không âm thầm bỏ bớt buổi người dùng đã chọn.
  if (!student || fbs.length !== feedbackIds.length) return khongThay();

  const sessions = await sdb.classSession.findMany({
    where: { id: { in: [...new Set(fbs.map((f) => f.classSessionId))] } },
    select: CHON_BUOI_PHIEU,
  });
  const buoiTheoId = new Map(sessions.map((b) => [b.id, b]));

  const items = [];
  for (const fb of fbs) {
    const sess = buoiTheoId.get(fb.classSessionId);
    if (!sess) return khongThay(); // buổi ngoài tầm nhìn cơ sở
    if (!feedbackHasContent(fb)) {
      return NextResponse.json({ error: "Có phiếu nhận xét còn trống — bỏ chọn buổi đó rồi xuất lại" }, { status: 404 });
    }
    items.push({ sess, fb });
  }

  return sessionEvalBundlePdfResponse({ sdb, studentName: student.name, items });
}
