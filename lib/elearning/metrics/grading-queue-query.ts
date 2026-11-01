import type { ScopedDb } from "@/lib/actions/factory";
import {
  dungBangChiSo,
  type BangChiSo,
} from "@/lib/elearning/metrics/grading-queue";

/**
 * EL-15d — TRA DỮ LIỆU cho bảng chỉ số hàng đợi chấm.
 *
 * ⚠️ Đọc QUA `scopedDb`. Chỉ số của cơ sở khác không phải việc của người đang xem,
 * và một con số gộp toàn công ty hiện trên màn của quản lý cơ sở sẽ khiến họ hành
 * động theo một tình hình không phải của mình.
 */

export type KyDo = { tu: Date; den: Date };

export async function napBangChiSo(
  db: ScopedDb,
  opt: { ky: KyDo; bayGio: Date },
): Promise<BangChiSo> {
  const [daCham, dangCho] = await Promise.all([
    // Mẫu số của M9 là bài ĐÃ CHẤM TRONG KỲ — lọc theo `gradedAt`, không theo
    // `submittedAt`: một bài nộp tháng trước mà chấm tháng này thuộc về công sức
    // của tháng này.
    db.trnSubmission.findMany({
      where: {
        gradedAt: { gte: opt.ky.tu, lt: opt.ky.den },
        status: { in: ["GRADED", "NEEDS_REVISION"] },
      },
      select: { dueGradeAt: true, gradedAt: true },
      take: 5000,
    }),
    // M10 đo TỒN ĐỌNG HIỆN TẠI, không theo kỳ: hàng đợi là thứ đang xảy ra, và
    // cắt nó theo tháng là giấu mất một bài bị bỏ quên từ quý trước.
    db.trnSubmission.findMany({
      where: { status: "SUBMITTED" },
      select: { dueGradeAt: true },
      take: 5000,
    }),
  ]);

  return dungBangChiSo({ daCham, dangCho, bayGio: opt.bayGio });
}

/**
 * Kỳ đo mặc định: THÁNG HIỆN TẠI, tính theo giờ Việt Nam.
 *
 * ⚠️ Tính mốc bằng UTC-7 thay vì để `new Date(y, m, 1)` dùng giờ máy chủ: Vercel
 * chạy UTC, nên "đầu tháng" theo giờ máy chủ lệch 7 giờ so với đầu tháng của người
 * đọc báo cáo — và những bài chấm trong 7 giờ đó rơi nhầm kỳ.
 */
export function kyThangNay(bayGio: Date): KyDo {
  const vn = new Date(bayGio.getTime() + 7 * 3600_000);
  const tu = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), 1) - 7 * 3600_000);
  const den = new Date(
    Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth() + 1, 1) - 7 * 3600_000,
  );
  return { tu, den };
}
