/**
 * EL-06 — CHỐT HOÀN THÀNH Ở CẤP KHOÁ.
 *
 * EL-04 đo tới cấp BÀI (`TrnLessonProgress`), nhưng không có gì cuộn kết quả đó
 * lên cấp KHOÁ. Hệ quả: `TrnEnrollment.status` không bao giờ rời `IN_PROGRESS`,
 * nên mọi thứ đứng trên nó đều rỗng — thông báo hoàn thành không bao giờ gửi,
 * báo cáo tuân thủ luôn 0%, và lịch nhắc không bao giờ được huỷ.
 *
 * ⚠️ `COMPLETED` vs `COMPLETED_LATE` xét theo `dueAtOriginal`, KHÔNG theo `dueAt`.
 * `dueAt` gia hạn được; đo đúng-hạn trên nó thì ai được gia hạn cũng thành đúng
 * hạn, và tỉ lệ đúng hạn thành thứ đo được 100% mãi mãi.
 *
 * ⚠️ NGOẠI LỆ DUY NHẤT: `slaGraceDays` — số ngày làm việc được MIỄN TRỪ vì NGƯỜI
 * CHẤM trễ hạn SLA. Nó KHÔNG phải gia hạn: gia hạn là người xử chủ động cho thêm
 * thời gian, còn đây là trả lại đúng phần người học đã mất vì lỗi của người khác.
 *
 * Vì sao phải nới ở ĐÂY chứ không chỉ nới `dueAt`: nới `dueAt` mở lại đường nộp và
 * chặn `OVERDUE`, nhưng phép so trễ-hay-không ở dưới vẫn đọc `dueAtOriginal` bất
 * biến. Người bị bỏ quên năm ngày, được nới hạn, học xong đúng hạn mới — VẪN bị
 * đếm là TRỄ trên báo cáo tuân thủ gửi thẳng quản lý trực tiếp, CÓ GHI TÊN. Kế
 * hoạch §9.3 luật 2 nói đúng câu đó: "thiếu (b) thì (a) vô nghĩa".
 *
 * `dueAtOriginal` vẫn KHÔNG BAO GIỜ bị ghi lại. Miễn trừ là một khoản cộng bên
 * cạnh, không phải một lần sửa mốc.
 */
import { congNgayLamViec } from "@/lib/elearning/ngay-lam-viec";

/**
 * Hạn gốc CỘNG phần miễn trừ, tính bằng NGÀY LÀM VIỆC.
 *
 * ⚠️ Ngày làm việc, không phải ngày lịch: người chấm chờ 5 ngày làm việc thì phần
 * miễn trừ cũng phải là 5 ngày làm việc. Cộng ngày lịch là trả lại THIẾU 2 ngày, và
 * người học vẫn chịu một phần hậu quả của việc người khác chậm.
 */
export function hanCoMienTru(
  dueAtOriginal: Date | null,
  slaGraceDays: number,
): Date | null {
  if (!dueAtOriginal || slaGraceDays <= 0) return dueAtOriginal;
  return congNgayLamViec(dueAtOriginal, slaGraceDays);
}

export type KetQuaCuon = {
  status: "IN_PROGRESS" | "COMPLETED" | "COMPLETED_LATE";
  progressPercent: number;
  isLate: boolean;
  /** `true` = lần này mới hoàn thành ⇒ người gọi phát sự kiện. */
  vuaHoanThanh: boolean;
};

export function cuonTienDoKhoa(input: {
  /** Số bài BẮT BUỘC của khoá. 0 = khoá chưa có bài nào. */
  soBaiBatBuoc: number;
  /** Số bài bắt buộc người này đã xong. */
  soBaiDaXong: number;
  statusHienTai: string;
  /** Hạn GỐC, bất biến — mốc đo đúng hạn. */
  dueAtOriginal: Date | null;
  now: Date;
  /**
   * Ngày làm việc được MIỄN TRỪ vì người chấm trễ SLA. Mặc định 0.
   *
   * Mặc định 0 để mọi đường gọi cũ giữ NGUYÊN hành vi — thêm tham số này không
   * được phép đổi một con số nào của những khoá không có bài chấm tay.
   */
  slaGraceDays?: number;
}): KetQuaCuon {
  // Khoá chưa có bài bắt buộc nào thì KHÔNG tự động hoàn thành. Chia cho 0 ra
  // NaN, còn coi là 100% thì mọi người "hoàn thành" một khoá rỗng — và bảng
  // tuân thủ báo 100% cho một khoá chưa ai soạn xong.
  if (input.soBaiBatBuoc <= 0) {
    return {
      status: "IN_PROGRESS",
      progressPercent: 0,
      isLate: false,
      vuaHoanThanh: false,
    };
  }

  const pct = Math.min(
    100,
    Math.round((input.soBaiDaXong / input.soBaiBatBuoc) * 100),
  );

  const daXongHet = input.soBaiDaXong >= input.soBaiBatBuoc;
  const daLaXong =
    input.statusHienTai === "COMPLETED" || input.statusHienTai === "COMPLETED_LATE";

  if (!daXongHet) {
    return {
      status: daLaXong
        ? (input.statusHienTai as "COMPLETED" | "COMPLETED_LATE")
        : "IN_PROGRESS",
      progressPercent: pct,
      isLate: false,
      vuaHoanThanh: false,
    };
  }

  // ⚠️ Đã ghi `COMPLETED_LATE` thì GIỮ NGUYÊN, không bao giờ nâng lên
  // `COMPLETED`. Trên lý thuyết không xảy ra được — `dueAtOriginal` bất biến nên
  // "đã trễ" là một sự thật chỉ đúng thêm theo thời gian. Nhưng nếu cột đó có
  // ngày bị sửa (lỗi, hay ai đó sửa tay trong DB) thì nâng cấp âm thầm là XOÁ
  // một lần nộp trễ đã ghi nhận, và không có gì báo.
  const daTungTre = input.statusHienTai === "COMPLETED_LATE";
  // Mốc đo = hạn gốc + phần miễn trừ vì người chấm trễ. Không có miễn trừ thì đây
  // đúng bằng `dueAtOriginal`, y như trước.
  const mocDo = hanCoMienTru(input.dueAtOriginal, input.slaGraceDays ?? 0);
  const tre =
    daTungTre || Boolean(mocDo && input.now.getTime() > mocDo.getTime());

  return {
    status: tre ? "COMPLETED_LATE" : "COMPLETED",
    progressPercent: 100,
    isLate: tre,
    // Đã xong từ trước thì KHÔNG phát sự kiện lần nữa: mỗi lần mở lại bài cuối
    // sẽ là một lời chúc mừng mới trong hộp thư người học.
    vuaHoanThanh: !daLaXong,
  };
}
