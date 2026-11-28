import { db } from "@/lib/db";
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";

import { nhanTien } from "./hoc-phi";
import { LoiApiMobile } from "../xac-thuc/dich-vu";

/**
 * V8 — `GET /parent/orders/:orderId/payment-status`: TRẠNG THÁI THANH TOÁN của MỘT đơn, SUY RA từ bản ghi thật (Order · Payment · QrSession) — CHỈ ĐỌC.
 *
 * ⛔ KHÔNG bao giờ lấy "thành công" từ client (URL chuyển hướng sau cổng thanh toán, bộ đếm giờ ở giao diện): app chỉ HỎI lại endpoint này (poll an toàn, idempotent).
 * ⛔ KHÔNG cam kết thời gian mở khoá, hoàn tiền, thông báo Zalo — mọi câu chữ đó trong bản thiết kế là chữ MINH HOẠ, chưa phải chính sách Owner đã duyệt.
 *
 * Sự thật dữ liệu hôm nay (đã đo trong mã, không suy diễn):
 *   · TIỀN VỀ  = Σ `Payment` thoả `KHOAN_DA_GHI_NHAN` (cùng điều kiện công nợ của web: khoản CHỜ kế toán vẫn tính, khoản bị TỪ CHỐI thì không; hoàn tiền là dòng ÂM).
 *     Không đòi kế toán duyệt, không đòi hoá đơn — đúng yêu cầu V8 mục 8.
 *   · «THẤT BẠI»: KHÔNG có bản ghi nào của một lần thanh toán bị ngân hàng huỷ/từ chối (BankTransaction chỉ lưu tiền ĐÃ về; QrSession chỉ có ACTIVE/EXPIRED/CONSUMED).
 *     ⇒ trạng thái `THAT_BAI` KHÔNG BAO GIỜ được suy ra ở đây; đáp trả nói thẳng `gioiHan: ["THAT_BAI_CHUA_CO_BAN_GHI"]` thay vì giả vờ. Cần bảng ghi lần thanh toán + webhook huỷ (xem BACKEND-BLOCKERS B-PAY-FAIL).
 *   · CẤP QUYỀN: do CỔNG `CongCapQuyen` trả lời. Hôm nay KHÔNG có đơn Online nào (chưa có loại dòng đơn Online, chưa có engine entitlement của Agent E-learning) ⇒ mọi đơn là `KHONG_AP_DUNG`.
 *     Khi đơn có dòng Online mà cổng chưa nối ⇒ `CHUA_NOI_ENGINE` (FAIL-CLOSED, không bao giờ "đã cấp" giả).
 */

export const TRANG_THAI_THANH_TOAN = [
  "DA_HUY",
  "DA_HOAN_TIEN",
  "CHO_THANH_TOAN",
  "DA_NHAN_MOT_PHAN",
  "DA_NHAN_TIEN",
  "DA_NHAN_TIEN_CHO_CAP_QUYEN",
  "DA_CAP_QUYEN",
  "CAP_QUYEN_LOI",
] as const;
export type TrangThaiThanhToan = (typeof TRANG_THAI_THANH_TOAN)[number];

export const TRANG_THAI_CAP_QUYEN = ["KHONG_AP_DUNG", "CHO_CAP", "DA_CAP", "LOI_CAN_THU_LAI", "CHUA_NOI_ENGINE"] as const;
export type TrangThaiCapQuyen = (typeof TRANG_THAI_CAP_QUYEN)[number];

/** CỔNG sang engine entitlement Online (Agent E-learning sở hữu). Workstream A KHÔNG viết engine thay thế — chỉ HỎI. */
export type CongCapQuyen = {
  trangThaiCapQuyen(orderId: string, dongDon: ReadonlyArray<{ id: string; loai: string; studentId: string | null }>): Promise<TrangThaiCapQuyen>;
};

