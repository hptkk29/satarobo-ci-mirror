// app/(admin)/admin/don-tu/loading.tsx — khung chờ của hàng chờ duyệt đơn.
//
// Hình phải trùng nội dung thật (thanh phạm vi → 4 ô số → hàng tab → bảng 8 cột): đổi cơ sở hay
// đổi tab là cả trang chạy lại ở server, không có skeleton thì màn trắng rồi nhảy — người duyệt
// tưởng bấm hụt và bấm lại.
import { Skeleton } from "@/components/ui/skeleton";
import {
  KpiSkeleton,
  ScopeBarSkeleton,
  TableSkeleton,
} from "@/components/admin/cham-cong/skeletons";

export default function Loading() {
  return (
    <div className="max-w-6xl">
      <div className="mb-5 sm:mb-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <Skeleton aria-busy aria-label="Đang tải…" className="mb-4 h-9 w-full rounded-lg" />
      <ScopeBarSkeleton />
      <KpiSkeleton n={4} />
      <div aria-busy aria-label="Đang tải…" className="mb-4 flex flex-wrap gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-xl" />
        ))}
      </div>
      <TableSkeleton cols={8} rows={8} />
    </div>
  );
}
