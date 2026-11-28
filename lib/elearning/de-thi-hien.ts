import { LOAI_CHAM_TAY } from "@/lib/elearning/exam-grading";

/**
 * P8/QtDeThi — dòng phụ dưới tên đề ("12 câu · 12 dạng · 2 câu chấm tay"). THUẦN. Đếm trên các câu ĐANG nằm trong đề (không phải trong kho).
 * "Chấm tay" = loại câu thuộc `LOAI_CHAM_TAY` (người chấm đọc và cho điểm — chúng vào hàng chờ Chấm bài thi tự luận); các loại khác do máy chấm hoặc CHƯA mở.
 */
export type TomTatDe = { soCau: number; soDang: number; soCauTay: number };

export function tomTatDe(loaiCacCau: readonly string[]): TomTatDe {
  const tay = new Set<string>(LOAI_CHAM_TAY);
  return {
    soCau: loaiCacCau.length,
    soDang: new Set(loaiCacCau).size,
    soCauTay: loaiCacCau.filter((t) => tay.has(t)).length,
  };
}

export function dongPhuDe(t: TomTatDe): string {
  if (t.soCau === 0) return "Chưa có câu nào";
  const phan = [`${t.soCau} câu`, `${t.soDang} dạng`];
  if (t.soCauTay > 0) phan.push(`${t.soCauTay} câu chấm tay`);
  return phan.join(" · ");
}
