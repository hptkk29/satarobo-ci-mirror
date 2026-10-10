// PDF phiếu nhận xét MỘT BÀI của bé ở buổi dạy bù (admin) — T16b. Quyền: `makeup:view` + PHẠM VI như màn chi tiết case (Sale chỉ bé mình phụ trách;
// người ở cơ sở khác không thấy mục — `scopedDb` + `whereCase`). Mục ngoài phạm vi trả 404 như không tồn tại (không lộ là có).
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { whereCase } from "@/lib/hoc-bu/case-doc";
import { CHON_PHIEU_MUC, dungPdfPhieuMuc } from "@/lib/hoc-bu/phieu-muc-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ caseStudentId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  if (!(await checkPermission("makeup:view"))) return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  const { caseStudentId } = await params;
  const xemTatCa = await checkPermission("makeup:view-all");
  const sdb = scopedDb(await resolveActor(session.user.id));
  const m = await sdb.makeupCaseStudent.findFirst({
    where: { id: caseStudentId, case: whereCase({ chiCuaSale: xemTatCa ? null : session.user.id }) },
    select: CHON_PHIEU_MUC,
  });
  if (!m) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  return dungPdfPhieuMuc(m);
}
