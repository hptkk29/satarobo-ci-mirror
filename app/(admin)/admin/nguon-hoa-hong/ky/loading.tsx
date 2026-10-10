// Khung chờ đúng HÌNH của tab "Kỳ" (DESIGN.md §5: skeleton, không spinner giữa màn): đầu trang + hàng tab + thanh cơ sở + hàng tháng/trạng thái + dải 4 ô số +
// thẻ "Việc còn dang dở" + bảng các kỳ (10 cột từ xl; danh sách thẻ dưới xl). Khung (tiêu đề, tab) đứng yên; chỉ phần thân nhấp nháy.
import { BangSkeleton } from "@/components/admin/nguon-hoa-hong/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="max-w-6xl" role="status" aria-busy aria-label="Đang tải kỳ hoa hồng…">
      <div className="mb-5 sm:mb-6">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="mb-4 flex gap-1 border-b border-border">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-28" />
        ))}
      </div>
      <Skeleton className="mb-4 h-14 w-full rounded-xl" />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Skeleton className="h-9 w-52 rounded-lg" />
        <Skeleton className="h-6 w-40 rounded-full" />
      </div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[74px] w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="mb-4 h-28 w-full rounded-xl" />
      {/* Từ xl: bảng 10 cột (bằng số <th> của BangKy). Dưới xl BangKy là danh sách thẻ nên khung chờ cũng là thẻ. */}
      <div className="hidden xl:block">
        <BangSkeleton cot={10} dong={6} />
      </div>
      <div data-khung-the className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card xl:hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
            <Skeleton className="mt-2 h-4 w-56 max-w-full" />
            <Skeleton className="mt-1.5 h-3 w-64 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
