// loading.tsx — hình của màn QR quầy khi đang đọc điểm chấm công + lượt chấm hôm nay.
// Ô QR là hình VUÔNG 240px đúng như thật: nếu vẽ một vòng xoay giữa màn thì lúc dữ liệu về,
// khối QR nhảy vào đẩy cả trang trượt xuống.
import { Skeleton } from "@/components/ui/skeleton";
import { ScopeBarSkeleton } from "@/components/admin/cham-cong/skeletons";

export default function Loading() {
  return (
    <div className="max-w-3xl">
      <div className="mb-5 sm:mb-6" aria-busy aria-label="Đang tải…">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <ScopeBarSkeleton />
      <div className="grid gap-5 lg:grid-cols-2" aria-busy aria-label="Đang tải…">
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-5">
          <Skeleton className="aspect-square w-60 rounded-xl" />
          <Skeleton className="h-3 w-28" />
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
      <Skeleton className="mt-5 h-56 rounded-xl" aria-busy aria-label="Đang tải…" />
    </div>
  );
}
