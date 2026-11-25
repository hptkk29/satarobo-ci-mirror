import { Loader2 } from "lucide-react";

/**
 * Khung chờ của trang trình chiếu SCORM (khu admin). Nếu không có file này thì rơi về skeleton CHUNG của /admin (thẻ KPI + bảng) —
 * người dùng bấm "Mở trình chiếu" thấy một trang tổng quan trống đang quay, không biết mình đang đợi bài giảng.
 * Trang GV app/(teacher)/teacher/scorm/play/[id]/loading.tsx cùng nội dung — sửa THÀNH CẶP.
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
