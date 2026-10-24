import { congNgayLamViec, demNgayLamViec } from "@/lib/elearning/ngay-lam-viec";
import { hopKhoangCho } from "@/lib/elearning/metrics/grading-queue";

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
 * MIỄN TRỪ ĐÚNG cho MỘT lượt ghi danh — đo bằng HỢP các khoảng chờ.
 *
 * ⚠️ Đây là bản trả nợ `NO_MIEN_TRU_CHONG_KHOANG` của EL-15c. Bản cũ cộng miễn trừ
 * theo TỪNG lượt nộp, mà hạn là của CẢ lượt ghi danh: hai bài tập cùng nộp một ngày
 * và cùng bị chấm trễ 4 ngày sẽ cộng 4 + 4 = 8, trong khi người học chỉ thực sự mất
 * 4 — hai khoảng chờ CHỒNG LÊN NHAU trên trục thời gian.
 *
 * Sai đó về phía CÓ LỢI cho người học, nên nó không gây thiệt hại trực tiếp. Nhưng
 * nó nới cả `slaGraceDays`, tức nới luôn phép so đúng-hạn — và một người trễ THẬT có
 * thể thành "đúng hạn" trên báo cáo tuân thủ. Một chỉ số rộng tay theo hướng nào
 * cũng là chỉ số không dùng được.
 *
 * Nhận MỌI lượt nộp của lượt ghi danh, trả về TỔNG miễn trừ đáng có tính tới `now`.
 * Chỗ gọi so nó với `slaGraceDays` hiện tại rồi chỉ ghi phần chênh.
 */
export function mienTruDungCuaLuotHoc(input: {
  luotNop: { dueGradeAt: Date | null; gradedAt: Date | null }[];
  now: Date;
}): number {
  const khoang = input.luotNop
    .filter((l) => l.dueGradeAt != null)
    .map((l) => ({
      tu: l.dueGradeAt!,
      // Chưa chấm ⇒ đo tới BÂY GIỜ; đã chấm ⇒ dừng ở `gradedAt`. Đo tới `now` cho
      // một lượt đã chấm từ tuần trước là bù cho khoảng chờ không còn xảy ra nữa.
      den: l.gradedAt ?? input.now,
    }))
    .filter((k) => k.den.getTime() > k.tu.getTime());

  return hopKhoangCho(khoang);
}

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
