// Khung chờ ĐÚNG HÌNH màn Hoá đơn điện tử (DESIGN.md §5): tiêu đề · dải ngăn · bảng 5 cột + ngăn
// xử lý bên phải (≥ xl). Không spinner giữa màn.
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Đang tải danh sách hoá đơn điện tử">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-6 flex gap-1 overflow-hidden rounded-xl bg-muted p-1">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-28 shrink-0 rounded-lg" />
        ))}
      </div>
      <div className="mt-4 xl:grid xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-5">
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="h-10 border-b border-border bg-muted/40" />
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex h-11 items-center gap-6 border-b border-border/60 px-5 last:border-0">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="hidden h-4 w-28 sm:block" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
        <div className="hidden flex-col gap-4 rounded-xl border border-border bg-card p-5 xl:flex">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    </div>
  );
}
