// Khung chờ đúng hình màn công dạy: tiêu đề → tab → thanh phạm vi → 4 ô chỉ số → bảng người
// → bảng hệ số.
import { Skeleton } from "@/components/ui/skeleton";
import { KpiSkeleton, ScopeBarSkeleton, TableSkeleton } from "@/components/admin/cham-cong/skeletons";

export default function Loading() {
  return (
    <div className="max-w-6xl">
      <Skeleton className="mb-2 h-7 w-80 max-w-full" />
      <Skeleton className="mb-5 h-4 w-[30rem] max-w-full" />
      <Skeleton className="mb-4 h-10 w-full rounded-none" />
      <ScopeBarSkeleton />
      <Skeleton className="mb-4 h-11 w-full rounded-xl" />
      <KpiSkeleton n={4} />
      <TableSkeleton cols={4} rows={6} />
      <div className="mt-5">
        <TableSkeleton cols={7} rows={6} />
      </div>
    </div>
  );
}
