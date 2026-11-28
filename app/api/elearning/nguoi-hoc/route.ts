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
import { duocXuat, vaiCuaPhien } from "@/lib/export/quyen-xuat";
import { chanApiKhiTat } from "@/lib/elearning/api-gate";
import { coSoCuaPhamVi, loaiQuyenBaoCao } from "@/lib/elearning/report-scope";
import { COT_XUAT_NGUOI_HOC, dongXuatNguoiHoc, gomTheoNguoi, locNguoiHoc } from "@/lib/elearning/nguoi-hoc";
import { traNguoiHoc } from "@/lib/elearning/nguoi-hoc-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// P7 — xuất Excel danh sách NGƯỜI HỌC (cùng bộ lọc đang xem: ?q= &chu=1 &coSo= &vaiTro=).
//
// Cùng bốn lớp cổng với `bao-cao-r1`: cờ → phiên SỐNG → `elearning:report:export` + quyền xem (view-all/view-team) → cổng VAI xuất
// (`elearning-nguoi-hoc`, Quản trị tối cao cấp ở Cấu hình vận hành). Xuất file mang dữ liệu nhân sự RA KHỎI hệ thống nên có watermark + AuditLog.
// File KHÔNG có SĐT/email/ngày sinh — chỉ cột trong `COT_XUAT_NGUOI_HOC`.
export async function GET(req: NextRequest) {
  const chanCo = chanApiKhiTat();
  if (chanCo) return chanCo;
  const session = await requireLiveSession();
  if (!session?.user?.id) return fail("UNAUTHENTICATED", "Chưa đăng nhập", { status: 401 });
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:report:export")) return fail("PERMISSION_DENIED", "Không có quyền xuất báo cáo", { status: 403 });
  const loai = loaiQuyenBaoCao(actor);
  if (!loai) return fail("PERMISSION_DENIED", "Không có quyền xem danh sách này", { status: 403 });
  if (!(await duocXuat("elearning-nguoi-hoc", vaiCuaPhien(session.user)))) {
    return fail("PERMISSION_DENIED", "Bạn chưa được phép xuất danh sách này. Quản trị tối cao cấp quyền ở Cấu hình vận hành → Quyền xuất dữ liệu.", { status: 403 });
  }

  const u = new URL(req.url).searchParams;
  const now = new Date();
  const { dong, biCat } = await traNguoiHoc(scopedDb(actor), coSoCuaPhamVi(loai, actor));
  const ds = locNguoiHoc(gomTheoNguoi(dong, now), {
    q: u.get("q") ?? undefined,
    chiCanChuY: u.get("chu") === "1",
    coSo: u.get("coSo") ?? undefined,
    vaiTro: u.get("vaiTro") ?? undefined,
  });

  const { actorId, actorName } = getAuditActor(session);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...COT_XUAT_NGUOI_HOC], ...ds.map(dongXuatNguoiHoc)]), "NguoiHoc");
  if (biCat) {
    // Danh sách bị cắt ở trần đọc: nói thẳng trong file, đừng để người nhận tưởng đây là TOÀN BỘ.
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Lưu ý"], ["Danh sách chỉ gồm các lượt học mới nhất trong tầm nhìn (đã chạm trần đọc); có thể thiếu người chỉ có lượt học cũ."]]), "_luu_y");
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Watermark"], [exportWatermark(actorName, actorId, ds.length, now)]]), "_watermark");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "elearning",
    entityType: "NguoiHoc",
    entityId: "danh-sach",
    action: "EXPORT",
    newValues: { soDong: ds.length, phamVi: loai, biCat, boLoc: { q: u.get("q") ?? null, chu: u.get("chu") === "1", coSo: u.get("coSo") ?? null, vaiTro: u.get("vaiTro") ?? null } },
  });

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="nguoi-hoc.xlsx"',
    },
  });
}
