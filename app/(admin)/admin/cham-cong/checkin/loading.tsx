// Khung chờ màn chấm công: đúng một thẻ hẹp + MỘT nút "Chấm công" 64px (bỏ hai nút từ 06/10/2026),
// để trang không nhảy khi vé về.
// Cấp vé có chạm DB nên khoảnh khắc này người dùng đang cầm điện thoại chờ — phải thấy hình thẻ ngay.
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-sm" aria-busy aria-label="Đang tải…">
      <Skeleton className="mx-auto mb-4 h-7 w-40" />
      <div className="rounded-2xl border border-border bg-card p-6">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-2 h-5 w-48" />
        <Skeleton className="mt-2 h-4 w-40" />
        <Skeleton className="mt-5 h-9 w-44" />
        <Skeleton className="mt-4 h-16 w-full rounded-xl" />
        <Skeleton className="mt-4 h-3 w-full" />
      </div>
    </div>
  );
}
