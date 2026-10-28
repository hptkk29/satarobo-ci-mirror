// GET /api/admin/cham-cong/phan-cong-gv/xuat?coSo=<id>[,<id>…]&tu=YYYY-MM-DD&den=YYYY-MM-DD[&gv=<userId>][&trangThai=KHOP|LECH|CHUA_XAC_NHAN|CHINH_SACH_CU]
// XUẤT phân công GV 4 dạng (A lưới · B chi tiết · C đối soát · D thu nhập dự kiến) — `lib/parttime/xuat-phan-cong.ts`.
// Cổng: phiên sống → `hr_attendance:view` tại TỪNG cơ sở xin xuất (thiếu một ⇒ từ chối cả tệp, không lặng lẽ bỏ bớt) → cổng vai
// xuất `phan-cong-gv`. Khoảng ngày tối đa 62 ngày (đủ một tháng + tuần đệm; dài hơn thì xuất từng tháng).
import { NextResponse, type NextRequest } from "next/server";
import { requireLiveSession } from "@/lib/auth/live-session";
import { checkPermission } from "@/lib/auth/check-permission";
import { chanXuatVai } from "@/lib/export/chan-xuat";
import { writeAudit } from "@/lib/audit/audit-log";
import { getAuditActor } from "@/lib/audit/log";
import { db } from "@/lib/db";
import { tenTepAnToan } from "@/lib/cham-cong/xuat-bang";
import { docCoSoXuat } from "@/lib/parttime/mau-xuat-phan-cong-db";
import { dungFileXuat, type TrangThaiDoiSoat } from "@/lib/parttime/xuat-phan-cong";

export const dynamic = "force-dynamic";

const NGAY = /^\d{4}-\d{2}-\d{2}$/;
const TRANG_THAI: readonly TrangThaiDoiSoat[] = ["KHOP", "LECH", "CHUA_XAC_NHAN", "CHINH_SACH_CU"];
const soNgay = (tu: string, den: string) => (Date.parse(`${den}T00:00:00Z`) - Date.parse(`${tu}T00:00:00Z`)) / 86_400_000;

export async function GET(req: NextRequest) {
  const session = await requireLiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const ids = [...new Set((q.get("coSo") ?? "").split(",").map((x) => x.trim()).filter(Boolean))];
  const tu = q.get("tu") ?? "";
  const den = q.get("den") ?? "";
  const tt = q.get("trangThai");
  if (!ids.length || ids.length > 20 || !NGAY.test(tu) || !NGAY.test(den) || den < tu || soNgay(tu, den) > 62 || (tt && !TRANG_THAI.includes(tt as TrangThaiDoiSoat))) {
    return NextResponse.json({ error: "Tham số không hợp lệ (coSo · tu · den tối đa 62 ngày · trangThai)" }, { status: 400 });
  }
  for (const centerId of ids) {
    if (!(await checkPermission("hr_attendance:view", { centerId }))) return NextResponse.json({ error: "Forbidden", coSo: centerId }, { status: 403 });
  }
  const chan = await chanXuatVai("phan-cong-gv", session);
  if (chan) return chan;

  const centers = await db.center.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } });
  if (centers.length !== ids.length) return NextResponse.json({ error: "Có cơ sở không tồn tại" }, { status: 400 });
  const now = new Date();
  const coSo = [];
  for (const c of [...centers].sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""))) coSo.push(await docCoSoXuat({ centerId: c.id, ma: c.code ?? c.name, tu, den, now }));
  const loc = { userId: q.get("gv") || null, trangThai: (tt as TrangThaiDoiSoat | null) ?? null };
  const buf = Buffer.from(await dungFileXuat({ tu, den, coSo, loc }).xlsx.writeBuffer());

  const { actorId, actorName } = getAuditActor(session);
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "hr_attendance",
    entityType: "SessionStaffAssignment",
    entityId: `${ids.join(",")}:${tu}:${den}`,
    action: "EXPORT",
    newValues: { man: "phan-cong-gv", centerIds: ids, tu, den, loc },
  });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${tenTepAnToan(`phan-cong-gv-${coSo.map((c) => c.ma).join("-")}-${tu}-${den}`)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
