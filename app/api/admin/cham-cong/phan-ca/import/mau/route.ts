// GET /api/admin/cham-cong/phan-ca/import/mau?ky=YYYY-MM&coSo=<Center.id> — FILE MẪU cho màn
// "Import lịch phân ca": đúng bố cục mà `parseWorkbook` đọc, đổ sẵn lịch ĐANG CÓ của khối để nộp
// lại không sửa gì thì 0 ô đổi (ô trống khi import là HUỶ ca, không phải bỏ qua — lý do ở đầu
// `lib/cham-cong/mau-import-phan-ca.ts`).
//
// Cổng: quyền của màn import (`hr_attendance:assign` tại ĐÚNG khối) + cổng vai xuất
// `phan-ca-thang` — tệp mang đúng loại dữ liệu của tệp xuất lưới nên dùng chung một cổng, và
// trang import cũng hỏi cổng này trước khi vẽ nút (luật 12: không hứa tải mà route từ chối).
import { NextResponse, type NextRequest } from "next/server";
import { requireLiveSession } from "@/lib/auth/live-session";
import { checkPermission } from "@/lib/auth/check-permission";
import { chanXuatVai } from "@/lib/export/chan-xuat";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { getAuditActor } from "@/lib/audit/log";
import { vnYmd } from "@/lib/time/vn";
import { HO_CENTER_ID, loadCenterMap } from "@/lib/cham-cong/home-center";
import { parsePeriodKey } from "@/lib/cham-cong/period";
import { docDauVaoMau } from "@/lib/cham-cong/mau-import-phan-ca-db";
import { dungFileMauImport } from "@/lib/cham-cong/mau-import-phan-ca";
import { tenTepAnToan } from "@/lib/cham-cong/xuat-bang";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await requireLiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ky = req.nextUrl.searchParams.get("ky") ?? "";
  const coSo = req.nextUrl.searchParams.get("coSo") ?? "";
  if (!coSo || !parsePeriodKey(ky)) return NextResponse.json({ error: "Thiếu coSo / ky" }, { status: 400 });

  if (!(await checkPermission("hr_attendance:assign", { centerId: coSo }))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const chan = await chanXuatVai("phan-ca-thang", session);
  if (chan) return chan;

  const map = await loadCenterMap();
  const entry = Object.entries(map.byCode).find(([, c]) => c.centerId === coSo);
  const donVi = coSo === HO_CENTER_ID ? "HO" : entry?.[0];
  if (donVi !== "HO" && donVi !== "CS1" && donVi !== "CS2") {
    return NextResponse.json({ error: "Cơ sở không có trong danh sách phân ca" }, { status: 400 });
  }

  const centers = await db.center.findMany({ select: { id: true, code: true, name: true } });
  const unitOf = (id: string) => (id === HO_CENTER_ID ? "HO" : (centers.find((c) => c.id === id)?.code ?? "HO"));
  const nhanKhoi =
    coSo === HO_CENTER_ID
      ? "HO · Hội sở"
      : (() => {
          const c = centers.find((x) => x.id === coSo);
          return c ? `${c.code ?? ""} · ${c.name}`.trim() : donVi;
        })();

  const actor = await resolveActor(session.user.id);
  const dauVao = await docDauVaoMau({
    sdb: scopedDb(actor),
    coSo,
    ky,
    donVi,
    nhanKhoi,
    orgUnitId: coSo === HO_CENTER_ID ? null : (entry?.[1].orgUnitId ?? null),
    unitOf,
    today: vnYmd(new Date()),
  });

  const buf = Buffer.from(await dungFileMauImport(dauVao).xlsx.writeBuffer());

  const { actorId, actorName } = getAuditActor(session);
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "hr_attendance",
    entityType: "ShiftAssignment",
    entityId: `${coSo}:${ky}`,
    action: "EXPORT",
    newValues: { man: "phan-ca-import-mau", coSo, periodKey: ky, people: dauVao.nguoi.length },
  });

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${tenTepAnToan(`mau-import-phan-ca-${donVi}-${ky}`)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
