// GET /api/admin/cham-cong/phan-cong-gv/mau?coSo=<Center.id>&tu=YYYY-MM-DD&den=YYYY-MM-DD — FILE MẪU nhập phân công GV.
// Sheet nhập luôn TRỐNG; hai sheet tra cứu (giáo viên + buổi trong khoảng) lấy theo các cơ sở người tải PHÂN CÔNG ĐƯỢC
// (`hr_attendance:assign` từng cơ sở) — đúng tập mà import sẽ chấp nhận, để mượn GV cơ sở khác vẫn tra được mã.
// Cổng: phiên sống → `hr_attendance:assign` tại `coSo` → cổng vai xuất `phan-cong-gv-mau` (tệp có email + lịch từng người).
import { NextResponse, type NextRequest } from "next/server";
import { requireLiveSession } from "@/lib/auth/live-session";
import { checkPermission } from "@/lib/auth/check-permission";
import { chanXuatVai } from "@/lib/export/chan-xuat";
import { writeAudit } from "@/lib/audit/audit-log";
import { getAuditActor } from "@/lib/audit/log";
import { loadModuleScope } from "@/lib/cham-cong/module-scope";
import { tenTepAnToan } from "@/lib/cham-cong/xuat-bang";
import { docDauVaoMauNhap } from "@/lib/parttime/mau-xuat-phan-cong-db";
import { dungFileMauNhap } from "@/lib/parttime/mau-nhap-phan-cong";

export const dynamic = "force-dynamic";

const NGAY = /^\d{4}-\d{2}-\d{2}$/;
const soNgay = (tu: string, den: string) => (Date.parse(`${den}T00:00:00Z`) - Date.parse(`${tu}T00:00:00Z`)) / 86_400_000;

export async function GET(req: NextRequest) {
  const session = await requireLiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const coSo = q.get("coSo") ?? "";
  const tu = q.get("tu") ?? "";
  const den = q.get("den") ?? "";
  if (!coSo || !NGAY.test(tu) || !NGAY.test(den) || den < tu || soNgay(tu, den) > 62) {
    return NextResponse.json({ error: "Thiếu coSo / tu / den (tối đa 62 ngày)" }, { status: 400 });
  }
  if (!(await checkPermission("hr_attendance:assign", { centerId: coSo }))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const chan = await chanXuatVai("phan-cong-gv-mau", session);
  if (chan) return chan;

  const quanLy = (await loadModuleScope(session.user.id)).blocksWith("hr_attendance:assign").map((b) => b.id);
  const centerIds = [coSo, ...quanLy.filter((x) => x !== coSo)];
  const vao = await docDauVaoMauNhap({ centerIds, tu, den, now: new Date() });
  if (!vao) return NextResponse.json({ error: "Ngày bắt đầu không thuộc SR.QD.238 — không có ca / đơn giá để dựng mẫu." }, { status: 400 });
  const buf = Buffer.from(await dungFileMauNhap(vao).xlsx.writeBuffer());

  const { actorId, actorName } = getAuditActor(session);
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "hr_attendance",
    entityType: "SessionStaffAssignment",
    entityId: `${coSo}:${tu}:${den}`,
    action: "EXPORT",
    newValues: { man: "phan-cong-gv-mau", centerIds, tu, den, giaoVien: vao.giaoVien.length, buoi: vao.buoi.length },
  });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${tenTepAnToan(`mau-nhap-phan-cong-gv-${tu}`)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
