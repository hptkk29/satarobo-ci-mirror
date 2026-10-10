// loading.tsx — hình của màn Đối soát khi dữ liệu kỳ chưa về (§5).
//
// Khung phải dựng ĐỦ mọi khối đứng trước nội dung — tiêu đề, hàng tab module, ScopeBar, thanh
// hướng dẫn — chứ không chỉ phần dưới: thiếu tiêu đề + tab là lúc dữ liệu về, cả trang tụt xuống
// ~130px, đúng thứ mà bộ skeleton này sinh ra để tránh. Giữ luôn bố cục 1/3 – 2/3 của nội dung.
import { Skeleton } from "@/components/ui/skeleton";
import { ScopeBarSkeleton, TableSkeleton } from "@/components/admin/cham-cong/skeletons";

export default function Loading() {
  return (
    <div className="max-w-6xl" aria-busy aria-label="Đang tải đối soát…">
      <div className="mb-5 sm:mb-6">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>

      <div className="mb-4 border-b border-border">
        <div className="-mb-px flex gap-1">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-28" />
          ))}
        </div>
      </div>

      <ScopeBarSkeleton />
      {/* Thanh PageHelp (`<details>` ~44px) — có trên trang thật, phải chừa chỗ. */}
      <Skeleton className="mb-4 h-11 w-full rounded-xl" />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
        <div className="space-y-5 lg:col-span-2">
          <Skeleton className="h-24 w-full rounded-xl" />
          <TableSkeleton cols={8} />
        </div>
      </div>
    </div>
  );
}
