import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { requireLiveSession } from "@/lib/auth/live-session";
import { chanXuat } from "@/lib/export/chan-xuat";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { buildCommissionExportRows } from "@/lib/crm/commission-export";
import { writeAudit } from "@/lib/audit/audit-log";
import { getAuditActor } from "@/lib/audit/log";
import { exportWatermark } from "@/lib/export/watermark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// R1-12 — Export Excel bảng hoa hồng theo kỳ. Gate quyền tài chính.
export async function GET(req: NextRequest) {
  const session = await requireLiveSession();
  if (!session) return NextResponse.json({ ok: false, error: "Chưa đăng nhập" }, { status: 401 });
  // Cổng xuất: vai được giao ở Cấu hình vận hành → Quyền xuất dữ liệu, CỘNG với quyền đọc
  // dữ liệu (`payments:manage`). Xem `lib/export/quyen-xuat.ts`.
  const chan = await chanXuat("hoa-hong", session);
  if (chan) return chan;
  const period = new URL(req.url).searchParams.get("period");
  if (!period) return NextResponse.json({ ok: false, error: "Thiếu ?period=YYYY-MM" }, { status: 400 });

  // Cách ly cơ sở (scope TAY — cùng lý do crm/commission/page.tsx): statement là bảng
  // KỲ toàn hệ thống (không centerId) → pass-through; lọc DÒNG theo người hưởng
  // (recipientId → User.centerId) khi actor không phải SUPER_ADMIN/HO.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const stmt = await sdb.commissionStatement.findUnique({
    where: { period },
    include: { lines: true },
  });
  if (!stmt) return NextResponse.json({ ok: false, error: "Không tìm thấy kỳ" }, { status: 404 });

  const visibleCenters = getModelVisibleCenterIds("CommissionStatement", actor);
  let lines = stmt.lines;
  if (visibleCenters !== "ALL") {
    const allowed = new Set(
      (
        await sdb.user.findMany({
          where: { centerId: { in: visibleCenters } },
          select: { id: true },
        })
      ).map((u) => u.id),
    );
    lines = lines.filter((l) => allowed.has(l.recipientId));
  }

  const recipientIds = [...new Set(lines.map((l) => l.recipientId))];
  const users = await sdb.user.findMany({ where: { id: { in: recipientIds } }, select: { id: true, name: true, email: true } });
  const names = Object.fromEntries(users.map((u) => [u.id, u.name ?? u.email ?? u.id]));

  const rows = buildCommissionExportRows(lines, names);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `HoaHong_${period}`);

  // SEC-M05: sheet watermark (truy vết) — không đụng sheet dữ liệu.
  const { actorId, actorName } = getAuditActor(session);
  const wmWs = XLSX.utils.aoa_to_sheet([
    ["Watermark"],
    [exportWatermark(actorName, actorId, lines.length, new Date())],
  ]);
  XLSX.utils.book_append_sheet(wb, wmWs, "_watermark");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "crm",
    entityType: "CommissionStatement",
    entityId: period,
    action: "EXPORT",
    newValues: { period, count: lines.length },
  });

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="hoa-hong-${period}.xlsx"`,
    },
  });
}
