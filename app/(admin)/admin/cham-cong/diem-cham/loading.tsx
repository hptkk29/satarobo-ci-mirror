// Khung chờ của màn Điểm chấm công — cùng hình với nội dung thật (tiêu đề → tab module → tab cấu hình →
// thanh công cụ → danh sách thẻ theo cơ sở), để chuyển tab không nháy trắng rồi nhảy.
import { Skeleton } from "@/components/ui/skeleton";

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
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-40 rounded-xl" />
        <Skeleton className="ml-auto h-9 w-36 rounded-lg" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 2 }, (_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
