// GET /api/hoa-don/<hoaDonId>/tai-pdf — tải PDF hoá đơn ĐÃ PHÁT HÀNH cho SALE (chi tiết đơn) và PHỤ HUYNH (Học phí của con). Invoice Hub S10, chỉ đọc.
//
// Route RIÊNG, không đụng `payments/hoa-don/[hoaDonId]/tai-ve` của kế toán (hành vi của kế toán không đổi). `/api/*` là đường hạ tầng — `decideRoute`
// cho qua ở MỌI host (`isInfraPath`), nên admin host lẫn hocvien host cùng gọi được mà không sửa `route-policy.ts`; quyền do CHÍNH route này quyết.
//
// Ai tải được (luật ở `moTepChoNguoiXem` + `phan-phoi-doc.ts`, không nhắc lại ở đây):
//   · NHÂN VIÊN: `orders:view` + `orders:view-pii` (PDF mang tên, MST, địa chỉ người mua) và `orders:view-pii` hiệu lực ĐÚNG cơ sở của hoá đơn.
//   · PHỤ HUYNH: hoá đơn của CON mình (đường nối trong `hoaDonThuocPhuHuynh`); phiên PARENT.
//   · Chỉ bản `DA_XAC_NHAN`, có PDF, không phải bản mô phỏng; cờ `hoaDon.hubPhanPhoi` của cơ sở hoá đơn phải bật. Không bao giờ XML.
//
// Mã trạng thái: 401 chưa đăng nhập · 403 không phải nhân viên có quyền cũng không phải phụ huynh (nói về NGƯỜI, không lộ gì về hoá đơn) ·
// 404 MỌI trường hợp còn lại — không tồn tại, không phải của bạn, sai trạng thái, cờ tắt đều ra CÙNG một thông điệp · 503 kho / nhật ký lỗi.
// Thân trả về là byte PDF (KHÔNG redirect tới URL ký: URL ký mang nguyên khoá kho trong đường dẫn). Nhật ký ghi TRƯỚC khi đọc byte.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { moTepChoNguoiXem, type KetQuaMoTep } from "@/lib/finance/hoa-don/phan-phoi-db";
import { getPortalContext } from "@/lib/portal/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function loi(status: number, thongDiep: string) {
  return NextResponse.json({ error: thongDiep }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function traLoi(kq: Extract<KetQuaMoTep, { ok: false }>) {
  if (kq.ma === "KHONG_TIM_THAY") return loi(404, "Không tìm thấy hoá đơn");
  if (kq.ma === "KHO_CHUA_CAU_HINH") return loi(503, "Kho lưu hoá đơn chưa sẵn sàng. Vui lòng thử lại sau.");
  if (kq.ma === "AUDIT_LOI") return loi(503, "Chưa tải được hoá đơn lúc này. Vui lòng thử lại.");
  return loi(503, "Kho lưu hoá đơn đang lỗi. Vui lòng thử lại.");
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return loi(401, "Chưa đăng nhập");
  const { id } = await params;
  const nguoiDung = { id: session.user.id, ten: session.user.name ?? session.user.email ?? session.user.id };

  const [xemDon, xemPii] = await Promise.all([checkPermission("orders:view"), checkPermission("orders:view-pii")]);
  const laNhanVien = xemDon && xemPii;
  const ctxPhuHuynh = await getPortalContext();

  if (!laNhanVien && !ctxPhuHuynh) return loi(403, "Không có quyền tải hoá đơn");

  let kq: KetQuaMoTep = { ok: false, ma: "KHONG_TIM_THAY" };
  if (laNhanVien) {
    const actor = await resolveActor(session.user.id);
    kq = await moTepChoNguoiXem({ hoaDonId: id, nguoi: { loai: "NHAN_VIEN", actor, xemPii }, nguoiDung });
  }
  // Người kiêm cả hai vai: nhân viên không thấy thì thử với tư cách phụ huynh. Lỗi kho / nhật ký của nhánh trước KHÔNG bị che bởi nhánh sau.
  if (!kq.ok && kq.ma === "KHONG_TIM_THAY" && ctxPhuHuynh) {
    kq = await moTepChoNguoiXem({
      hoaDonId: id,
      nguoi: { loai: "PHU_HUYNH", owner: { parentUserId: ctxPhuHuynh.parentUserId, childIds: ctxPhuHuynh.children.map((c) => c.id) } },
      nguoiDung,
    });
  }
  if (!kq.ok) return traLoi(kq);

  return new NextResponse(new Uint8Array(kq.than), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${kq.tenTep}"`,
      "Content-Length": String(kq.than.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
