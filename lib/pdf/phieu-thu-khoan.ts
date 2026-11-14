// lib/pdf/phieu-thu-khoan.ts — DỰNG PDF PHIẾU THU của MỘT khoản thu (`Payment`), dùng chung cho BA nơi tải phiếu (12/11/2026):
//   · kế toán  — app/(admin)/admin/payments/[id]/phieu-thu/route.ts          (payments:manage)
//   · Sale     — app/(admin)/admin/orders/[id]/phieu-thu/[paymentId]/route.ts (orders:view + scopedDb)
//   · phụ huynh — app/(portal)/portal/hoa-don/phieu-thu/[paymentId]/route.ts  (chủ sở hữu học viên)
//
// MỘT chỗ dựng ⇒ ba nơi cho ra CÙNG một tờ (cùng pháp nhân, cùng số, cùng dòng thu). Mỗi route tự lo QUYỀN và CÁCH LY (scopedDb /
// kiểm sở hữu) rồi mới đưa khoản đã nạp vào đây — hàm này KHÔNG kiểm quyền gì.
//
// ⚠️ PHÁP NHÂN theo CƠ SỞ THU TIỀN: `Center.code` của đơn → `phapNhanChoDon` (cấu hình hoá đơn hiện hành). Không dò theo cơ sở của lớp,
// không đoán theo địa chỉ; không có pháp nhân bật ⇒ 409 chứ KHÔNG in mã số thuế đoán bừa (xem route kế toán cũ).
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { Prisma } from "@prisma/client";
import { withFreshFonts } from "@/lib/pdf/brand";
import { PhieuThuPdf } from "@/lib/pdf/phieu-thu";
import { lookupMethodNameByCode } from "@/lib/payments/method-lookup";
import { nhaCungCapHieuLuc, phapNhanChoDon, phapNhanVoiNhaCungCap } from "@/lib/finance/hoa-don/phap-nhan";
import { docNhaCungCapDaChon } from "@/lib/finance/hoa-don/ket-noi/ket-noi-db";
import { cauHinhHoaDonChoMoiTruong } from "@/lib/finance/hoa-don/phap-nhan-theo-moi-truong";
import { dongDonCuaKhoan, dungPhieuThuData, tenHocVienChoKhoan } from "@/lib/finance/hoa-don/phieu-thu-data";
import { suyCacDongKhoa, type KhoaCoSoBuoi } from "@/lib/finance/hoa-don/ten-dong-hoc-phi";
import { docCauHinhDangBatTrongTx } from "@/lib/finance/hoa-don/cau-hinh-co-so-db";
import { timCauHinhTheoNgay } from "@/lib/finance/hoa-don/cau-hinh-co-so";
import type { CauHinhHoaDon, PhapNhan } from "@/lib/finance/hoa-don/phap-nhan";
import { db } from "@/lib/db";
import { vnYmd } from "@/lib/time/vn";

const DONG_DON = { itemName: true, type: true, quantity: true, totalPrice: true, discountAmount: true, metadata: true, student: { select: { name: true } } } as const;

/** Phần của `Payment` mà tờ phiếu cần. Dùng CHUNG ở mọi route để không route nào quên một cột. */
export const KHOAN_PHIEU_THU_INCLUDE = {
  order: {
    select: {
      code: true,
      type: true,
      centerId: true,
      createdAt: true,
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
      invoiceCustomerCode: true,
      invoiceEmail: true,
      student: { select: { name: true, parentName: true } },
      // Dòng đơn — tên + đơn vị của tờ phiếu đơn KIT / THI (`dongDonCuaKhoan`).
      items: { select: DONG_DON },
    },
  },
  enrollment: {
    select: {
      class: { select: { name: true, course: { select: { name: true } } } },
      student: { select: { name: true } },
    },
  },
  orderItem: { select: DONG_DON },
  receipts: {
    where: { status: "ACTIVE" as const },
    select: { code: true, issuedAt: true },
    orderBy: { issuedAt: "desc" as const },
    take: 1,
  },
} satisfies Prisma.PaymentInclude;

export type KhoanPhieuThu = Prisma.PaymentGetPayload<{ include: typeof KHOAN_PHIEU_THU_INCLUDE }>;

/** Dòng đơn của khoản — để route nạp tên khoá (`napKhoaTheoDong`) rồi truyền lại cho `taoPdfPhieuThu`. */
export const dongDonTuKhoan = (k: KhoanPhieuThu) => dongDonCuaKhoan(k, k.order?.items);

/**
 * PHÁP NHÂN ĐÃ THU TIỀN theo CẤU HÌNH HOÁ ĐƠN CỦA CƠ SỞ × NGÀY (`CauHinhHoaDonCoSo`) — CÙNG nguồn mà màn hoá đơn dùng để biết «cơ sở này, ngày này, phát
 * hành dưới pháp nhân nào». Phiếu thu phải đứng tên đúng pháp nhân đó, nếu không sẽ lệch với hoá đơn GTGT phát hành sau.
 * Không có cấu hình ĐANG BẬT cho cơ sở/ngày (hoặc mơ hồ: hai dòng chồng ngày) ⇒ `null` — người gọi rơi về `macDinhTheoCoSo` (`phapNhanChoDon`).
 * ⚠️ Chỉ nhận pháp nhân ĐANG BẬT trong cấu hình chung: dòng cơ sở trỏ vào pháp nhân đã tắt ⇒ `null`, không in tên pháp nhân đã đóng.
 */
