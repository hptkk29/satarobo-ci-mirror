// F-20 — hạn duyệt ảnh/video của một buổi dạy. HÀM THUẦN, không chạm DB, không đọc
// cấu hình: người gọi truyền cấu hình vào (xem `lib/lms/media-review-deadline-config.ts`).
//
// ── VÌ SAO PHẢI NÓI RÕ MÚI GIỜ ────────────────────────────────────────────────
// Hạn nghiệp vụ là "10h sáng GIỜ VIỆT NAM", nhưng mọi `Date` trong hệ là mốc tuyệt
// đối (UTC). Nếu tính bằng `getHours()/getDate()` thì kết quả chạy theo TZ của MÁY:
// máy dev Windows (Asia/Saigon = +07) ra đúng, Vercel/CI (TZ = UTC) lệch 7 tiếng —
// và cái lệch đó chỉ đổi NGÀY với các buổi kết thúc từ 17:00 VN trở đi, tức chỉ lộ
// ra khi có người trực đêm. Vì thế ở đây đi qua `lib/time/vn.ts` (offset cố định
// +07:00, VN không có DST từ 1975), không dùng API giờ địa phương của Node.
//
// ── ĐÓNG BĂNG (F-20-2) ────────────────────────────────────────────────────────
// `isMediaReviewOverdue` nhận `deadlineAt` đã tính sẵn chứ KHÔNG tự đọc cấu hình.
// Hạn phải được tính MỘT LẦN lúc folder duyệt sinh ra rồi lưu lại; nếu mỗi lần đọc
// lại tính theo cấu hình hiện tại thì admin đổi giờ hạn là báo cáo SLA của các
// tháng trước đổi kết quả theo — quá khứ không được viết lại.
import { vnDateAt, vnParts } from "@/lib/time/vn";

export interface ReviewDeadlineConfig {
  /** Giờ hạn duyệt theo đồng hồ VN, 0..23. */
  hour: number;
  /** Số ngày sau ngày dạy, 0..7. 1 = "10h sáng hôm sau". */
  offsetDays: number;
}

function assertValidDate(d: Date, ten: string): void {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new Error(`F-20: ${ten} không phải mốc thời gian hợp lệ`);
  }
}

/**
 * Hạn duyệt của một buổi dạy — trả về MỐC TUYỆT ĐỐI (UTC) ứng với `hour:00` giờ VN,
 * `offsetDays` ngày sau NGÀY VN của `sessionAt`.
 *
 * `sessionAt` có thể là ngày-không-giờ (nửa đêm UTC) hay mốc kết thúc buổi thật —
 * cả hai đều được quy về ngày theo LỊCH VN trước khi cộng ngày. Giờ-phút của buổi
 * không rớt vào hạn: hạn luôn tròn giờ cấu hình.
 *
 * Cấu hình sai khoảng → ném. Cố ý không tự kẹp về biên: hạn duyệt là mốc người ta
 * bị đánh giá trễ/không-trễ, đoán bừa còn tệ hơn dừng lại.
 */
export function computeReviewDeadline(
  sessionAt: Date,
  cfg: ReviewDeadlineConfig,
): Date {
  assertValidDate(sessionAt, "ngày dạy");
  const { hour, offsetDays } = cfg;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`F-20: giờ hạn duyệt phải là số nguyên 0..23 (nhận ${hour})`);
  }
  if (!Number.isInteger(offsetDays) || offsetDays < 0 || offsetDays > 7) {
    throw new Error(
      `F-20: số ngày sau buổi dạy phải là số nguyên 0..7 (nhận ${offsetDays})`,
    );
  }
  const p = vnParts(sessionAt);
  // `Date.UTC` tự tràn ngày sang tháng/năm sau (31/08 + 1 → 01/09), kể cả năm nhuận.
  return vnDateAt(p.year, p.month, p.day + offsetDays, hour, 0);
}

export interface MediaReviewOverdueInput {
  /** Hạn đã ĐÓNG BĂNG của folder (không tính lại theo cấu hình hiện tại). */
  deadlineAt: Date;
  /** Lúc duyệt xong TOÀN BỘ folder. Bỏ trống / null = chưa duyệt xong. */
  completedAt?: Date | null;
  /** "Bây giờ" — truyền vào để hàm thuần và test được. */
  now: Date;
}

/**
 * Buổi này đã quá hạn duyệt chưa?
 *
 * - Chưa duyệt xong → so `now` với hạn.
 * - Đã duyệt xong → so LÚC DUYỆT XONG với hạn (F-31 "Phê duyệt trễ"): duyệt kịp
 *   thì mãi mãi không trễ, duyệt muộn thì mãi mãi là trễ — kết quả không đổi theo
 *   thời gian trôi.
 *
 * Đúng mốc hạn KHÔNG tính là trễ: "hạn 10h" nghĩa là 10:00:00.000 vẫn còn kịp.
 */
export function isMediaReviewOverdue(input: MediaReviewOverdueInput): boolean {
  const { deadlineAt, completedAt, now } = input;
  assertValidDate(deadlineAt, "hạn duyệt");
  assertValidDate(now, "thời điểm hiện tại");
  if (completedAt != null) assertValidDate(completedAt, "thời điểm duyệt xong");
  const moc = completedAt ?? now;
  return moc.getTime() > deadlineAt.getTime();
}
