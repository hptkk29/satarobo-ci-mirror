// lib/hoc-bu/lap-rap-3d.ts — TÀI LIỆU LẮP RÁP 3D (ZMROBO) của từng bài trong ca dạy bù. THUẦN (không DB, không `server-only`).
//
// Nguồn DUY NHẤT của liên kết là `Lesson.assemblyManual*` — cùng cột Đào tạo gắn ở giáo trình và tab "Tài liệu học phần" của site GV đọc.
// Học bù KHÔNG sao chép URL vào bảng nào của nó: ca có 1–3 bài (`MakeupCaseLesson`), mỗi bài một liên kết đọc thẳng từ bài đó, nên Đào tạo sửa/gỡ
// ở giáo trình là ca bù thấy ngay lần tải sau. Luật đường dẫn ở `@/lib/lms/assembly-manual` — ở đây chỉ GỌI lại, không viết lại.

import { safeAssemblyManualUrl } from "@/lib/lms/assembly-manual";

/** Dạng đã kiểm, sẵn để dựng <a href>. */
export type LapRap3dBu = {
  url: string;
  setName: string | null;
  modelName: string | null;
};

/** Ba cột của `Lesson` (+ id) mà loader phải `select` — để test canh được việc quên cột. */
export const COT_LAP_RAP_3D = {
  id: true,
  assemblyManualUrl: true,
  assemblyManualSetName: true,
  assemblyManualModelName: true,
} as const;

export type BaiCoCotLapRap3d = {
  id: string;
  assemblyManualUrl: string | null;
  assemblyManualSetName: string | null;
  assemblyManualModelName: string | null;
};

/** Một bài → liên kết đã kiểm, hoặc null (bài không gắn / đường dẫn không hợp lệ ⇒ không có nút, không báo lỗi giả). */
export function lapRap3dCuaBai(b: Omit<BaiCoCotLapRap3d, "id">): LapRap3dBu | null {
  const url = safeAssemblyManualUrl(b.assemblyManualUrl);
  if (!url) return null;
  return { url, setName: b.assemblyManualSetName?.trim() || null, modelName: b.assemblyManualModelName?.trim() || null };
}

/** Nhiều bài → map theo id bài. Bài không có / không hợp lệ vắng mặt khỏi map (người gọi dùng `?? null`). */
export function gomLapRap3d(bai: readonly BaiCoCotLapRap3d[]): Map<string, LapRap3dBu> {
  const kq = new Map<string, LapRap3dBu>();
  for (const b of bai) {
    const v = lapRap3dCuaBai(b);
    if (v) kq.set(b.id, v);
  }
  return kq;
}
