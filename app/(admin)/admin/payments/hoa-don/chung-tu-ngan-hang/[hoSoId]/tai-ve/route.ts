// GET /payments/hoa-don/chung-tu-ngan-hang/<hoSoId>/tai-ve — tải tệp chứng từ ngân hàng của một khoản thu (P7-E, 06/11/2026).
// (Trình duyệt gọi URL gọn trên admin host, proxy viết lại sang /admin/payments/... — cùng tiền lệ route tải hoá đơn.)
//
// Ai tải được: CHỈ KẾ TOÁN của cơ sở giữ khoản — `payments:confirm` VÀ cơ sở nằm trong tập cơ sở của ĐÚNG quyền đó (`coQuyenKeToanTaiCoSo`).
// Khác route hoá đơn ở một chỗ có chủ đích: KHÔNG có nhánh "người có orders:view-pii" — sao kê mang số tài khoản, tên người chuyển.
// Không thấy / ngoài phạm vi ⇒ 404, KHÔNG 403 — không lộ sự tồn tại.
//
// Thứ tự: cờ → đăng nhập → quyền → scopedDb (khác cơ sở ⇒ null) → phạm vi kế toán → có tệp → kho đã cấu hình → AUDIT → ký GET 300 giây →
// redirect 302 no-store. Audit ném ⇒ 503 và KHÔNG ký (khuôn route tải hoá đơn). Không có URL công khai: khoá tệp không bao giờ ra khỏi server.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { coQuyenKeToanTaiCoSo } from "@/lib/finance/hoa-don/quyen";
import { khoHoaDonDaCauHinh } from "@/lib/finance/hoa-don/kho-tep";
import { kyUrlTaiVeChungTu } from "@/lib/finance/hoa-don/kho-chung-tu";
import { laLoaiTepChungTu, tenTaiVeChungTu } from "@/lib/finance/hoa-don/chung-tu-ngan-hang";
import { ghiAuditTaiVeChungTu } from "@/lib/finance/hoa-don/chung-tu-ngan-hang-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** URL ký sống 5 phút — đủ để trình duyệt bắt đầu tải, không đủ để thành đường dẫn chia sẻ. */
const TTL_GIAY = 300;

function loi(status: number, thongDiep: string) {
  return NextResponse.json({ error: thongDiep }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ hoSoId: string }> }) {
  if (!(await laHoaDonBat())) return loi(404, "Không tìm thấy");

  const session = await auth();
  if (!session?.user) return loi(401, "Chưa đăng nhập");
  if (!(await checkPermission("payments:confirm"))) return loi(403, "Không có quyền tải chứng từ");

  const { hoSoId } = await params;
  const actor = await resolveActor(session.user.id);
  // ChungTuNganHang ∈ SCOPED_MODELS ⇒ findUnique lọc hậu kỳ bằng passesScope (khác cơ sở ⇒ null).
  const hs = await scopedDb(actor).chungTuNganHang.findUnique({
    where: { id: hoSoId },
    select: { id: true, paymentId: true, centerId: true, orgUnitId: true, trangThai: true, tepKhoa: true, tepLoai: true },
  });
  if (!hs || !coQuyenKeToanTaiCoSo(actor, hs.centerId)) return loi(404, "Không tìm thấy chứng từ");
  if (!hs.tepKhoa || !laLoaiTepChungTu(hs.tepLoai)) return loi(404, "Hồ sơ chưa có tệp chứng từ");
  if (!khoHoaDonDaCauHinh()) return loi(503, "Kho lưu chứng từ chưa cấu hình — báo người vận hành");

  try {
    await ghiAuditTaiVeChungTu({
      nguoi: { id: session.user.id, ten: session.user.name ?? session.user.email ?? session.user.id },
      hoSo: { id: hs.id, paymentId: hs.paymentId, trangThai: hs.trangThai, orgUnitId: hs.orgUnitId, centerId: hs.centerId },
    });
  } catch (err) {
    console.error("[chung-tu-ngan-hang] KHÔNG ghi được AuditLog — từ chối cấp liên kết tải:", err);
    return loi(503, "Không ghi được nhật ký nên chưa tải được chứng từ. Vui lòng thử lại.");
  }

  let url: string;
  try {
    url = await kyUrlTaiVeChungTu(hs.tepKhoa, tenTaiVeChungTu(hs.paymentId, hs.tepLoai), TTL_GIAY);
  } catch (err) {
    console.error("[chung-tu-ngan-hang] ký URL tải thất bại:", err);
    return loi(503, "Kho lưu chứng từ đang lỗi. Vui lòng thử lại.");
  }
  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
