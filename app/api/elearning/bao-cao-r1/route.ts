import { type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { requireLiveSession } from "@/lib/auth/live-session";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { fail } from "@/lib/api/response";
import { writeAudit } from "@/lib/audit/audit-log";
import { getAuditActor } from "@/lib/audit/log";
import { exportWatermark } from "@/lib/export/watermark";
import { traDongBaoCao } from "@/lib/elearning/report-query";
import { buildR1Rows, tongHopTuanThu } from "@/lib/elearning/report-compliance";
import { duocXuat, vaiCuaPhien } from "@/lib/export/quyen-xuat";
import { chanApiKhiTat } from "@/lib/elearning/api-gate";
import { coSoCuaPhamVi, loaiQuyenBaoCao, luotGiaoHienThiDuoc } from "@/lib/elearning/report-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// EL-06 — xuất Excel báo cáo R1 (tuân thủ hạn chót) của MỘT lượt giao.
//
// ⚠️ Gác bằng `elearning:report:export`, KHÔNG dùng chung khoá xem báo cáo: xuất
// file là mang dữ liệu nhân sự RA KHỎI hệ thống, nơi không còn cách ly cơ sở nào
// bảo vệ nó nữa. Kèm watermark + một dòng AuditLog riêng (SEC-M05).
export async function GET(req: NextRequest) {
  // Cờ TRƯỚC mọi thao tác khác (kể cả đọc phiên) — đặc tả §4.8; lưới tests/elearning/api-gate.test.ts.
  const chanCo = chanApiKhiTat();
  if (chanCo) return chanCo;
  // Xuất file mang dữ liệu nhân sự RA KHỎI hệ thống ⇒ phiên phải còn sống so với DB (SEC-M11),
  // như mọi route export khác — không chỉ tin JWT còn hạn.
  const session = await requireLiveSession();
  if (!session?.user?.id) {
    return fail("UNAUTHENTICATED", "Chưa đăng nhập", { status: 401 });
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:report:export")) {
    return fail("PERMISSION_DENIED", "Không có quyền xuất báo cáo", { status: 403 });
  }

  // F-01: xuất file cần CẢ quyền xuất VÀ quyền xem (view-all hoặc view-team). Trước đây `report:export` đứng một mình nên
  // người có quyền xuất mà không có quyền xem báo cáo vẫn đi tiếp được.
  const loai = loaiQuyenBaoCao(actor);
  if (!loai) {
    return fail("PERMISSION_DENIED", "Không có quyền xem báo cáo này", { status: 403 });
  }

  // Cổng VAI (chốt 27/09/2026). Gọi `duocXuat` trực tiếp thay vì `chanXuat` để giữ ĐÚNG
  // phong bì lỗi của module này (`fail(code, message)`), thay vì trộn hai dạng JSON lỗi
  // trong cùng một API.
  if (!(await duocXuat("elearning-tuan-thu", vaiCuaPhien(session.user)))) {
    return fail(
      "PERMISSION_DENIED",
      "Bạn chưa được phép xuất báo cáo này. Quản trị tối cao cấp quyền ở Cấu hình vận hành → Quyền xuất dữ liệu.",
      { status: 403 },
    );
  }

  const assignmentId = new URL(req.url).searchParams.get("assignmentId");
  if (!assignmentId) {
    return fail("VALIDATION", "Thiếu ?assignmentId=", { field: "assignmentId" });
  }

  const db = scopedDb(actor);
  // Hàng rào IDOR của đường này: `assignmentId` đến thẳng từ thanh địa chỉ. view-all đọc `scopedDb`; view-team chỉ thấy
  // lượt giao mà mình có ≥ 1 lượt học trong tầm nhìn (`luotGiaoHienThiDuoc`) — "không có" và "không phải của bạn" cùng 404.
  const coSo = coSoCuaPhamVi(loai, actor);
  const luot = await luotGiaoHienThiDuoc(db, loai, coSo, assignmentId);
  if (!luot) return fail("NOT_FOUND", "Không tìm thấy lượt giao", { status: 404 });

  const ds = await traDongBaoCao(db, luot.id, coSo);
  const rows = buildR1Rows(ds, new Date());
  const tong = tongHopTuanThu(ds);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "TuanThu");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Lượt giao", luot.title],
      ["Đã giao", tong.daGiao],
      ["Hoàn thành đúng hạn", tong.dungHan],
      ["Hoàn thành trễ", tong.tre],
      ["Đang học", tong.dangHoc],
      ["Chưa học", tong.chuaHoc],
      ["Đã thu hồi (ngoài mẫu số)", tong.thuHoi],
      ["Tạm dừng đồng hồ (ngoài mẫu số)", tong.tamDung],
      // Mẫu số 0 ⇒ ô ghi rõ "chưa có ai để đo", KHÔNG ghi 0%: "0% tuân thủ" đọc
      // thành thảm hoạ, còn sự thật là chưa đo được.
      ["Tỉ lệ đúng hạn (%)", tong.tyLeDungHan ?? "chưa có ai để đo"],
    ]),
    "TongHop",
  );

  const { actorId, actorName } = getAuditActor(session);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Watermark"],
      [exportWatermark(actorName, actorId, ds.length, new Date())],
    ]),
    "_watermark",
  );

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "elearning",
    entityType: "TrnAssignment",
    entityId: luot.id,
    action: "EXPORT",
    newValues: { title: luot.title, soDong: ds.length, phamVi: loai },
  });

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tuan-thu-${luot.id}.xlsx"`,
    },
  });
}
