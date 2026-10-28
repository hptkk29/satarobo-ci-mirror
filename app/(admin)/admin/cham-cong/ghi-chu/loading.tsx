// Khung chờ của Ghi chú lịch — đúng hình màn thật: tiêu đề → tab module → tab cấu hình → thanh
// khối → hai cột (ma trận thứ rộng, bảng ghi đè hẹp). Đổi khối bằng chip là một lượt tải mới.
import { Skeleton } from "@/components/ui/skeleton";
import { ScopeBarSkeleton, TableSkeleton } from "@/components/admin/cham-cong/skeletons";

export default function Loading() {
  return (
    <div className="max-w-6xl">
      <Skeleton className="mb-2 h-7 w-40" />
      <Skeleton className="mb-5 h-4 w-96 max-w-full" />
      <Skeleton className="mb-4 h-10 w-full rounded-none" />
      <div className="mb-4 flex flex-wrap gap-1">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-24 rounded-lg" />
        ))}
      </div>
      <ScopeBarSkeleton />
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <TableSkeleton cols={8} rows={3} />
        <TableSkeleton cols={6} rows={6} />
      </div>
    </div>
  );
}
