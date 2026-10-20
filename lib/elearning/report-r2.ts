import "server-only";

import { db } from "@/lib/db";
import { demDoan, phanTramPhu, soDoanCua, DOAN_GIAY } from "@/lib/elearning/segment-bitmap";

/**
 * EL-13 — BÁO CÁO R2: CHI TIẾT XEM VIDEO (BA §14.2).
 *
 * ⚠️ R2 là báo cáo có CỬA SỔ 90 NGÀY, không phải báo cáo lịch sử. Dữ liệu tầng 2
 * (bitmap đoạn xem, phiên xem, dấu vân thiết bị) bị cron dọn sau 90 ngày — sau mốc
 * đó R2 KHÔNG CÒN DỰNG ĐƯỢC cho khoảng thời gian đã dọn.
 *
 * Điều này phải nói ra ở chính báo cáo, không giấu trong tài liệu: người quản lý
 * mở R2 cho một khoá học từ năm ngoái và thấy trống trơn sẽ kết luận "hệ thống mất
 * dữ liệu" và đi báo lỗi — trong khi đó là hạn dọn đang làm đúng việc của nó.
 */

/** Số đoạn tối đa vẽ trên một dải nhiệt. Dài hơn thì gộp nhiều đoạn vào một ô. */
export const O_TOI_DA = 120;

export type DaiNhiet = {
  /** Mỗi phần tử là MỘT Ô, giá trị 0..1 = tỉ lệ đoạn đã xem trong ô đó. */
  o: number[];
  /** Mỗi ô đại diện cho ngần này giây nội dung. */
  giayMoiO: number;
};

/**
 * Dựng dải nhiệt từ bitmap.
 *
 * ⚠️ Gộp nhiều đoạn vào một ô khi bài dài, thay vì cắt bớt đuôi. Cắt đuôi là vẽ
 * một dải trông như bài đã hết ở phút thứ 10 — người đọc sẽ kết luận sai về đúng
 * phần cuối bài mà không ai xem.
 */
export function dungDaiNhiet(input: {
  bitmap: Uint8Array | null;
  contentSec: number;
  doanGiay?: number;
  oToiDa?: number;
}): DaiNhiet {
  const doanGiay = input.doanGiay ?? DOAN_GIAY;
  const soDoan = soDoanCua(input.contentSec, doanGiay);
  const oToiDa = input.oToiDa ?? O_TOI_DA;

  if (soDoan <= 0) return { o: [], giayMoiO: doanGiay };

  const soO = Math.min(soDoan, oToiDa);
  const doanMoiO = Math.ceil(soDoan / soO);
  const o: number[] = [];

  for (let i = 0; i < soDoan; i += doanMoiO) {
    const het = Math.min(i + doanMoiO, soDoan);
    let bat = 0;
    for (let j = i; j < het; j += 1) {
      if (input.bitmap && (input.bitmap[j >> 3]! & (1 << (j & 7))) !== 0) bat += 1;
    }
    o.push(bat / (het - i));
  }

  return { o, giayMoiO: doanMoiO * doanGiay };
}

export type DongR2 = {
  lessonTitle: string;
  userId: string;
  coveredSec: number;
  contentSec: number;
  phanTramPhu: number;
  totalWatchSec: number;
  maxPositionSec: number;
  seekCount: number;
  blockedSeekCount: number;
  attnAskedCount: number;
  attnPassedCount: number;
  soPhien: number;
  /** `null` = bitmap ĐÃ BỊ DỌN, khác hẳn "chưa xem gì". */
  dai: DaiNhiet | null;
  daDon: boolean;
};

/**
 * Dựng R2 cho một bài học.
 *
 * ⚠️ Phân biệt "bitmap đã dọn" với "chưa xem gì" bằng `bitmapPurgedAt`, không suy
 * từ việc bitmap rỗng. Gộp hai thứ là báo cáo nói người đã học xong từ năm ngoái
 * là "chưa xem đoạn nào" — và đó là câu sẽ được đọc trong một cuộc họp đánh giá.
 */
export async function dungR2ChoBai(lessonId: string): Promise<DongR2[]> {
  const lesson = await db.trnLesson.findUnique({
    where: { id: lessonId },
    select: { id: true, title: true, durationSec: true },
  });
  if (!lesson) return [];

  const dsTienDo = await db.trnLessonProgress.findMany({
    where: { lessonId },
    select: {
      userId: true,
      segmentBitmap: true,
      segmentSec: true,
      coveredSec: true,
      contentSec: true,
      totalWatchSec: true,
      maxPositionSec: true,
      seekCount: true,
      blockedSeekCount: true,
      attnAskedCount: true,
      attnPassedCount: true,
      bitmapPurgedAt: true,
    },
    orderBy: { coveredSec: "desc" },
  });

  const dem = await db.trnVideoSession.groupBy({
    by: ["userId"],
    where: { lessonId },
    _count: { _all: true },
  });
  const soPhienCua = new Map(dem.map((d) => [d.userId, d._count._all]));

  return dsTienDo.map((t) => {
    const contentSec = t.contentSec || lesson.durationSec || 0;
    const daDon = t.bitmapPurgedAt != null;
    const bitmap = t.segmentBitmap ? new Uint8Array(t.segmentBitmap) : null;
    const soDoan = soDoanCua(contentSec, t.segmentSec);

    return {
      lessonTitle: lesson.title,
      userId: t.userId,
      // ⚠️ `coveredSec` đọc từ CỘT, không đếm lại từ bitmap: sau khi dọn thì bitmap
      // rỗng nhưng con số tổng vẫn phải đúng — nó là tầng 1, không bị dọn.
      coveredSec: t.coveredSec,
      contentSec,
      phanTramPhu:
        bitmap && !daDon
          ? phanTramPhu(bitmap, soDoan)
          : contentSec > 0
            ? Math.round((t.coveredSec / contentSec) * 100)
            : 0,
      totalWatchSec: t.totalWatchSec,
      maxPositionSec: t.maxPositionSec,
      seekCount: t.seekCount,
      blockedSeekCount: t.blockedSeekCount,
      attnAskedCount: t.attnAskedCount,
      attnPassedCount: t.attnPassedCount,
      soPhien: soPhienCua.get(t.userId) ?? 0,
      dai: daDon ? null : dungDaiNhiet({ bitmap, contentSec, doanGiay: t.segmentSec }),
      daDon,
    };
  });
}

/** Số đoạn đã xem — dùng cho chỗ cần con số thô thay vì dải. */
export function demDoanDaXem(bitmap: Uint8Array | null, soDoan: number): number {
  return bitmap ? demDoan(bitmap, soDoan) : 0;
}
