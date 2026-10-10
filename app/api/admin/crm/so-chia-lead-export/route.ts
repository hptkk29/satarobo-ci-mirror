import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { requireLiveSession } from "@/lib/auth/live-session";
import { chanXuat } from "@/lib/export/chan-xuat";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { laySoChia } from "@/lib/lead/pool-board";
import { orgUnitIdCuaCoSo } from "@/lib/lead/pool";
import { writeAudit } from "@/lib/audit/audit-log";
import { getAuditActor } from "@/lib/audit/log";
import { exportWatermark } from "@/lib/export/watermark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Trần một lượt xuất. Sổ chia lead chỉ có thêm, không bao giờ bớt — không có trần
 *  thì một lượt bấm nhầm khoảng ngày là kéo cả năm dữ liệu vào bộ nhớ. */
const TRAN_DONG = 5_000;

const NHAN_NGUON: Record<string, string> = {
  AUTO: "Máy chia",
  SELF: "Sale tự nhập",
  MANAGER: "Quản lý giao",
  IMPORT: "Nhập Excel",
  AFFILIATE: "Mã giới thiệu",
  DUPLICATE: "Nhập lại (trùng)",
};

/**
 * Xuất Excel SỔ CHIA LEAD — cùng bộ lọc với tab trên màn Quản lý chia lead.
 *
 * QUYỀN: `lead_pool:manage` (Quản trị + Quản lý cơ sở) — đúng cấp quản lý trở lên như
 * đặc tả yêu cầu. Sale KHÔNG xuất được: sổ này chứa SĐT của lead cả cơ sở.
 *
 * ⚠️ Cách ly cơ sở KHÔNG dựa vào scope của quyền (nó GLOBAL vì là cổng trang) mà bằng
 * cách CHỈ nhận `orgUnitId` suy ra từ những cơ sở actor thật sự nhìn thấy. Nhận thẳng
 * `orgUnitId` từ query là ai gõ URL cũng kéo được sổ của cơ sở khác.
 */
export async function GET(req: NextRequest) {
  const session = await requireLiveSession();
  if (!session) return NextResponse.json({ ok: false, error: "Chưa đăng nhập" }, { status: 401 });
  // Cổng xuất: vai được giao ở Cấu hình vận hành → Quyền xuất dữ liệu, CỘNG với quyền đọc
  // dữ liệu (`lead_pool:manage`). Xem `lib/export/quyen-xuat.ts`.
  const chan = await chanXuat("so-chia-lead", session);
  if (chan) return chan;

  const q = new URL(req.url).searchParams;
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const nhieuCoSo = actor.isSuperAdmin || actor.isHoLevel;

  const centers = await sdb.center.findMany({
    where: {
      isActive: true,
      ...(nhieuCoSo ? {} : { id: { in: actor.visibleCenterIds } }),
      // Lọc theo một cơ sở nếu người dùng đang xem một cơ sở — nhưng chỉ trong tập
      // đã nhìn thấy được ở trên, nên gõ id lạ vào URL thì ra rỗng chứ không rò.
      ...(q.get("co_so") ? { id: q.get("co_so") as string } : {}),
    },
    select: { id: true },
  });
  const orgUnitIds = (await Promise.all(centers.map((c) => orgUnitIdCuaCoSo(c.id)))).filter(
    Boolean,
  ) as string[];
  if (orgUnitIds.length === 0) {
    return NextResponse.json({ ok: false, error: "Không có cơ sở nào trong phạm vi" }, { status: 400 });
  }

  const den = q.get("den") ? new Date(`${q.get("den")}T23:59:59`) : new Date();
  const tu = q.get("tu")
    ? new Date(`${q.get("tu")}T00:00:00`)
    : new Date(den.getTime() - 30 * 24 * 3600 * 1000);
  const tieuLuotRaw = q.get("tieu_luot");

  const { rows, tong } = await laySoChia({
    orgUnitIds,
    tuNgay: tu,
    denNgay: den,
    saleId: q.get("sale"),
    source: q.get("nguon"),
    tieuLuot: tieuLuotRaw === "co" || tieuLuotRaw === "khong" ? tieuLuotRaw : null,
    trang: 1,
    moiTrang: TRAN_DONG,
  });

  const aoa: (string | number)[][] = [
    [
      "Thời gian",
      "Lead",
      "SĐT",
      "Cơ sở",
      "Người nhập",
      "Chia cho",
      "Nguồn",
      "Tiêu lượt",
      "Lượt sau khi chia",
    ],
    ...rows.map((r) => [
      r.createdAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
      r.parentName ?? "",
      // Ép chuỗi: Excel nuốt số 0 đầu của SĐT nếu để kiểu số.
      r.phone ? `'${r.phone}` : "",
      r.centerName ?? "",
      r.nguoiNhap ?? "",
      r.chiaCho ?? "Chưa phân công",
      NHAN_NGUON[r.source] ?? r.source,
      r.consumedTurn ? "Có" : "Không",
      r.turnCountAfter ?? "",
    ]),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "SoChiaLead");

  // SEC-M05 — sheet watermark truy vết, không đụng sheet dữ liệu.
  const { actorId, actorName } = getAuditActor(session);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Watermark"],
      [exportWatermark(actorName, actorId, rows.length, new Date())],
      ...(tong > rows.length
        ? [[`⚠️ Bộ lọc khớp ${tong} dòng, tệp này chỉ chứa ${rows.length} dòng đầu.`]]
        : []),
    ]),
    "_watermark",
  );

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "crm",
    entityType: "LeadAssignmentLog",
    entityId: `${tu.toISOString().slice(0, 10)}..${den.toISOString().slice(0, 10)}`,
    action: "EXPORT",
    newValues: { count: rows.length, tong, orgUnitIds },
  });

  const ten = `so-chia-lead-${tu.toISOString().slice(0, 10)}_${den.toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ten}"`,
    },
  });
}
