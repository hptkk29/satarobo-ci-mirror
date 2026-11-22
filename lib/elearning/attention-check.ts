/**
 * EL-12b — ĐIỂM KIỂM TRA TẬP TRUNG (một trong tám cơ chế chống học đối phó).
 *
 * Cơ chế đơn giản nhất trong tám cái, và cũng là cái dễ làm sai theo hướng phiền
 * người học nhất. Nó KHÔNG kiểm tra kiến thức — chỉ hỏi "bạn còn ở đây không".
 *
 * ⚠️ Vì sao hỏi theo GIÂY ĐÃ PHỦ chứ không theo giờ đồng hồ: đếm theo giờ thì mở
 * video rồi bỏ đó vẫn ăn đủ câu hỏi, và trả lời hết là "đã học" — đúng cái hành vi
 * cơ chế này sinh ra để chặn. Đếm theo giây đã phủ nghĩa là chỉ ai thật sự xem mới
 * bị hỏi, và số câu hỏi tỉ lệ với lượng nội dung đã đi qua.
 *
 * ⚠️ Trả lời là XÁC NHẬN CÓ MẶT, không phải câu trả lời đúng/sai. Bịa ra một câu
 * đố nội dung ở đây là dựng một hệ chấm điểm thứ hai bên cạnh bài kiểm tra thật,
 * với ngân hàng câu hỏi không ai soạn và không ai duyệt.
 */

/** Cứ ngần này giây nội dung ĐÃ PHỦ thì hỏi một lần. */
export const CHU_KY_HOI_GIAY = 240;
/** Hỏi rồi mà quá ngần này giây không trả lời thì ngưng ghi nhận. */
export const HAN_TRA_LOI_GIAY = 45;

/**
 * Đã tới lúc hỏi chưa.
 *
 * `daHoi` là số câu đã hỏi trong bài này. Điều kiện là "số chu kỳ đã đi qua NHIỀU
 * HƠN số câu đã hỏi" — viết theo kiểu `coveredSec % chuKy === 0` thì gần như không
 * bao giờ đúng, vì mỗi nhịp nhảy vài giây một và hiếm khi rơi trúng bội số.
 */
export function nenHoiTapTrung(input: {
  coveredSec: number;
  daHoi: number;
  chuKyGiay?: number;
}): boolean {
  const chuKy = input.chuKyGiay ?? CHU_KY_HOI_GIAY;
  if (chuKy <= 0) return false;
  return Math.floor(input.coveredSec / chuKy) > input.daHoi;
}

export type TinhTrangThachThuc = "KHONG_CO" | "DANG_CHO" | "QUA_HAN";

/**
 * Câu hỏi đang treo ở tình trạng nào.
 *
 * Ba tình trạng chứ không hai: "đang chờ" và "quá hạn" phải tách nhau. Gộp lại thì
 * người vừa được hỏi nửa giây trước đã bị ngưng ghi nhận, trong khi họ chưa kịp
 * đọc xong câu hỏi.
 */
export function tinhTrangThachThuc(input: {
  attnPendingAt: Date | null;
  now: Date;
  hanGiay?: number;
}): TinhTrangThachThuc {
  if (!input.attnPendingAt) return "KHONG_CO";
  const han = (input.hanGiay ?? HAN_TRA_LOI_GIAY) * 1000;
  const troi = input.now.getTime() - input.attnPendingAt.getTime();
  return troi > han ? "QUA_HAN" : "DANG_CHO";
}

/**
 * Câu trả lời có hợp lệ không.
 *
 * `id` của câu hỏi CHÍNH LÀ mốc thời gian lúc hỏi, đọc từ `attnPendingAt`. Dùng
 * lại cột đã có thay vì thêm cột `attnPendingId`: mốc đó vốn duy nhất trong một
 * bài, và một cột mới trên bảng nóng nhất module là đúng thứ luật cứng #4 bắt
 * tránh khi bảng đã có dữ liệu.
 *
 * Chỉ kiểm CÓ MẶT: đáp án phải khớp id câu đang treo. Không khớp id nghĩa là
 * client trả lời một câu hỏi cũ — thường là nhịp cũ tới trễ, không phải gian lận.
 */
export function traLoiHopLe(input: {
  traLoi: string | null | undefined;
  attnPendingAt: Date | null;
}): boolean {
  if (!input.attnPendingAt || !input.traLoi) return false;
  return input.traLoi.trim() === idThachThuc(input.attnPendingAt);
}

export function idThachThuc(attnPendingAt: Date): string {
  return `attn-${attnPendingAt.getTime()}`;
}

export const CAU_HOI_TAP_TRUNG = "Bạn còn đang xem chứ? Bấm để tiếp tục.";
