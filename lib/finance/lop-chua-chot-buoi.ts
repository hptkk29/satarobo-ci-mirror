// lib/finance/lop-chua-chot-buoi.ts — sổ buổi của lớp có TIN ĐƯỢC để tính hoàn tiền không.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỒN TẠI
//
// Chủ dự án 14/09/2026: "chức năng hoàn tiền: Σ đã thu − số buổi đã học × đơn giá từng buổi".
// Công thức đó ĐÃ ĐÚNG SẴN trong `computeRefund`. Thứ đang chặn tính năng là cầu dao
// `REFUND_REQUEST_DISABLED`, và file này là **ĐIỀU KIỆN GỠ SỐ 2** viết nguyên văn trong
// `cau-dao-hoan-tien.ts`:
//
//   "`createRefundRequest` TỪ CHỐI đề xuất khi lớp có buổi đã qua ngày mà
//    `sessionsLearned = 0` — ném lỗi rõ ràng, KHÔNG lặng lẽ đề xuất 100%."
//
// Lý do: `sessionsLearned` đếm `ClassSession.status = COMPLETED`, mà `status` không phản
// ánh thực tế đã dạy. Đo 07/09/2026 trên prod: 2 buổi COMPLETED / 287 SCHEDULED, trong đó
// 209 buổi ĐÃ QUA NGÀY chưa ai chốt. Với một lớp đã dạy gần hết khoá, `sessionsLearned`
// vẫn đọc ra 0 ⇒ đề xuất hoàn **100% học phí**. Đo lại 14/09 trên `satarobo_local`: 461
// COMPLETED / 148 SCHEDULED, **82 buổi đã qua ngày chưa chốt** — hình dạng vẫn còn nguyên.
//
// ─────────────────────────────────────────────────────────────────────────────
// TỪ CHỐI, KHÔNG TỰ ĐOÁN
//
// Cám dỗ lớn nhất là "đếm buổi đã qua ngày thay cho COMPLETED". Nhưng buổi qua ngày CHƯA
// CHẮC đã dạy — giáo viên nghỉ, lớp hoãn, phòng hỏng — và đoán hộ ở đây là chi tiền hoàn
// theo một con số không ai xác nhận. Việc đúng là dừng lại và bắt người chốt sổ buổi.
//
// ⚠️ Và chỉ chặn ĐÚNG ca nguy hiểm: sổ thiếu vài buổi nhưng `sessionsLearned > 0` thì vẫn
// cho đề xuất (kèm cảnh báo). Chặn cả ca đó là chặn mọi lớp đang chạy, và tính năng thành
// vô dụng theo một kiểu khác.
//
// THUẦN — không Prisma, không DB, không đọc đồng hồ (mốc thời gian là THAM SỐ).
// ─────────────────────────────────────────────────────────────────────────────

export type BuoiToiThieu = {
  date: Date;
  /** `ClassSession.status` — chuỗi, không ràng enum để test không cần Prisma. */
  status: string;
};

/**
 * Số buổi ĐÃ QUA NGÀY mà vẫn chưa chốt.
 *
 * Buổi HUỶ không tính (nó cố ý không bao giờ `COMPLETED`), buổi tương lai không tính, và
 * buổi ĐÚNG hôm nay cũng chưa tính — lớp có thể đang học dở.
 */
export function soBuoiChuaChot(buoi: BuoiToiThieu[], moc: Date): number {
  const m = moc.getTime();
  return buoi.filter(
    (b) =>
      b.date instanceof Date &&
      b.date.getTime() < m &&
      b.status !== "COMPLETED" &&
      b.status !== "CANCELLED",
  ).length;
}

export const MUC_TIN_SO_BUOI = {
  /** Sổ buổi khớp thực tế — con số hoàn tiền tin được. */
  TIN_DUOC: "TIN_DUOC",
  /** Sổ thiếu vài buổi nhưng vẫn có buổi đã chốt ⇒ cho đề xuất, kèm cảnh báo. */
  THIEU_MOT_SO_BUOI: "THIEU_MOT_SO_BUOI",
  /** Lớp có buổi quá hạn mà sổ đọc ra 0 buổi đã học ⇒ CẤM đề xuất. */
  KHONG_TIN_DUOC: "KHONG_TIN_DUOC",
} as const;
export type MucTinSoBuoi = (typeof MUC_TIN_SO_BUOI)[keyof typeof MUC_TIN_SO_BUOI];

export type CanhBaoSoBuoi = {
  muc: MucTinSoBuoi;
  /** Có cho `createRefundRequest` sinh đề xuất không. */
  choDeXuat: boolean;
  /** Câu người thường đọc được — hiện thẳng lên màn, không phải mã lỗi. */
  lyDo: string;
};

export function canhBaoSoBuoi(input: {
  soBuoiChuaChot: number;
  sessionsLearned: number;
  sessionsTotal: number;
}): CanhBaoSoBuoi {
  const chuaChot = Math.max(0, Math.trunc(input.soBuoiChuaChot) || 0);
  const daHoc = Math.max(0, Math.trunc(input.sessionsLearned) || 0);

  if (chuaChot === 0) {
    return {
      muc: MUC_TIN_SO_BUOI.TIN_DUOC,
      choDeXuat: true,
      lyDo: "Sổ buổi của lớp đã chốt đầy đủ tới hôm nay.",
    };
  }

  if (daHoc === 0) {
    return {
      muc: MUC_TIN_SO_BUOI.KHONG_TIN_DUOC,
      choDeXuat: false,
      lyDo:
        `Lớp có ${chuaChot} buổi đã qua ngày mà chưa chốt, và sổ đang đọc ra 0 buổi đã ` +
        "học. Tính theo con số đó sẽ đề xuất hoàn TOÀN BỘ học phí cho một lớp có thể đã " +
        "dạy gần hết. Chốt sổ buổi cho lớp rồi quay lại.",
    };
  }

  return {
    muc: MUC_TIN_SO_BUOI.THIEU_MOT_SO_BUOI,
    choDeXuat: true,
    lyDo:
      `Lớp còn ${chuaChot} buổi đã qua ngày mà chưa chốt — số tiền hoàn tính theo ` +
      `${daHoc} buổi đã chốt, nên có thể CAO HƠN thực tế. Chốt nốt sổ buổi trước khi duyệt.`,
  };
}
