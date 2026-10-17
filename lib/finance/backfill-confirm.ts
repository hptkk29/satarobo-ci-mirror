// lib/finance/backfill-confirm.ts — chọn khoản NHẬP LIỆU BAN ĐẦU đủ điều kiện xác nhận
// hàng loạt (phương án B, chốt 13/09/2026).
//
// BỐI CẢNH: học phí của khách chốt TRƯỚC 06/08 nằm ở sheet, nhập vào qua
// `/leads/import/registered` → `createBackfillOrderPaymentInTx` tạo Order `CONFIRMED` +
// một `Payment` mang dấu `[backfill-import]`, nhưng để `accountantStatus: PENDING`.
// Doanh thu chỉ đếm `CONFIRMED` (`lib/finance/thuc-thu.ts`) ⇒ tiền cũ KHÔNG vào doanh thu
// cho tới khi kế toán xác nhận, mà `confirmPaymentAction` là từng khoản một.
//
// ⚠️ VÌ SAO KHÔNG CHO IMPORT GHI THẲNG `CONFIRMED` (phương án A đã bị loại):
// đó là đường ghi `CONFIRMED` THỨ HAI. Hệ này đã có ≥7 định nghĩa "đã thu" và cả tuần
// nay đang gỡ bớt; thêm một cửa nữa là đi ngược. Đường B đi qua đúng `confirmPayment`
// đang chạy ⇒ vẫn sinh `Receipt`, vẫn ghi nhật ký, và chạy được cho cả dữ liệu ĐÃ nhập.
//
// ⚠️ HÀM NÀY KHÔNG LÁCH CỔNG NÀO. Nó chỉ TRẢ LỜI "khoản này có nên đưa vào lượt xác
// nhận hàng loạt không", và với khoản không đủ điều kiện thì nói RÕ LÝ DO để màn hình
// hiện ra. Mọi ràng buộc thật vẫn do `confirmPayment` cưỡng chế lần nữa ở tầng dưới.
//
// THUẦN — không Prisma, không DB.

import { BACKFILL_PAYMENT_MARKER } from "@/lib/finance/payment-markers";
import { thieuGhiDanh } from "@/lib/finance/can-ghi-danh";

/** Phần dữ liệu một khoản mà luật này cần — cố ý hẹp để test khỏi dựng cả Payment. */
export type BackfillCandidate = {
  id: string;
  note: string | null;
  accountantStatus: string;
  /** `confirmPayment` TỪ CHỐI khoản chưa gắn ghi danh — trừ đơn KIT/THI (`can-ghi-danh.ts`). */
  enrollmentId: string | null;
  /**
   * `Order.type` của đơn chứa khoản (`null` = không có đơn). BẮT BUỘC (luật 7 — `tsc` liệt kê chỗ
   * gọi): đơn KIT/THI không có ghi danh nào, nên "thiếu ghi danh" hỏi CÙNG hàm `thieuGhiDanh` với
   * lõi xác nhận. Trước 29/09 hàm này bỏ khoản kit/thi dù `confirmPayment` đã nhận nó.
   */
  loaiDon: string | null;
  /** Người đã ghi nhận khoản — dùng cho cổng TÁCH NHIỆM VỤ. */
  recordedById: string | null;
  amount: number;
};

export type BackfillVerdict =
  | { nhan: true }
  | { nhan: false; lyDo: string };

/** Lý do bỏ — gom cố định để đếm được, đừng nội suy chuỗi tự do trên màn. */
export const LY_DO_BO = {
  KHONG_PHAI_BACKFILL: "Không phải khoản nhập liệu ban đầu",
  DA_XU_LY: "Đã được kế toán xử lý (không còn chờ)",
  CHUA_GAN_GHI_DANH: "Chưa gắn ghi danh — không sinh được phiếu thu",
  TU_XAC_NHAN: "Bạn là người ghi nhận khoản này — cần người khác xác nhận",
  SO_TIEN_KHONG_HOP_LE: "Số tiền không hợp lệ",
} as const;

/**
 * Khoản này có được đưa vào lượt xác nhận hàng loạt không.
 *
 * `actorId` = người đang bấm nút. Cổng TÁCH NHIỆM VỤ (`payments/_actions.ts:437-440`)
 * cấm người ghi nhận tự xác nhận khoản của mình, và lượt hàng loạt **giữ nguyên** cổng
 * đó — đây là chỗ dễ bị "tối ưu" cho tiện, nhưng bỏ nó là bỏ luôn lớp kiểm soát duy
 * nhất giữa người nhập tiền và người xác nhận tiền.
 *
 * Với đội nhỏ, khả năng cao NGƯỜI NHẬP CHÍNH LÀ NGƯỜI XÁC NHẬN ⇒ mọi dòng rơi vào
 * `TU_XAC_NHAN`. Đó KHÔNG phải lỗi của hàm này; màn hình phải hiện con số đó ra để
 * người vận hành thấy và quyết (đổi người xác nhận, hay xin đổi luật).
 */
export function nenXacNhanHangLoat(
  p: BackfillCandidate,
  actorId: string,
): BackfillVerdict {
  if (!p.note || !p.note.includes(BACKFILL_PAYMENT_MARKER)) {
    return { nhan: false, lyDo: LY_DO_BO.KHONG_PHAI_BACKFILL };
  }
  if (p.accountantStatus !== "PENDING") {
    return { nhan: false, lyDo: LY_DO_BO.DA_XU_LY };
  }
  if (!Number.isFinite(p.amount) || p.amount <= 0) {
    return { nhan: false, lyDo: LY_DO_BO.SO_TIEN_KHONG_HOP_LE };
  }
  if (thieuGhiDanh(p, p.loaiDon)) {
    return { nhan: false, lyDo: LY_DO_BO.CHUA_GAN_GHI_DANH };
  }
  if (p.recordedById && p.recordedById === actorId) {
    return { nhan: false, lyDo: LY_DO_BO.TU_XAC_NHAN };
  }
  return { nhan: true };
}

export type BackfillPlan = {
  nhan: BackfillCandidate[];
  bo: { id: string; lyDo: string; amount: number }[];
  /** Tổng tiền sẽ vào doanh thu nếu chạy lượt này. */
  tongNhan: number;
  /** Đếm theo lý do bỏ — để màn hiện "40 khoản bị bỏ vì …". */
  demTheoLyDo: Record<string, number>;
};

/** Chia danh sách thành nhận/bỏ + tổng kết, để màn xem thử trước khi bấm thật. */
export function lapKeHoachXacNhan(
  ds: BackfillCandidate[],
  actorId: string,
): BackfillPlan {
  const nhan: BackfillCandidate[] = [];
  const bo: { id: string; lyDo: string; amount: number }[] = [];
  const demTheoLyDo: Record<string, number> = {};
  for (const p of ds) {
    const v = nenXacNhanHangLoat(p, actorId);
    if (v.nhan) {
      nhan.push(p);
      continue;
    }
    bo.push({ id: p.id, lyDo: v.lyDo, amount: p.amount });
    demTheoLyDo[v.lyDo] = (demTheoLyDo[v.lyDo] ?? 0) + 1;
  }
  return {
    nhan,
    bo,
    tongNhan: nhan.reduce((s, p) => s + p.amount, 0),
    demTheoLyDo,
  };
}
