import { congNgayLamViec, demNgayLamViec } from "@/lib/elearning/ngay-lam-viec";

/**
 * BÙ HẠN khi NGƯỜI CHẤM trễ — thuần.
 *
 * Không DB, không giờ hệ thống, không mạng.
 *
 * ⚠️ Vì sao phải có: hạn của bài tập là hạn CỨNG, và quá hạn thì `due-lock.ts`
 * KHOÁ đường ghi tiến độ. Nếu người chấm để bài nằm một tuần thì người NỘP bị khoá
 * và bị đánh `OVERDUE` — vì lỗi của người khác. Kế hoạch gọi đúng tên: "hạn chót
 * cứng mà hệ thống chấm chậm rồi vẫn ghi người học trễ là lỗi thiết kế, không phải
 * lỗi kỷ luật".
 *
 * ⚠️ HAI vế, và chúng KHÔNG thay nhau được:
 *
 *  1. **vận hành** — `dueAt` lùi đúng số ngày chờ ⇒ họ nộp lại được, không bị khoá,
 *     không bị đánh `OVERDUE`;
 *  2. **chỉ số** — cộng `slaGraceDays` ⇒ phép so "xong đúng hạn hay trễ" nới ra
 *     đúng chừng ấy.
 *
 * Thiếu vế 2 thì vế 1 VÔ NGHĨA: `cuonTienDoKhoa` phân biệt `COMPLETED` với
 * `COMPLETED_LATE` bằng `dueAtOriginal` — cột BẤT BIẾN mà không đường nào được ghi
 * lại. Người bị bỏ quên năm ngày, được nới hạn, học xong đúng hạn mới — VẪN bị đếm
 * là TRỄ trên báo cáo tuân thủ gửi thẳng quản lý trực tiếp, có ghi tên.
 *
 * ⚠️ `dueAtOriginal` KHÔNG BAO GIỜ bị ghi lại. Nó là mốc gốc, và mọi chỉ số đúng-hạn
 * đọc nó. Phép bù cộng thêm một khoản MIỄN TRỪ bên cạnh, không sửa mốc.
 */

export type SoBuHienCo = {
  /** Số ngày làm việc ĐÃ bù cho lượt nộp này ở những lần chạy trước. */
  daBuNgayLam: number;
};

/**
 * ⚠️ GIỚI HẠN ĐÃ BIẾT — miễn trừ cộng theo TỪNG LƯỢT NỘP, mà hạn là của CẢ LƯỢT
 * GHI DANH.
 *
 * Một khoá có hai bài tập, cả hai nộp cùng ngày và cả hai bị chấm trễ 4 ngày. Hai
 * khoảng chờ đó CHỒNG LÊN NHAU trên trục thời gian — người học chỉ thực sự mất 4
 * ngày — nhưng sổ cộng 4 + 4 = 8, và `dueAt` nới ra gấp đôi phần đáng bù.
 *
 * Sai về phía CÓ LỢI cho người học, và đó là lý do chấp nhận được ở đợt này: sai
 * ngược lại (bù thiếu) là ghi tên họ vào cột trễ của báo cáo gửi quản lý. Nhưng nó
 * VẪN là sai, và nó nới cả `slaGraceDays` — tức nới luôn phép so đúng-hạn.
 *
 * Muốn đúng thì phải đo HỢP của các khoảng chờ theo lượt ghi danh, tức cần đọc mọi
 * lượt nộp của lượt ghi danh đó trong một lần và tính hợp khoảng — việc của EL-15d
 * cùng chỉ số M9/M10, nơi đằng nào cũng phải gom theo lượt ghi danh.
 */
export const NO_MIEN_TRU_CHONG_KHOANG =
  "Miễn trừ cộng theo từng lượt nộp; nhiều bài tập trễ song song sẽ cộng dồn các khoảng chờ chồng nhau (bù THỪA). Đo hợp khoảng ở EL-15d.";

export type KetQuaTinhBu = {
  /** Tổng số ngày làm việc ĐÁNG LẼ được bù, tính từ đầu. */
  tongDangLe: number;
  /** Phần còn THIẾU so với sổ — đây là số ngày cần cộng thêm lần này. */
  themNgayLam: number;
};

/**
 * Tính phần bù CÒN THIẾU cho một lượt nộp.
 *
 * ⚠️ Trả về phần CHÊNH so với sổ, không trả tổng. Đây là thứ giữ cho cron chạy mỗi
 * đêm mà không bù chồng: không có sổ thì đêm nào cũng cộng thêm một lần cho cùng
 * một lượt nộp, và hạn trôi ra vô hạn mà không ai thấy — cron không ghi audit.
 *
 * ⚠️ Mốc dừng là `gradedAt` nếu đã chấm. Đo tới `now` cho một lượt đã chấm xong từ
 * tuần trước là tiếp tục bù cho một khoảng chờ KHÔNG CÒN xảy ra nữa.
 */
export function tinhBuSla(input: {
  /** Hạn chấm = `submittedAt` + `SLA_GRADE_DAYS` ngày làm việc. */
  dueGradeAt: Date | null;
  /** Mốc chấm xong, `null` nếu chưa chấm. */
  gradedAt: Date | null;
  now: Date;
  so: SoBuHienCo;
}): KetQuaTinhBu {
  const daBu = Math.max(0, Math.floor(input.so.daBuNgayLam));

  // Không có hạn chấm thì không có gì để trễ. (Lượt nộp cũ trước khi có cột này,
  // hoặc dữ liệu lệch — im lặng bỏ qua đúng hơn là đoán một mốc.)
  if (!input.dueGradeAt) return { tongDangLe: daBu, themNgayLam: 0 };

  const moc = input.gradedAt ?? input.now;
  // Chấm đúng hạn hoặc sớm ⇒ không bù. `demNgayLamViec` đã trả 0 khi mốc sau nhỏ
  // hơn mốc trước, nhưng viết rõ ở đây để người đọc không phải đi tra.
  if (moc.getTime() <= input.dueGradeAt.getTime()) {
    return { tongDangLe: daBu, themNgayLam: 0 };
  }

  const tongDangLe = demNgayLamViec(input.dueGradeAt, moc);
  return {
    tongDangLe,
    // KHÔNG bao giờ âm: sổ đã ghi nhiều hơn thì để nguyên, đừng rút hạn về —
    // rút lại một khoản đã cho là đổi hạn của người ta theo chiều xấu đi.
    themNgayLam: Math.max(0, tongDangLe - daBu),
  };
}

/**
 * Hạn MỚI sau khi cộng thêm phần bù.
 *
 * ⚠️ Cộng bằng NGÀY LÀM VIỆC, không phải ngày lịch. Chờ 5 ngày làm việc mà bù 5
 * ngày lịch là bù THIẾU 2 ngày, và người học vẫn chịu một phần hậu quả của việc
 * người chấm chậm.
 *
 * ⚠️ Cộng từ CHÍNH `dueAt` hiện tại, không từ `max(dueAt, now)`. Cộng từ `now` cho
 * một lượt đã quá hạn là tặng thêm nhiều hơn khoảng chờ thật — `tinhGiaHan` của
 * `extend-revoke.ts` làm thế và ĐÚNG cho gia hạn tay (người xử chủ động cho thêm
 * thời gian), nhưng SAI cho phép bù (trả lại đúng phần đã mất).
 */
export function hanSauKhiBu(dueAt: Date | null, themNgayLam: number): Date | null {
  if (!dueAt || themNgayLam <= 0) return dueAt;
  return congNgayLamViec(dueAt, themNgayLam);
}
