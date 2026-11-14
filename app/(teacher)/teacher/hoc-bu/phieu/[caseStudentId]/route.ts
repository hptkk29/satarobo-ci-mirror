// PDF phiếu nhận xét MỘT BÀI ở buổi dạy bù (site giáo viên) — T16b. Giáo viên chỉ xuất phiếu của case MÌNH dạy (`case.teacherId`); case của người
// khác trả 404 như không tồn tại. Quyền `makeup:attend` — cùng quyền với việc lưu phiếu.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { docMucPhieuChoGv, dungPdfPhieuMuc } from "@/lib/hoc-bu/phieu-muc-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ caseStudentId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  if (!(await checkPermission("makeup:attend"))) return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  const { caseStudentId } = await params;
  const m = await docMucPhieuChoGv(session.user.id, caseStudentId);
  if (!m) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  return dungPdfPhieuMuc(m);
}
