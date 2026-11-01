// Khung chờ đúng hình màn thống kê: tiêu đề → tab module → thanh phạm vi → 5 ô chỉ số → bảng.
//
// Màn này dựng tổng hợp cả kỳ (giống Kỳ công) nên khoảng trắng giữa hai lần bấm tháng là thật.
import { Skeleton } from "@/components/ui/skeleton";
import { KpiSkeleton, ScopeBarSkeleton, TableSkeleton } from "@/components/admin/cham-cong/skeletons";

export default function Loading() {
  return (
    <div className="max-w-6xl">
      <Skeleton className="mb-2 h-7 w-96 max-w-full" />
      <Skeleton className="mb-5 h-4 w-[34rem] max-w-full" />
      <Skeleton className="mb-4 h-10 w-full rounded-none" />
      <ScopeBarSkeleton />
      <Skeleton className="mb-4 h-11 w-full rounded-xl" />
      <KpiSkeleton n={5} />
      <TableSkeleton cols={7} rows={8} />
    </div>
  );
}
