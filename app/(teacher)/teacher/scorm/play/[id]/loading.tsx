import { Loader2 } from "lucide-react";

/**
 * Khung chờ của trang trình chiếu SCORM (site GV). Trước đây rơi về skeleton CHUNG của site (bốn thẻ KPI + bảng) — giáo viên
 * bấm "Mở trình chiếu" thấy một trang tổng quan trống đang quay, không biết mình đang đợi bài giảng. Nói thẳng việc đang làm.
 */
export default function ScormPlayLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary-ink" aria-hidden />
      <p className="text-sm font-semibold text-foreground">Đang chuẩn bị bài giảng…</p>
      <p className="max-w-sm text-sm text-muted-foreground">Nếu mạng yếu, bước này có thể mất vài giây.</p>
    </div>
  );
}
