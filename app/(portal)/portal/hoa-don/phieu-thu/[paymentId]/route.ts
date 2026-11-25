// GET /portal/hoa-don/phieu-thu/<paymentId> — phụ huynh tải PHIẾU THU PDF của khoản đã đóng cho con mình (12/11/2026).
// Khuôn: `app/(portal)/portal/hoa-don/[hoaDonId]/tai-ve/route.ts`. Thứ tự: đăng nhập (PARENT) → không ở chế độ học sinh → đã đồng ý
// chính sách website (cùng cổng với trang Học phí) → sở hữu + luật nhóm chứng từ (MỘT truy vấn: `taoPdfPhieuThuChoPhuHuynh`) → PDF.
// Không thấy / của người khác / đơn thuộc nhóm HOÁ ĐƠN ⇒ 404 y hệt (không lộ tồn tại). Không audit: phiếu thu là tờ phụ huynh
// đã được phát tận tay; không có tệp bí mật nào rời kho.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasAcceptedSitePolicy } from "@/lib/legal/site-policy";
import { taoPdfPhieuThuChoPhuHuynh } from "@/lib/portal/phieu-thu-ph";
import { getPortalContext } from "@/lib/portal/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const loi = (status: number, thongDiep: string) =>
  NextResponse.json({ error: thongDiep }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return loi(401, "Chưa đăng nhập");
  if (session.user.role !== "PARENT") return loi(404, "Không tìm thấy phiếu thu");

  const ctx = await getPortalContext();
  if (!ctx || ctx.cheDo === "hoc-sinh") return loi(404, "Không tìm thấy phiếu thu");
  if (!(await hasAcceptedSitePolicy(session.user.id))) return loi(403, "Cần đồng ý chính sách hoạt động của website trước khi xem học phí");

  const { paymentId } = await params;
  const kq = await taoPdfPhieuThuChoPhuHuynh(ctx.children.map((c) => c.id), paymentId);
  if (!kq) return loi(404, "Không tìm thấy phiếu thu");
  if (!kq.ok) return loi(kq.status === 404 ? 404 : 503, kq.status === 404 ? "Không tìm thấy phiếu thu" : "Chưa tạo được phiếu thu. Vui lòng thử lại sau hoặc liên hệ trung tâm.");

  return new NextResponse(new Uint8Array(kq.pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${kq.tenTep}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
