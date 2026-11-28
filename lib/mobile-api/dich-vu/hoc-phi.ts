import { getPaymentMethodLabels } from "@/lib/portal/billing";
import { getStudentBilling } from "@/lib/portal/billing-student";

import { nhanNgay } from "../dinh-dang";
import type { MaHocVienDaKiem } from "../so-huu";
import { khoanTaiDuocPhieuThu } from "./hoa-don";

/**
 * NHÓM 4 (B4) — `GET /students/:id/billing`: học phí & công nợ của MỘT con, CHỈ ĐỌC.
 *
 * ⛔ KHÔNG tính lại tiền ở đây: mọi con số ("đã đóng", "còn nợ", "kỳ đến hạn") là KẾT QUẢ của `getStudentBilling` (cùng nguồn trang `/portal/hoc-phi` của web), mà nó dựa vào các hàm kế toán sẵn có
 * (`laKhoanDaDong`, `tongDaDong`, `computeEnrollmentDebt`). Khoản bị kế toán TỪ CHỐI không được tính là đã đóng (luật của hàm nguồn); khoản chờ xác nhận chỉ được ĐẾM, không lộ số tiền.
 * Không có thao tác ghi nào (thanh toán / hoàn tiền / hoá đơn / mã QR) — chưa có quyết định nghiệp vụ. Số tiền trả cả SỐ NGUYÊN ĐỒNG lẫn NHÃN đã định dạng.
 * DTO chọn từng trường: bỏ `orderId`/`orderCode`/`enrollmentId` thô của phiếu thu, `studentName`, `receiptCode`, `coPhieuThuTai` (tệp phiếu thu là P1, cần đường ký sẵn), mọi URL.
 */
const TIEN = new Intl.NumberFormat("vi-VN");
export const nhanTien = (dong: number): string => `${TIEN.format(dong)} ₫`;

export type KhoanHocPhiDto = { id: string; tenKhoa: string | null; tenLop: string | null; hocPhi: number; nhanHocPhi: string; daDong: number; nhanDaDong: string; conNo: number; nhanConNo: string; chuaChotGia: boolean };
/** `coPhieuThu`: có TẢI ĐƯỢC phiếu thu cho khoản này không (đã đóng + có biên nhận + đơn thuộc nhóm «phiếu thu», không phải nhóm hoá đơn) — app chỉ vẽ nút khi true. */
export type PhieuThuDto = { id: string; nhanNgay: string; soTien: number; nhanSoTien: string; nhanHinhThuc: string; loai: "PAYMENT" | "ADJUSTMENT"; coPhieuThu: boolean };
export type HocPhiDto = {
  tomTat: {
    tongHocPhi: number;
    nhanTongHocPhi: string;
    daDong: number;
    nhanDaDong: string;
    conNo: number;
    nhanConNo: string;
    nhanKyDenHan: string | null;
    tamHoanThu: { denNgay: string | null } | null;
    /** Chỉ ĐẾM — không lộ số tiền của khoản đang chờ / bị từ chối. */
    dangCho: number;
    biTuChoi: number;
  };
  khoan: KhoanHocPhiDto[];
  daDong: PhieuThuDto[];
};

export async function layHocPhi(hs: MaHocVienDaKiem, now: Date = new Date()): Promise<HocPhiDto> {
  const [b, nhanHinhThuc] = await Promise.all([getStudentBilling(hs, now), getPaymentMethodLabels()]);
  const taiDuoc = await khoanTaiDuocPhieuThu(hs, b.receipts.map((p) => p.id));
  return {
    tomTat: {
      tongHocPhi: b.tuition,
      nhanTongHocPhi: nhanTien(b.tuition),
      daDong: b.paid,
      nhanDaDong: nhanTien(b.paid),
      conNo: b.outstanding,
      nhanConNo: nhanTien(b.outstanding),
      nhanKyDenHan: b.nextDueDate ? nhanNgay(b.nextDueDate) : null,
      tamHoanThu: b.tamHoanThu ? { denNgay: b.tamHoanThu.denNgay ? nhanNgay(b.tamHoanThu.denNgay) : null } : null,
      dangCho: b.pendingCount,
      biTuChoi: b.rejectedCount,
    },
    khoan: b.rows.map((r) => ({
      id: r.enrollmentId,
      tenKhoa: r.courseName,
      tenLop: r.className,
      hocPhi: r.finalPrice,
      nhanHocPhi: nhanTien(r.finalPrice),
      daDong: r.paid,
      nhanDaDong: nhanTien(r.paid),
      conNo: r.outstanding,
      nhanConNo: nhanTien(r.outstanding),
      chuaChotGia: r.chuaChotGia,
    })),
    daDong: b.receipts.map((p) => ({
      id: p.id,
      nhanNgay: nhanNgay(p.paidDate),
      soTien: p.amount,
      nhanSoTien: nhanTien(p.amount),
      // Nhãn do CÙNG hàm của web giải mã (`getPaymentMethodLabels`); mã lạ ⇒ in nguyên mã như web, không đoán.
      nhanHinhThuc: nhanHinhThuc[p.method] ?? p.method,
      loai: p.paymentType === "ADJUSTMENT" ? "ADJUSTMENT" : "PAYMENT",
      coPhieuThu: taiDuoc.has(p.id),
    })),
  };
}
