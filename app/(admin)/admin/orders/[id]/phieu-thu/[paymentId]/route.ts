// 12/11/2026 — SALE tải PHIẾU THU của một khoản thu ở TRANG ĐƠN để gửi phụ huynh (khối «Phiếu thu» đặt trên khối Hoá đơn điện tử).
//
// Vì sao KHÔNG dùng route `/admin/payments/[id]/phieu-thu`: route đó gác `payments:manage` (kế toán) — vai Sale (CENTER_SALES_CSM) có
// `orders:view` + `payments:record` nhưng KHÔNG có `payments:manage`, nên với Sale nó luôn 403. Mượn/nới quyền kế toán để Sale tải là đổi
// phân quyền; route này giữ nguyên ranh giới: ai XEM được đơn (`orders:view`, trong phạm vi cơ sở) thì tải được phiếu của CHÍNH đơn đó.
// Không đẻ permission key mới (RBAC v2 đọc quyền từ DB — key chưa seed thì chặn sạch vai trên môi trường thật).
//
// Cách ly: `scopedDb` (khoản/đơn cơ sở khác → null → 404) + `payment.orderId === id` (không tải phiếu của đơn khác qua URL đơn này).
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { KHOAN_PHIEU_THU_INCLUDE, dongDonTuKhoan, taoPdfPhieuThu } from "@/lib/pdf/phieu-thu-khoan";
import { napKhoaTheoDong } from "@/lib/finance/hoa-don/ten-dong-hoc-phi-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  if (!(await checkPermission("orders:view"))) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  const { id: orderId, paymentId } = await params;
  const sdb = scopedDb(await resolveActor(session.user.id));

  const payment = await sdb.payment.findUnique({
    where: { id: paymentId },
    include: { ...KHOAN_PHIEU_THU_INCLUDE },
  });
  // Khoản đã xoá mềm hoặc thuộc đơn khác ⇒ 404 (không lộ tồn tại).
  if (!payment || payment.deletedAt !== null || payment.orderId !== orderId) {
    return NextResponse.json({ error: "Không tìm thấy khoản thu" }, { status: 404 });
  }

  const [collector, coSo, khoaTheoId] = await Promise.all([
    payment.recordedById
      ? sdb.user.findUnique({ where: { id: payment.recordedById }, select: { name: true } })
      : Promise.resolve(null),
    payment.order?.centerId
      ? sdb.center.findUnique({ where: { id: payment.order.centerId }, select: { code: true } })
      : Promise.resolve(null),
    napKhoaTheoDong(sdb, dongDonTuKhoan(payment)),
  ]);

  const kq = await taoPdfPhieuThu({ khoan: payment, nguoiThu: collector?.name ?? null, centerCode: coSo?.code ?? null, khoaTheoId });
  if (!kq.ok) return NextResponse.json({ error: kq.loi }, { status: kq.status });

  return new NextResponse(new Uint8Array(kq.pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${kq.tenTep}"`,
      "Cache-Control": "no-store",
    },
  });
}
