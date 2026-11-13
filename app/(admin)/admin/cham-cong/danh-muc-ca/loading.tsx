// Khung chờ của màn Mã ca — mang đúng hình nội dung thật (tiêu đề → tab module → tab cấu hình →
// thanh lọc → bảng 10 cột), để đổi tab không nháy trắng rồi nhảy.
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/admin/cham-cong/skeletons";

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
      <div className="mb-4 flex flex-wrap gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-xl" />
        ))}
      </div>
      <TableSkeleton cols={10} />
    </div>
  );
}