/** Loại dòng đơn thuộc miền Online. Rỗng cho tới khi Agent E-learning + Workstream A chốt giá trị enum `OrderItemType` mới (xem ONLINE-ENTITLEMENT-CONTRACT.md). */
export const LOAI_DONG_ONLINE: ReadonlySet<string> = new Set<string>();

/** Cổng mặc định: không có dòng Online ⇒ KHÔNG_ÁP_DỤNG; có dòng Online mà chưa nối engine ⇒ CHUA_NOI_ENGINE (fail-closed). */
export const congCapQuyenMacDinh: CongCapQuyen = {
  async trangThaiCapQuyen(_orderId, dongDon) {
    return dongDon.some((d) => LOAI_DONG_ONLINE.has(d.loai)) ? "CHUA_NOI_ENGINE" : "KHONG_AP_DUNG";
  },
};
let cong: CongCapQuyen = congCapQuyenMacDinh;
export function datCongCapQuyen(c: CongCapQuyen | null): void {
  cong = c ?? congCapQuyenMacDinh;
}

export type BangChungThanhToan = {
  trangThaiDon: "DRAFT" | "PENDING_PAYMENT" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "REFUNDED";
  tongTien: number;
  /** Σ khoản đã ghi nhận (đã loại khoản bị từ chối; hoàn tiền là số âm). */
  daNhan: number;
  coKhoanChoKeToan: boolean;
  capQuyen: TrangThaiCapQuyen;
};

/**
 * THUẦN — một chỗ duy nhất quyết định trạng thái. Thứ tự ưu tiên:
 *   huỷ/hoàn > chưa có tiền > có một phần > đủ tiền (rồi rẽ theo cấp quyền).
 * Đơn 0đ (tổng = 0) mà đã CONFIRMED/COMPLETED được coi là đủ; đơn 0đ còn PENDING_PAYMENT vẫn CHO_THANH_TOAN (không tự suy "đã trả").
 */
export function suyTrangThaiThanhToan(b: BangChungThanhToan): TrangThaiThanhToan {
  if (b.trangThaiDon === "CANCELLED") return "DA_HUY";
  if (b.trangThaiDon === "REFUNDED") return "DA_HOAN_TIEN";
  const duTien = b.tongTien > 0 ? b.daNhan >= b.tongTien : b.trangThaiDon === "CONFIRMED" || b.trangThaiDon === "COMPLETED";
  if (b.daNhan <= 0 && !duTien) return "CHO_THANH_TOAN";
  if (!duTien) return "DA_NHAN_MOT_PHAN";
  switch (b.capQuyen) {
    case "KHONG_AP_DUNG":
      return "DA_NHAN_TIEN";
    case "DA_CAP":
      return "DA_CAP_QUYEN";
    case "LOI_CAN_THU_LAI":
      return "CAP_QUYEN_LOI";
    case "CHO_CAP":
    case "CHUA_NOI_ENGINE":
      return "DA_NHAN_TIEN_CHO_CAP_QUYEN";
  }
}

/** Gợi ý nhịp hỏi lại (giây) cho app; `null` = trạng thái cuối, không cần hỏi nữa. Chỉ là GỢI Ý — máy chủ không hứa thời điểm đổi trạng thái. */
export function goiYHoiLai(t: TrangThaiThanhToan): number | null {
  switch (t) {
    case "CHO_THANH_TOAN":
    case "DA_NHAN_MOT_PHAN":
    case "DA_NHAN_TIEN_CHO_CAP_QUYEN":
      return 10;
    case "CAP_QUYEN_LOI":
      return 60;
    default:
      return null;
  }
}

export type TrangThaiThanhToanDto = {
  maDon: string;
  trangThai: TrangThaiThanhToan;
  tongTien: number;
  nhanTongTien: string;
  daNhan: number;
  nhanDaNhan: string;
  /** Còn thiếu để đủ tổng đơn (≥ 0). */
  conThieu: number;
  nhanConThieu: string;
  coKhoanChoKeToan: boolean;
  capQuyen: { trangThai: TrangThaiCapQuyen };
  qrConHieuLuc: boolean;
  hoiLaiSauGiay: number | null;
  /** Những điều dữ liệu CHƯA cho phép nói thật — app không được tự bù bằng giao diện. */
  gioiHan: string[];
  dong: { studentId: string; loai: string; trangThai: string }[];
};

