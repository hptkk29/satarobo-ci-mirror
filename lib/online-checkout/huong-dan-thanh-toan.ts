import type { PrismaClient } from "@prisma/client";

import { sumRecorded } from "@/lib/finance/ghi-nhan";
import { VIETQR_ADDINFO_MAX, buildVietQrImageUrl } from "@/lib/payments/vietqr";

import { TRUONG_CAN_QUAN_TRI_TOI_CAO, docSnapshot, khoaProdDaMo, noiDungChuyenKhoan } from "./cau-hinh-thanh-toan";

/**
 * V8.17 G5 → V8.18 — HƯỚNG DẪN THANH TOÁN cho đơn Online. ĐỌC thuần, KHÔNG ghi gì, KHÔNG gọi ngân hàng.
 *
 * Nguồn: BẢN CHỤP thông tin nhận tiền ĐÃ PHÁT HÀNH cho đơn (`Order.onlinePaymentSnapshot`, ghi lúc tạo đơn từ cấu hình của Quản trị tối cao — xem `cau-hinh-thanh-toan.ts`).
 * Không có bản chụp (chưa có cấu hình lúc tạo đơn) ⇒ BLOCKED_CONFIG (`CHUA_CAU_HINH`): app KHÔNG vẽ QR. Không bao giờ suy tài khoản từ nơi khác.
 * Nội dung CK = `SR` + mã tham chiếu duy nhất của đơn (mã phiếu thu) ⇒ không nhận nhầm đơn khác. TEST ⇒ nhãn TEST, `choPhepChuyenTien:false`, KHÔNG dựng ảnh QR.
 * PROD chỉ hiện khi khoá mở PROD của Owner đang đặt (kiểm lại LÚC ĐỌC — fail-closed).
 */

type Db = PrismaClient;

export type HuongDanThanhToan =
  | {
      trangThai: "SAN_SANG";
      moiTruong: "THAT" | "THU_NGHIEM";
      /** false ở chế độ TEST: app phải hiện nhãn «TEST — không chuyển tiền thật» và KHÔNG cho thao tác chuyển. */
      choPhepChuyenTien: boolean;
      nhan: string | null;
      nganHang: { ma: string; ten: string | null };
      soTaiKhoan: string;
      tenTaiKhoan: string;
      soTien: number;
      noiDung: string;
      /** URL ảnh VietQR (chỉ PROD). TEST ⇒ null. */
      anhQrUrl: string | null;
      /** Đơn vị bán/nhận tiền/xuất hoá đơn: pháp nhân SataRobo đã chụp lúc tạo đơn. */
      donViBan: { tenPhapLy: string; maSoThue: string };
    }
  | { trangThai: "CHUA_CAU_HINH"; lyDo: string; thongTinCanOwnerCungCap: readonly string[] }
  | { trangThai: "CAU_HINH_KHONG_HOP_LE"; lyDo: string }
  | { trangThai: "KHONG_CAN"; lyDo: string };

export type TrangThaiHuongDan = HuongDanThanhToan["trangThai"];

/** Chỉ dùng cho đơn của chính phụ huynh (người gọi đã kiểm sở hữu). */
export async function dungHuongDanThanhToan(db: Db, orderId: string): Promise<HuongDanThanhToan> {
  const don = await db.order.findFirst({ where: { id: orderId, type: "ONLINE", deletedAt: null }, select: { status: true, totalAmount: true, onlinePaymentSnapshot: true } });
  if (!don) return { trangThai: "KHONG_CAN", lyDo: "Không có đơn." };
  if (don.status === "CANCELLED") return { trangThai: "KHONG_CAN", lyDo: "Đơn đã huỷ — không thanh toán." };
  // V8.40 — đơn ĐÃ CÓ HOÀN TIỀN (đã chi hoặc đang chờ chi): tiền thu «thiếu» là do hoàn chứ KHÔNG phải khách chưa trả — tuyệt đối không dựng hướng dẫn thu lại.
  const coHoan = don.status === "REFUNDED" || (await db.refundRequest.count({ where: { kenh: "ONLINE", status: { in: ["APPROVED", "PAID"] }, orderItem: { orderId } } })) > 0;
  if (coHoan) return { trangThai: "KHONG_CAN", lyDo: "Đơn đã có hoàn tiền — không thanh toán thêm." };
  const conThieu = don.totalAmount - (await sumRecorded(orderId));
  if (conThieu <= 0) return { trangThai: "KHONG_CAN", lyDo: "Đơn đã thu đủ." };

  const sn = docSnapshot(don.onlinePaymentSnapshot);
  if (!sn) {
    return { trangThai: "CHUA_CAU_HINH", lyDo: "Đơn này được tạo khi chưa có cấu hình thu tiền Online của Quản trị tối cao nên chưa có thông tin nhận tiền đã phát hành. Cần cấu hình rồi tạo lại đơn.", thongTinCanOwnerCungCap: TRUONG_CAN_QUAN_TRI_TOI_CAO };
  }
  if (sn.mode === "PROD" && !khoaProdDaMo()) return { trangThai: "CAU_HINH_KHONG_HOP_LE", lyDo: "Chế độ PROD chưa được mở (chờ Owner xác minh tài khoản ngân hàng chính thức)." };

  const phieu = await db.paymentRequest.findFirst({ where: { orderId, status: { in: ["PENDING", "PARTIAL"] } }, orderBy: { installmentNo: "asc" }, select: { matchKey: true } });
  if (!phieu?.matchKey) return { trangThai: "CAU_HINH_KHONG_HOP_LE", lyDo: "Đơn chưa có phiếu thu đang mở để đối khớp tiền." };
  // `matchKey` của đơn Online ĐÃ là `SR{ma}` (đặt lúc tạo đơn từ tiền tố chụp) — nội dung CK = chính nó.
  const noiDung = phieu.matchKey.startsWith(sn.memoPrefix) ? noiDungChuyenKhoan(sn.memoPrefix, phieu.matchKey.slice(sn.memoPrefix.length)) : null;
  if (!noiDung) return { trangThai: "CAU_HINH_KHONG_HOP_LE", lyDo: `Nội dung chuyển khoản (${sn.memoPrefix} + mã đơn) vượt ${VIETQR_ADDINFO_MAX} ký tự.` };

  const thu = sn.mode === "TEST";
  return {
    trangThai: "SAN_SANG",
    moiTruong: thu ? "THU_NGHIEM" : "THAT",
    choPhepChuyenTien: !thu,
    nhan: thu ? "TEST — KHÔNG CHUYỂN TIỀN THẬT" : null,
    nganHang: sn.nganHang,
    soTaiKhoan: sn.soTaiKhoan,
    tenTaiKhoan: sn.tenTaiKhoan,
    soTien: conThieu,
    noiDung,
    anhQrUrl: thu ? null : buildVietQrImageUrl({ bankBin: sn.nganHang.ma, accountNumber: sn.soTaiKhoan, accountName: sn.tenTaiKhoan }, conThieu, noiDung),
    donViBan: { tenPhapLy: sn.phapNhan.tenPhapLy, maSoThue: sn.phapNhan.maSoThue },
  };
}
