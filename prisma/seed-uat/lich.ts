// prisma/seed-uat/lich.ts — rải buổi học ĐÚNG THỨ trong tuần của lớp.
//
// Vì sao (QA site GV vòng 1, BUG-033): seed cũ rải buổi cứng 7 ngày một kể từ ngày khai
// giảng và KHÔNG hề đọc `slot.days`, trong khi tên lớp lại ghép từ `slot.label`. Kết
// quả trên UAT: lớp tên "T7 sáng" có 14 buổi rơi vào thứ Tư và 0 buổi vào thứ Bảy; lớp
// "CN sáng" không buổi nào rơi vào Chủ nhật; cột T7 và T3 của lịch tháng trống trơn cả
// tháng. QA đọc ra thành nghi vấn "bộ sinh lịch hỏng, có thể chặn release" — thực ra
// thuật toán của ỨNG DỤNG không sai, chỉ có dữ liệu seed nói dối.
//
// Lớp cũng chưa từng được set `scheduleDays`, nên không màn nào đối chiếu lại được.
//
// PURE — không DB. Quy ước thứ theo `Date.getDay()`: 0 = Chủ nhật … 6 = Thứ Bảy, khớp
// `THU_HOC.days` trong 03-hoc-vu.ts.
import { MOC } from "./_common";

/**
 * Thứ trong tuần (giờ VN) của ngày lệch `days` so với mốc seed.
 *
 * Tính trên mốc UTC rồi bù +7 giờ — KHÔNG dùng `new Date().getDay()` của máy đang chạy:
 * seed có thể chạy trên CI ở UTC, và lệch múi giờ ở đây làm mọi buổi trượt một ngày.
 */
export function thuVN(days: number): number {
  const d = new Date(MOC);
  d.setUTCDate(d.getUTCDate() + days);
  // MOC là 00:00 UTC; 00:00 UTC = 07:00 VN cùng ngày, nên thứ UTC cũng là thứ VN.
  return d.getUTCDay();
}

/**
 * Dãy `soBuoi` ngày (dạng lệch so với mốc) rơi ĐÚNG vào các thứ `days`, bắt đầu từ
 * ngày `batDau` trở đi.
 *
 * `batDau` không rơi đúng thứ học thì buổi đầu dời tới thứ học gần nhất SAU nó — đúng
 * như lớp thật: khai giảng công bố một ngày, buổi đầu rơi vào buổi học kế tiếp.
 */
export function raiTheoThu(
  batDau: number,
  days: number[],
  soBuoi: number,
): number[] {
  if (soBuoi <= 0) return [];
  const hopLe = [...new Set(days)].filter((d) => d >= 0 && d <= 6);
  // Không khai thứ nào (dữ liệu hỏng) → giữ hành vi cũ, mỗi tuần một buổi, còn hơn
  // ném lỗi giữa lượt seed.
  if (hopLe.length === 0) {
    return Array.from({ length: soBuoi }, (_, i) => batDau + i * 7);
  }
  const ra: number[] = [];
  let d = batDau;
  // Trần lặp: 7 ngày cho mỗi buổi là thừa sức, và chặn vòng vô hạn nếu dữ liệu lạ.
  const tran = batDau + soBuoi * 7 + 14;
  while (ra.length < soBuoi && d <= tran) {
    if (hopLe.includes(thuVN(d))) ra.push(d);
    d += 1;
  }
  return ra;
}
