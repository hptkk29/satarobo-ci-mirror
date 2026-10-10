// #15 (câu 26) — bản IN phiếu thu (PDF). Kế toán/quản lý bấm mã phiếu ở màn thanh
// toán → mở PDF. Gate: auth + payments:manage; cách ly cơ sở qua scopedDb (findUnique
// trả null nếu khoản thuộc cơ sở khác → 404, chống IDOR). Chỉ in khi đã có phiếu ACTIVE.
import { createElement, type ReactElement } from "react";
import { NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { withFreshFonts } from "@/lib/pdf/brand";
import { lookupMethodNameByCode } from "@/lib/payments/method-lookup";
import { PhieuThuPdf } from "@/lib/pdf/phieu-thu";
import { CAU_HINH_HOA_DON_MAC_DINH, phapNhanChoDon } from "@/lib/finance/hoa-don/phap-nhan";
import { dongDonCuaKhoan, dungPhieuThuData, tenHocVienChoKhoan } from "@/lib/finance/hoa-don/phieu-thu-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeFilename(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .replace(/_+/g, "_");
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(d));
}

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
  const payment = await sdb.payment.findUnique({
    where: { id },
    include: {
      order: {
        select: {
          code: true,
          type: true,
          centerId: true,
          customerName: true,
          customerPhone: true,
          customerEmail: true,
          customerAddress: true,
          customerWard: true,
          customerCity: true,
          customerCccd: true,
          invoiceBuyerName: true,
          invoiceCompanyName: true,
          invoiceTaxCode: true,
          invoiceEmail: true,
          student: { select: { name: true, parentName: true } },
          // Dòng đơn — tên + đơn vị của tờ phiếu đơn KIT / THI (`dongDonCuaKhoan`).
          items: { select: { itemName: true, type: true, quantity: true, totalPrice: true, discountAmount: true } },
        },
      },
      enrollment: {
        select: {
          class: { select: { name: true, course: { select: { name: true } } } },
          student: { select: { name: true } },
        },
      },
      orderItem: { select: { itemName: true, type: true, quantity: true, totalPrice: true, discountAmount: true, student: { select: { name: true } } } },
      receipts: {
        where: { status: "ACTIVE" },
        select: { code: true, issuedAt: true },
        orderBy: { issuedAt: "desc" },
        take: 1,
      },
    },
  });

  if (!payment) {
    return NextResponse.json({ error: "Không tìm thấy khoản thu" }, { status: 404 });
  }

  const receipt = payment.receipts[0];
  if (!receipt) {
    return NextResponse.json(
      { error: "Khoản chưa được xác nhận — chưa có phiếu thu để in" },
      { status: 404 },
    );
  }

  // Người thu — `recordedById` là String thuần, không có quan hệ Prisma.
  //
  // ⚠️ Tra `Center` CHỈ để lấy `code`, KHÔNG lấy tên/địa chỉ. Bên bán trên phiếu là PHÁP
  // NHÂN, không phải cơ sở: hai tờ mẫu mang hai mã số thuế khác nhau, và "258 Lê Thanh
  // Nghị" (trụ sở đăng ký của Sata Robo) không phải địa chỉ của cơ sở nào. In tên/địa chỉ
  // cơ sở vào ô "Đơn vị thu" là in sai pháp nhân.
  //
  // ⚠️ `macDinhTheoCoSo` khớp theo `Center.code` ("CS1"/"CS2"), còn `Order.centerId` giữ
  // `Center.id` (slug "co-so-hoang-dieu"). Truyền thẳng `centerId` vào `phapNhanChoDon` là
  // KHÔNG BAO GIỜ khớp dòng khai nào rồi âm thầm rơi về pháp nhân mặc định — tức in sai mã
  // số thuế mà không lỗi nào báo. Tôi vừa viết đúng cái đó ở bản trước; nay đổi id→code.
  const [collector, coSo] = await Promise.all([
    payment.recordedById
      ? sdb.user.findUnique({ where: { id: payment.recordedById }, select: { name: true } })
      : Promise.resolve(null),
    payment.order?.centerId
      ? sdb.center.findUnique({ where: { id: payment.order.centerId }, select: { code: true } })
      : Promise.resolve(null),
  ]);

  // 30/08/2026 — mã phương thức nay có thể là mã riêng của cơ sở ("BANK_CS1"), không
  // nằm trong bảng nhãn cứng của lib/pdf/receipt.tsx. Tờ phiếu này đưa tận tay phụ
  // huynh nên không được in mã nội bộ.
  const methodLabel = await lookupMethodNameByCode(payment.method);

  // ── BỘ SỐ LẤY TỪ TẦNG THUẦN HOÁ ĐƠN [15/09/2026] ───────────────────────────
  //
  // `lib/finance/hoa-don/*` đã đo sẵn từ ba tờ thật (pháp nhân, thuế suất theo loại đơn,
  // quy ước giá đã-gồm/chưa-gồm thuế, khối người mua, số tiền bằng chữ). Dùng lại để con
  // số trên phiếu KHỚP với con số kế toán sẽ nạp sang MISA/VIN — không phải nhập lại.
  //
  // ⚠️ `phapNhanChoDon` trả `null` khi không còn pháp nhân nào BẬT. Khi đó KHÔNG in một
  // mã số thuế đoán bừa: trả 409 để kế toán đi khai cấu hình.
  const cauHinh = CAU_HINH_HOA_DON_MAC_DINH;
  const phapNhan = phapNhanChoDon(coSo?.code ?? null, cauHinh);
  if (!phapNhan) {
    return NextResponse.json(
      {
        error:
          "Chưa khai pháp nhân phát hành trong Cấu hình hoá đơn — không in phiếu với mã số thuế đoán bừa",
      },
      { status: 409 },
    );
  }

  // Dữ liệu tờ phiếu đi qua MỘT công thức dùng chung với bản CHỜ XÁC NHẬN
  // (`lib/finance/hoa-don/phieu-thu-data.ts`) — kế toán làm hoá đơn MISA theo bản chờ, nên tờ
  // chính thức in sau phải ra đúng cùng dòng thu / thuế / người mua.
  const data = dungPhieuThuData({
    maPhieu: receipt.code,
    ngayLap: fmtDate(receipt.issuedAt),
    phapNhan,
    cauHinh,
    don: {
      code: payment.order?.code ?? null,
      type: payment.order?.type ?? null,
      customerName: payment.order?.customerName ?? null,
      customerPhone: payment.order?.customerPhone ?? null,
      customerEmail: payment.order?.customerEmail ?? null,
      customerAddress: payment.order?.customerAddress ?? null,
      customerWard: payment.order?.customerWard ?? null,
      customerCity: payment.order?.customerCity ?? null,
      customerCccd: payment.order?.customerCccd ?? null,
      invoiceBuyerName: payment.order?.invoiceBuyerName ?? null,
      invoiceCompanyName: payment.order?.invoiceCompanyName ?? null,
      invoiceTaxCode: payment.order?.invoiceTaxCode ?? null,
      invoiceEmail: payment.order?.invoiceEmail ?? null,
    },
    soTien: payment.amount,
    // Tra nhãn từ DANH MỤC (không lọc isActive: phương thức đã tắt vẫn phải in đúng tên
    // trên phiếu thu CŨ).
    hinhThucThanhToan: methodLabel?.trim() || payment.method,
    tenKhoa: payment.enrollment?.class?.course?.name ?? null,
    tenHocVien: tenHocVienChoKhoan(payment, payment.order?.student),
    tenLop: payment.enrollment?.class?.name ?? null,
    nguoiThu: collector?.name ?? null,
    dongDon: dongDonCuaKhoan(payment, payment.order?.items),
  });

  let pdf: Buffer;
  try {
    pdf = await withFreshFonts(() =>
      renderToBuffer(
        createElement(PhieuThuPdf, { data }) as unknown as ReactElement<DocumentProps>,
      ),
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Lỗi tạo PDF: ${err instanceof Error ? err.message : "Unknown"}` },
      { status: 500 },
    );
  }

  const filename = `PhieuThu-${safeFilename(receipt.code)}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
