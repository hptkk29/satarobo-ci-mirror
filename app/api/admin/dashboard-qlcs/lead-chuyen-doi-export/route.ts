import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { requireLiveSession } from "@/lib/auth/live-session";
import { checkPermission, canViewLeadPii } from "@/lib/auth/check-permission";
import { chanXuat } from "@/lib/export/chan-xuat";
import { resolveActor } from "@/lib/auth/actor";
import {
  resolveScopeFilters,
  parseScopeFilterSearchParams,
} from "@/lib/reports/filters";
import { getConvertedLeadRows } from "@/lib/reports/converted-leads";
import {
  buildConvertedLeadExportSheet,
  buildConvertedLeadExportInfoSheet,
  convertedLeadExportFileName,
} from "@/lib/reports/converted-leads-export";
import { writeAudit } from "@/lib/audit/audit-log";
import { getAuditActor } from "@/lib/audit/log";
import { exportWatermark } from "@/lib/export/watermark";
import { originCuaRequest } from "@/lib/http/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * C-04 — xuất Excel bảng C-03 ("Lead đã chuyển đổi") của dashboard QLCS.
 *
 * ┌─ Bốn điều route này phải làm đúng, xếp theo mức thiệt hại nếu làm sai ───────────┐
 * │ 1. XUẤT ĐÚNG THỨ ĐANG LỌC. Bộ lọc đi lại qua `resolveScopeFilters()` — CÙNG một  │
 * │    hàm mà trang dùng — chứ không đọc thẳng `?center=` từ URL. Đây đồng thời là    │
 * │    cổng chống IDOR: cơ sở ngoài phạm vi actor bị loại IM LẶNG, ngày tương lai bị  │
 * │    kẹp. Tin URL ở đây là biến nút xuất thành cửa đọc dữ liệu cơ sở khác.          │
 * │ 2. QUYỀN A-03. Đòi ĐỦ HAI: `leads:view-all` (cửa của chính tab C — vào xem được   │
 * │    bảng) và `leads:export` (cửa riêng của việc mang dữ liệu ra ngoài). Chỉ gác    │
 * │    một trong hai là hoặc người không được xem bảng vẫn tải được nó, hoặc quyền    │
 * │    xuất mà admin bật/tắt cho từng quản lý trở thành vô nghĩa.                     │
 * │ 3. CHE PII / CHE TIỀN Ở SERVER. `canViewPii`/`includeRevenue` truyền vào tầng     │
 * │    đọc, nên bản ghi xuống tệp đã che sẵn. Thiếu `payments:view` thì đường đọc     │
 * │    `Payment` KHÔNG chạy lần nào, chứ không phải đọc rồi mới giấu.                 │
 * │ 4. GHI VẾT. Xuất dữ liệu khách hàng là hành vi phải truy được: ai xuất, lọc gì,   │
 * │    bao nhiêu dòng, bản che hay bản đầy đủ — vào `AuditLog` + watermark trong tệp. │
 * └────────────────────────────────────────────────────────────────────────────────┘
 *
 * Trả tệp `.xlsx` (quyết định B12 24/08/2026), dựng bằng SheetJS đã có sẵn trong kho.
 */
export async function GET(req: NextRequest) {
  const session = await requireLiveSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Chưa đăng nhập" }, { status: 401 });
  }

  // A-03 — hai cửa, thiếu cửa nào cũng 403. Thông báo nói rõ thiếu cửa nào để quản trị
  // viên biết phải cấp gì, thay vì một chữ "Forbidden" rồi cả hai bên đoán.
  if (!(await checkPermission("leads:view-all"))) {
    return NextResponse.json(
      { ok: false, error: "Không có quyền xem danh sách lead (leads:view-all)" },
      { status: 403 },
    );
  }
  if (!(await checkPermission("leads:export"))) {
    return NextResponse.json(
      { ok: false, error: "Không có quyền xuất dữ liệu lead (leads:export)" },
      { status: 403 },
    );
  }
  // Cổng VAI (chốt 27/09/2026): danh sách vai giao ở Cấu hình vận hành → Quyền xuất
  // dữ liệu. Cộng dồn với cổng đọc ngay trên, KHÔNG thay nó.
  const chan = await chanXuat("lead-chuyen-doi", session);
  if (chan) return chan;

  const actor = await resolveActor(session.user.id);

  // Bộ lọc chung A-02, giải LẠI bằng CÙNG hàm mà trang dùng.
  const fc = await resolveScopeFilters(
    actor,
    parseScopeFilterSearchParams(req.nextUrl.searchParams),
  );

  const [canViewPii, coQuyenTien] = await Promise.all([
    canViewLeadPii(),
    // Vào được tab Kinh doanh KHÔNG đồng nghĩa xem được tiền — cùng luật với màn hình.
    checkPermission("payments:view"),
  ]);

  const report = await getConvertedLeadRows(actor, fc.filters, {
    canViewPii,
    includeRevenue: coQuyenTien,
  });

  const now = new Date();
  const { actorId, actorName } = getAuditActor(session);
  const watermark = exportWatermark(actorName, actorId, report.rows.length, now);

  const centerNameById = new Map(fc.visibleCenters.map((c) => [c.id, c.name]));
  const tenCoSoDangLoc = fc.filters.centerIds.map(
    (id) => centerNameById.get(id) ?? id,
  );

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(
      buildConvertedLeadExportSheet({
        report,
        centerNameById,
        leadUrlBase: `${originCuaRequest(req)}/leads`,
      }),
    ),
    "Lead da chuyen doi",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(
      buildConvertedLeadExportInfoSheet({
        report,
        dateFromStr: fc.dateFromStr,
        dateToStr: fc.dateToStr,
        centerNames: tenCoSoDangLoc,
        isAllCenters: fc.filters.isAllCenters,
        canViewPii,
        watermark,
      }),
    ),
    "Thong tin xuat",
  );

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  // Ghi vết TRƯỚC khi trả tệp: nếu ghi nhật ký hỏng thì lượt xuất này không được đi
  // tiếp — một lượt mang dữ liệu khách ra ngoài mà không có dấu vết là thứ không chấp
  // nhận được, khác hẳn các chỗ audit "việc phụ" khác trong kho.
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "leads",
    entityType: "Lead",
    entityId: "export-lead-chuyen-doi",
    action: "EXPORT",
    // Đúng một cơ sở trong phạm vi ⇒ neo nhật ký vào cơ sở đó để quản lý cơ sở soi được
    // lượt xuất của người mình quản. Nhiều cơ sở thì để trống — gán bừa một cơ sở là
    // nói dối về phạm vi của lượt xuất.
    orgUnitId: fc.filters.centerIds.length === 1 ? fc.filters.centerIds[0]! : null,
    newValues: {
      spec: "C-04",
      dateFrom: fc.dateFromStr,
      dateTo: fc.dateToStr,
      centerIds: fc.filters.centerIds,
      isAllCenters: fc.filters.isAllCenters,
      rowCount: report.rows.length,
      truncated: report.truncated,
      piiMasked: !canViewPii,
      revenueIncluded: coQuyenTien,
    },
  });

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${convertedLeadExportFileName(fc.dateFromStr, fc.dateToStr)}"`,
      // Tệp chứa dữ liệu khách hàng — không để proxy/trình duyệt giữ lại bản sao.
      "Cache-Control": "no-store",
    },
  });
}
