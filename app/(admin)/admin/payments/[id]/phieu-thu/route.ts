// #15 (câu 26) — bản IN phiếu thu (PDF). Kế toán/quản lý bấm mã phiếu ở màn thanh
// toán → mở PDF. Gate: auth + payments:manage; cách ly cơ sở qua scopedDb (findUnique
// trả null nếu khoản thuộc cơ sở khác → 404, chống IDOR). Chỉ in khi đã có phiếu ACTIVE.
//
// 12/11/2026 — phần DỰNG PDF nằm ở `lib/pdf/phieu-thu-khoan.ts` (dùng chung với route của Sale ở trang đơn và route của
// phụ huynh): route này chỉ còn lo quyền + cách ly cơ sở + nạp khoản.
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
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  if (!(await checkPermission("payments:manage"))) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  const { id } = await params;
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // Payment ∈ SCOPED_MODELS → findUnique áp passesScope (khoản cơ sở khác → null).
  const payment = await sdb.payment.findUnique({ where: { id }, include: KHOAN_PHIEU_THU_INCLUDE });
  if (!payment) {
    return NextResponse.json({ error: "Không tìm thấy khoản thu" }, { status: 404 });
  }

  // ⚠️ Tra `Center` CHỈ để lấy `code`, KHÔNG lấy tên/địa chỉ: bên bán trên phiếu là PHÁP NHÂN, không phải cơ sở.
  // `macDinhTheoCoSo` khớp theo `Center.code` ("CS1"/"CS2"), còn `Order.centerId` giữ `Center.id` (slug) — xem phieu-thu-khoan.ts.
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
