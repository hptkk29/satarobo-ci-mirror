// app/(admin)/admin/cham-cong/loading.tsx — hình của bảng công ngày khi dữ liệu chưa về.
//
// Vì sao file này tồn tại: đổi ngày / đổi khối là một lượt điều hướng server, trước đây màn trắng
// rồi nhảy — người dùng tưởng bấm hụt nên bấm lại. Skeleton phải mang ĐÚNG hình nội dung thật
// (dải ngày ra dải ngày, bảng 7 cột ra bảng 7 cột), không phải một vòng xoay giữa màn.
import { Skeleton } from "@/components/ui/skeleton";
import {
  DayStripSkeleton,
  KpiSkeleton,
  ScopeBarSkeleton,
  TableSkeleton,
} from "@/components/admin/cham-cong/skeletons";

export default function Loading() {
  return (
    <div className="max-w-6xl">
      <div className="mb-5 sm:mb-6">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>
      <Skeleton className="mb-4 h-10 w-full max-w-xl rounded-lg" />
      <ScopeBarSkeleton />
      <DayStripSkeleton />
      <KpiSkeleton n={5} />
      <Skeleton className="mb-4 h-9 w-full rounded-lg" />
      <TableSkeleton cols={7} />
    </div>
  );
}
