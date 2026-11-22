// Khung chờ ĐÚNG HÌNH tab Cấu hình (S5b): tiêu đề mục · bảng ký hiệu. Trước đây trang này mượn khung chờ của bàn chứng từ
// (sai hình ⇒ khung nhảy khi dữ liệu về — audit 05 G16). Tiêu đề / tab / thanh phạm vi do layout vẽ, không nằm ở đây.
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Đang tải cấu hình hoá đơn">
      <Skeleton className="h-5 w-44" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        <div className="h-10 border-b border-border bg-muted/40" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex h-11 items-center gap-6 border-b border-border/60 px-5 last:border-0">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
