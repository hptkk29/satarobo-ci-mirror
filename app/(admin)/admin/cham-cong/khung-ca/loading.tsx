// Khung chờ của Khung ca tuần — mang đúng hình màn thật (tiêu đề → tab module → tab cấu hình →
// thanh khối → hai thẻ khối, mỗi thẻ một bảng 9 cột). Đổi khối bằng chip là một lượt tải mới; không
// có khung chờ thì màn trắng một nhịp rồi nhảy, người dùng tưởng bấm hụt và bấm lại.
import { Skeleton } from "@/components/ui/skeleton";
import { ScopeBarSkeleton, TableSkeleton } from "@/components/admin/cham-cong/skeletons";

export default function Loading() {
  return (
    <div className="max-w-6xl">
      <Skeleton className="mb-2 h-7 w-48" />
      <Skeleton className="mb-5 h-4 w-96 max-w-full" />
      <Skeleton className="mb-4 h-10 w-full rounded-none" />
      <div className="mb-4 flex flex-wrap gap-1">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-24 rounded-lg" />
        ))}
      </div>
      <ScopeBarSkeleton />
      <div className="space-y-4">
        <TableSkeleton cols={9} rows={8} />
        <TableSkeleton cols={9} rows={5} />
      </div>
    </div>
  );
}