export async function phapNhanTheoCauHinhCoSo(centerId: string | null | undefined, ngayThu: Date, cauHinh: CauHinhHoaDon): Promise<PhapNhan | null> {
  if (!centerId) return null;
  const dongCoSo = await docCauHinhDangBatTrongTx({ cauHinhHoaDonCoSo: db.cauHinhHoaDonCoSo }, centerId);
  const kq = timCauHinhTheoNgay(dongCoSo, centerId, vnYmd(ngayThu));
  if (kq.loai !== "CO") return null;
  return cauHinh.phapNhan.find((p) => p.bat && p.ma === kq.cauHinh.phapNhanMa) ?? null;
}

export type KetQuaPdfPhieuThu =
  | { ok: true; pdf: Buffer; tenTep: string }
  | { ok: false; status: 404 | 409 | 500; loi: string };

const anToan = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .replace(/_+/g, "_");

const ngayVN = (d: Date): string =>
  new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(d));

/**
 * Dựng PDF phiếu thu của một khoản ĐÃ CÓ PHIẾU (Receipt ACTIVE). Khoản chưa xác nhận ⇒ 404 (bản chờ là đường riêng của kế toán).
 * `centerCode` = `Center.code` của cơ sở của ĐƠN ("CS1"/"CS2"), KHÔNG phải `Center.id` (slug) — truyền slug là không bao giờ khớp.
 */
export async function taoPdfPhieuThu(p: {
  khoan: KhoanPhieuThu;
  nguoiThu: string | null;
  centerCode: string | null;
  khoaTheoId: ReadonlyMap<string, KhoaCoSoBuoi>;
}): Promise<KetQuaPdfPhieuThu> {
  const { khoan: payment } = p;
  const receipt = payment.receipts[0];
  if (!receipt) return { ok: false, status: 404, loi: "Khoản chưa được xác nhận — chưa có phiếu thu để in" };

  const cauHinh = cauHinhHoaDonChoMoiTruong();
  // Ưu tiên cấu hình hoá đơn THEO CƠ SỞ × NGÀY (nguồn của màn hoá đơn); rơi về ánh xạ mặc định theo mã cơ sở khi chưa có dòng nào.
  const phapNhanMacDinh =
    (await phapNhanTheoCauHinhCoSo(payment.order?.centerId, payment.paidDate, cauHinh)) ?? phapNhanChoDon(p.centerCode, cauHinh);
  if (!phapNhanMacDinh) {
    return {
      ok: false,
      status: 409,
      loi: "Chưa khai pháp nhân phát hành trong Cấu hình hoá đơn — không in phiếu với mã số thuế đoán bừa",
    };
  }
  // Dòng «… phát hành» in trên phiếu đọc `phanMem` — phải là nhà cung cấp ĐÃ CHỌN ở «Kết nối & ký», không phải hằng số trong mã.
  const phapNhan = phapNhanVoiNhaCungCap(phapNhanMacDinh, nhaCungCapHieuLuc(phapNhanMacDinh, await docNhaCungCapDaChon(phapNhanMacDinh.ma)));

  // Mã phương thức có thể là mã riêng của cơ sở ("BANK_CS1") — tờ phiếu đưa tận tay phụ huynh nên không in mã nội bộ.
  const methodLabel = await lookupMethodNameByCode(payment.method);

  const dongDon = dongDonTuKhoan(payment);
  const data = dungPhieuThuData({
    maPhieu: receipt.code,
    ngayLap: ngayVN(receipt.issuedAt),
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
      invoiceCustomerCode: payment.order?.invoiceCustomerCode ?? null,
      invoiceEmail: payment.order?.invoiceEmail ?? null,
    },
    soTien: payment.amount,
    // Tra nhãn từ DANH MỤC (không lọc isActive: phương thức đã tắt vẫn phải in đúng tên trên phiếu thu CŨ).
    hinhThucThanhToan: methodLabel?.trim() || payment.method,
    tenKhoa: payment.enrollment?.class?.course?.name ?? null,
    tenHocVien: tenHocVienChoKhoan(payment, payment.order?.student),
    tenLop: payment.enrollment?.class?.name ?? null,
    nguoiThu: p.nguoiThu,
    dongDon,
    cacDongKhoa: suyCacDongKhoa({ dongDon, khoaTheoId: p.khoaTheoId, khoaGhiDanh: payment.enrollment?.class?.course ?? null }),
  });

  try {
    const pdf = await withFreshFonts(() =>
      renderToBuffer(createElement(PhieuThuPdf, { data }) as unknown as ReactElement<DocumentProps>),
    );
    return { ok: true, pdf, tenTep: `PhieuThu-${anToan(receipt.code)}.pdf` };
  } catch (err) {
    return { ok: false, status: 500, loi: `Lỗi tạo PDF: ${err instanceof Error ? err.message : "Unknown"}` };
  }
}
