import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { chanXuat } from "@/lib/export/chan-xuat";
import { buildLeadImportTemplate, LEAD_TEMPLATE_SOURCE } from "@/lib/lead/template";

// GET /api/admin/templates/leads — file mẫu import lead = FILE SOẠN TAY
// public/templates/mau-lead-v2.xlsx (giữ nguyên 3 sheet + format + hướng dẫn), được vá
// thêm lúc tải: dropdown "Khoá quan tâm" theo khoá thật, dropdown "Cơ sở" theo mã cơ sở
// thật, "Tuổi con" ràng buộc số 3–18. Xem lib/lead/template.ts.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkPermission("leads:create"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Cổng VAI (chốt 27/09/2026): danh sách vai giao ở Cấu hình vận hành → Quyền xuất
  // dữ liệu. Cộng dồn với cổng đọc ngay trên, KHÔNG thay nó.
  const chan = await chanXuat("mau-nhap-lead", session);
  if (chan) return chan;


  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // Course = danh mục toàn hệ thống (không scoped); Center exempt → sdb pass-through.
  const [courses, centers] = await Promise.all([
    sdb.course.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
    sdb.center.findMany({
      where: { isActive: true, code: { not: null } },
      orderBy: { displayOrder: "asc" },
      select: { code: true },
    }),
  ]);

  const source = await readFile(path.join(process.cwd(), LEAD_TEMPLATE_SOURCE));
  const buffer = await buildLeadImportTemplate({
    source,
    courseNames: courses.map((c) => c.name),
    centerCodes: centers.map((c) => c.code!).filter(Boolean),
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="mau-lead.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