function khongThay(): LoiApiMobile {
  return new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
}

/**
 * ĐƠN CỦA PHỤ HUYNH = đơn có ÍT NHẤT MỘT học viên (ở dòng đơn hoặc ở đơn) thuộc `parentUserId` của PHIÊN.
 * Đơn không nối học viên nào (lead chưa chuyển đổi) ⇒ KHÔNG thuộc ai ⇒ 404. Không phân biệt "của người khác" với "không có".
 * Đơn có học viên của NHIỀU gia đình: chỉ thấy các dòng của con mình (xem `dong`), tổng tiền/trạng thái là của cả đơn (một khoản thanh toán chung).
 */
export async function layTrangThaiThanhToan(parentUserId: string, orderId: unknown, now: Date = new Date()): Promise<TrangThaiThanhToanDto> {
  if (typeof orderId !== "string" || orderId.length === 0 || orderId.length > 64) throw khongThay();
  const con = await db.student.findMany({ where: { parentUserId, deletedAt: null }, select: { id: true } });
  const conIds = con.map((c) => c.id);
  if (conIds.length === 0) throw khongThay();
  const don = await db.order.findFirst({
    where: { id: orderId, deletedAt: null, OR: [{ studentId: { in: conIds } }, { items: { some: { studentId: { in: conIds } } } }] },
    select: {
      id: true,
      code: true,
      status: true,
      totalAmount: true,
      items: { select: { id: true, type: true, studentId: true, status: true } },
    },
  });
  if (!don) throw khongThay();

  const [tong, choKeToan, qr] = await Promise.all([
    db.payment.aggregate({ where: { orderId: don.id, ...KHOAN_DA_GHI_NHAN }, _sum: { amount: true } }),
    db.payment.count({ where: { orderId: don.id, ...KHOAN_DA_GHI_NHAN, accountantStatus: "PENDING" } }),
    db.qrSession.count({ where: { status: "ACTIVE", expiresAt: { gt: now }, paymentRequest: { orderId: don.id } } }),
  ]);
  const daNhan = tong._sum.amount ?? 0;
  const capQuyen = await cong.trangThaiCapQuyen(
    don.id,
    don.items.map((i) => ({ id: i.id, loai: i.type, studentId: i.studentId })),
  );
  const trangThai = suyTrangThaiThanhToan({ trangThaiDon: don.status, tongTien: don.totalAmount, daNhan, coKhoanChoKeToan: choKeToan > 0, capQuyen });
  const conThieu = Math.max(0, don.totalAmount - daNhan);
  const gioiHan = ["THAT_BAI_CHUA_CO_BAN_GHI"];
  if (capQuyen === "CHUA_NOI_ENGINE") gioiHan.push("ENGINE_CAP_QUYEN_ONLINE_CHUA_NOI");
  const conIdsSet = new Set(conIds);
  return {
    maDon: don.code,
    trangThai,
    tongTien: don.totalAmount,
    nhanTongTien: nhanTien(don.totalAmount),
    daNhan,
    nhanDaNhan: nhanTien(daNhan),
    conThieu,
    nhanConThieu: nhanTien(conThieu),
    coKhoanChoKeToan: choKeToan > 0,
    capQuyen: { trangThai: capQuyen },
    qrConHieuLuc: qr > 0,
    hoiLaiSauGiay: goiYHoiLai(trangThai),
    gioiHan,
    dong: don.items.filter((i) => i.studentId !== null && conIdsSet.has(i.studentId)).map((i) => ({ studentId: i.studentId as string, loai: i.type, trangThai: i.status })),
  };
}
