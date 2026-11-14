// Khung chờ đúng HÌNH của trang «Chuyển sang hoa hồng mới» (DESIGN.md §5: skeleton, không spinner giữa màn): đầu trang + khối mốc hiện tại + khối mốc đề xuất
// (ba ô nhập + nút) + dòng nhắc chưa xem trước + bảng lịch sử. Khung admin (sidebar, topbar) đứng yên.
import { BangSkeleton } from "@/components/admin/nguon-hoa-hong/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="max-w-5xl" role="status" aria-busy aria-label="Đang tải trang chuyển hoa hồng…">
      <div className="mb-5 sm:mb-6">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="flex flex-col gap-6">
        <div>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-4 h-5 w-96 max-w-full" />
        </div>
        <div className="border-t border-border pt-6">
          <Skeleton className="h-5 w-36" />
          <div className="mt-4 grid max-w-3xl gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
          <Skeleton className="mt-4 h-9 w-44 rounded-lg" />
        </div>
        <div className="border-t border-border pt-6">
          <Skeleton className="h-5 w-40" />
          <div className="mt-4">
            <BangSkeleton cot={6} dong={4} />
          </div>
        </div>
      </div>
    </div>
  );
}
