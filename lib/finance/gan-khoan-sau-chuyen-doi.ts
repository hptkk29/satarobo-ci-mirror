// lib/finance/gan-khoan-sau-chuyen-doi.ts — GẮN KHOẢN ĐÃ THU VÀO GHI DANH NGAY SAU "CHUYỂN ĐỔI ĐƠN" (#666).
//
// ── Con bug đóng ở đây ──
// `chuyenDoiDonAction` (trang đơn → Chuyển đổi) tạo Enrollment và gán `OrderItem.enrollmentId`, nhưng
// KHÔNG gắn các khoản đã ghi nhận có sẵn vào ghi danh như `convertLeadV2` làm (`linkRecordedPayments…`).
// Khoản đó mãi `enrollmentId = NULL` ⇒ màn Khoản thu in "Chờ convert", kế toán không có nút Xác nhận,
// không có Receipt. Lỗi chung MỌI đường tiền (không riêng thẻ POS) và có trên prod.
//
// ── Vì sao KHÔNG gọi thẳng `ganGhiDanhChoKhoanCuaDon` ở action ──
// Action cho chuyển đổi TỪNG PHẦN (chọn một bé, bé kia để lần sau). Lúc ấy dòng của bé kia còn
// `studentId = NULL`, nên `chiaKhoanTheoDon` bậc "theo học viên" chỉ thấy MỘT bé trên đơn và đẩy NGUYÊN
// khoản — kể cả phần của bé kia — về ghi danh của bé này. Khoản đã gắn thì lần chuyển đổi sau không
// còn thấy nó để chia lại: bé A bị ghi thu thừa, bé B nợ nguyên. Tệ hơn cả "Chờ convert".
// Nên: CÒN dòng khoá học chưa chuyển đổi ⇒ KHÔNG gắn lượt này; lượt chuyển đổi dòng cuối cùng sẽ gắn
// (lúc đó mọi dòng đều có học viên, phép chia theo tiền dòng đúng).
// ⚠️ Hệ quả có chủ đích: đơn có dòng KHÔNG BAO GIỜ chuyển đổi ("1 con nghỉ") giữ khoản ở "Chờ convert" như
// hiện trạng — kế toán gắn tay theo bé (`ganKhoanDaThuChoCon`). Không đoán phần tiền của bé nghỉ.
//
// Khoản ĐÃ XÁC NHẬN mà chưa gắn (chỉ đơn SCOPE có) bị LOẠI, không ném: đường này trước đây chưa từng
// đụng tiền, ném ở đây là thêm một cách làm hỏng cả lượt chuyển đổi đang chạy được.
import type { Prisma } from "@prisma/client";
import type { AuditActor } from "@/lib/audit/audit-log";
import { ganGhiDanhChoKhoanCuaDon, xemTruocGanGhiDanhChoKhoanCuaDon } from "@/lib/finance/payment";
import type { DuLieuGanGhiDanh } from "@/lib/finance/payment";
import type { KeHoachGan } from "@/lib/finance/ke-hoach-gan-ghi-danh";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";

type Tx = Prisma.TransactionClient;

/** THUẦN — số dòng KHOÁ HỌC (metadata có `courseId`) của đơn mà chưa có ghi danh. */
export function soDongKhoaChuaChuyen(
  dong: readonly { enrollmentId: string | null; metadata: unknown }[],
): number {
  return dong.filter((d) => d.enrollmentId === null && docHinhThucLop(d.metadata).courseId !== null).length;
}

/** MỘT chỗ đọc "đơn còn mấy dòng khoá học chưa chuyển đổi" — bản ghi thật và bản xem trước cùng dùng. */
async function demDongKhoaChuaChuyenCuaDon(tx: Tx, orderId: string): Promise<number> {
  const dong = await tx.orderItem.findMany({
    where: { orderId },
    select: { enrollmentId: true, metadata: true },
  });
  return soDongKhoaChuaChuyen(dong);
}

export type KetQuaGanSauChuyenDoi =
  | { daChay: false; lyDo: "CON_DONG_CHUA_CHUYEN"; soDongChuaChuyen: number }
  | { daChay: true; linked: number; splitCreated: number; boQua: number };

/**
 * Chạy TRONG transaction của lượt chuyển đổi, SAU khi mọi `Enrollment` đã tạo và `OrderItem.enrollmentId`
 * đã gán (đọc lại từ chính `tx` nên thấy phép ghi của lượt này). Idempotent: không còn khoản chưa gắn thì
 * không làm gì.
 */
export async function ganKhoanSauChuyenDoi(
  tx: Tx,
  params: { orderId: string; actor: AuditActor },
): Promise<KetQuaGanSauChuyenDoi> {
  const conLai = await demDongKhoaChuaChuyenCuaDon(tx, params.orderId);
  if (conLai > 0) return { daChay: false, lyDo: "CON_DONG_CHUA_CHUYEN", soDongChuaChuyen: conLai };

  const kq = await ganGhiDanhChoKhoanCuaDon(tx, {
    orderId: params.orderId,
    actor: params.actor,
    khoanDaXacNhan: "BO_QUA",
  });
  return { daChay: true, ...kq };
}

export type XemTruocGanSauChuyenDoi =
  | { daChay: false; lyDo: "CON_DONG_CHUA_CHUYEN"; soDongChuaChuyen: number }
  | { daChay: true; coKhoan: false }
  | { daChay: true; coKhoan: true; duLieu: DuLieuGanGhiDanh; keHoach: KeHoachGan; boQuaDaXacNhan: number };

/**
 * Bản XEM TRƯỚC của `ganKhoanSauChuyenDoi` — CHỈ ĐỌC (không một phép ghi nào, chạy được với user chỉ-đọc).
 * Đi qua CÙNG cổng "còn dòng chưa chuyển" và CÙNG `xemTruocGanGhiDanhChoKhoanCuaDon` mà bản ghi thật dùng, nên
 * kế hoạch in ra chính là kế hoạch `--apply` sẽ ghi.
 */
export async function xemTruocGanKhoanSauChuyenDoi(
  tx: Tx,
  params: { orderId: string },
): Promise<XemTruocGanSauChuyenDoi> {
  const conLai = await demDongKhoaChuaChuyenCuaDon(tx, params.orderId);
  if (conLai > 0) return { daChay: false, lyDo: "CON_DONG_CHUA_CHUYEN", soDongChuaChuyen: conLai };

  const xem = await xemTruocGanGhiDanhChoKhoanCuaDon(tx, { orderId: params.orderId, khoanDaXacNhan: "BO_QUA" });
  if (!xem) return { daChay: true, coKhoan: false };
  return { daChay: true, coKhoan: true, ...xem };
}
