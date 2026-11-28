// GET /api/admin/cham-cong/export?centerId=&ky=YYYY-MM — L5: xuất bảng công kỳ (xlsx).
// Quyền `hr_attendance:export` tại cơ sở. Kỳ ĐÃ CHỐT ⇒ đọc summaryJson (số đã chốt); chưa chốt ⇒
// dựng bản tạm (ghi rõ trên file). Audit EXPORT + đếm exportCount (kỳ đã chốt).
import * as XLSX from "xlsx";
import { NextResponse, type NextRequest } from "next/server";
import { requireLiveSession } from "@/lib/auth/live-session";
import { chanXuat } from "@/lib/export/chan-xuat";
import { writeAudit } from "@/lib/audit/audit-log";
import { getAuditActor } from "@/lib/audit/log";
import { exportWatermark } from "@/lib/export/watermark";
import { db } from "@/lib/db";
import { HO_CENTER_ID } from "@/lib/cham-cong/home-center";
import { buildPeriodSummary, parsePeriodKey, type PeriodSummary } from "@/lib/cham-cong/period";
import { buildPeriodWorkbook } from "@/lib/cham-cong/export-xlsx";

export async function GET(req: NextRequest) {
  const session = await requireLiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const centerId = req.nextUrl.searchParams.get("centerId") ?? "";
  const ky = req.nextUrl.searchParams.get("ky") ?? "";
  if (!centerId || !parsePeriodKey(ky)) return NextResponse.json({ error: "Thiếu centerId / ky" }, { status: 400 });
  // Cổng xuất: vai được giao ở Cấu hình vận hành → Quyền xuất dữ liệu, CỘNG với quyền đọc
  // dữ liệu (`hr_attendance:export`). Xem `lib/export/quyen-xuat.ts`.
  const chan = await chanXuat("cham-cong-ky", session, { centerId });
  if (chan) return chan;

  const center = centerId === HO_CENTER_ID ? { code: "HO", name: "Hội sở" } : await db.center.findUnique({ where: { id: centerId }, select: { code: true, name: true } });
  if (!center) return NextResponse.json({ error: "Không có cơ sở" }, { status: 404 });
  const period = await db.attendancePeriod.findUnique({ where: { centerId_periodKey: { centerId, periodKey: ky } }, select: { id: true, status: true, summaryJson: true } });
  const locked = period?.status === "LOCKED";
  const summary = locked && period?.summaryJson ? (period.summaryJson as unknown as PeriodSummary) : await buildPeriodSummary(centerId, ky);

  const now = new Date();
  const { actorId, actorName } = getAuditActor(session);
  const watermark = exportWatermark(actorName, actorId, summary.rows.length, now);
  const wb = buildPeriodWorkbook({ summary, centerLabel: `${center.code ?? ""} ${center.name}`.trim(), watermark, locked });
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "hr_attendance",
    entityType: "AttendancePeriod",
    entityId: period?.id ?? `${centerId}:${ky}`,
    action: "EXPORT",
    newValues: { centerId, periodKey: ky, locked, people: summary.rows.length, units: summary.totals.units },
  });
  if (period && locked) await db.attendancePeriod.update({ where: { id: period.id }, data: { exportCount: { increment: 1 }, lastExportedAt: now } });

  const fname = `bang-cong-${center.code ?? centerId}-${ky}${locked ? "" : "-tam"}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}
