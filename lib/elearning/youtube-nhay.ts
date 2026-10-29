/**
 * Bài VIDEO phát bằng YouTube — phát hiện NGƯỜI HỌC TUA.
 *
 * Thẻ `<video>` có sự kiện `seeking`; trình phát nhúng của YouTube thì KHÔNG. Cách
 * duy nhất là hỏi vị trí đều đặn rồi so với vị trí LẼ RA phải có nếu cứ phát liền:
 *
 *   lẽ ra = vị trí lần trước + thời gian trôi × tốc độ   (chỉ khi đang phát)
 *
 * Thuần để test được; vòng hỏi nằm ở `video-player.tsx`.
 *
 * ⚠️ Đây là rào MỀM, như bốn rào còn lại của trình phát: người học vẫn gõ được vào
 * bảng điều khiển. Cổng thật (chặn tua, trần delta, bitmap) nằm ở server
 * (`video-heartbeat.ts`), và nó không biết nguồn là tệp hay YouTube.
 */

/** Sai lệch cho phép khi vị trí NHẢY TỚI — timer bị trình duyệt trì hoãn là chuyện thường. */
export const DUNG_SAI_TIEN_GIAY = 1.5;
/** Lùi quá ngần này mới tính là tua lùi (đứng hình do tải đệm không làm vị trí lùi). */
export const DUNG_SAI_LUI_GIAY = 1;

export type KieuNhay = "TIEN" | "LUI" | null;

export function phatHienNhay(i: {
  /** Vị trí lần hỏi trước (giây) và mốc thời gian lúc đó (ms). */
  truoc: number;
  truocMs: number;
  /** Vị trí lần hỏi này (giây) và mốc thời gian (ms). */
  nay: number;
  nayMs: number;
  tocDo: number;
  /** Đang phát (kể cả đang tải đệm) — dừng thì vị trí không được tự chạy. */
  dangPhat: boolean;
}): KieuNhay {
  const troi = Math.max(0, (i.nayMs - i.truocMs) / 1000);
  const leRa = i.truoc + (i.dangPhat ? troi * i.tocDo : 0);
  if (i.nay - leRa > DUNG_SAI_TIEN_GIAY) return "TIEN";
  if (i.nay < i.truoc - DUNG_SAI_LUI_GIAY) return "LUI";
  return null;
}
