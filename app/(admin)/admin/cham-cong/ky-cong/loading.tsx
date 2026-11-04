// app/(admin)/admin/cham-cong/ky-cong/loading.tsx — khung chờ đúng HÌNH của màn kỳ công.
//
// Vì sao file này tồn tại: màn này chạy 3–4 truy vấn nặng (tổng hợp cả kỳ + cờ theo ngày), nên
// khoảng trắng giữa hai lần bấm tháng là thật. Khung xám đúng hình giữ bố cục đứng yên; spinner
// giữa màn thì vừa không nói được gì vừa làm nội dung nhảy khi hiện ra.
import { Skeleton } from "@/components/ui/skeleton";
import {
  KpiSkeleton,
  ScopeBarSkeleton,
  TableSkeleton,
} from "@/components/admin/cham-cong/skeletons";

export default function Loading() {
  return (
    <div className="max-w-6xl" aria-busy aria-label="Đang tải kỳ công…">
      <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Skeleton className="h-7 w-80" />
          <Skeleton className="mt-2 h-4 w-96" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      <div className="mb-4 border-b border-border">
        <div className="-mb-px flex gap-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-28" />
          ))}
        </div>
      </div>

      <ScopeBarSkeleton />
      {/* Thanh PageHelp (`<details>` ~44px) — có trên trang thật, phải chừa chỗ. */}
      <Skeleton className="mb-4 h-11 w-full rounded-xl" />
      <KpiSkeleton n={5} />

      <div className="mb-4 rounded-xl border border-border bg-card p-5">
        <Skeleton className="mb-3 h-4 w-56" />
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-border bg-card p-5">
        <Skeleton className="mb-3 h-4 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>

      <TableSkeleton cols={13} rows={8} />
    </div>
  );
}
