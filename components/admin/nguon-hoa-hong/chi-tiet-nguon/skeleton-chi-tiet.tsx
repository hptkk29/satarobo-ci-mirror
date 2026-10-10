// components/admin/nguon-hoa-hong/chi-tiet-nguon/skeleton-chi-tiet.tsx — khung chờ của trang chi tiết nguồn: ĐÚNG hình thật (tiêu đề + hàng tab + MỘT thẻ chứa bảy mục,
// mỗi mục một tiêu đề và vài dòng nhãn — giá trị). Không spinner giữa màn (DESIGN.md §5).
import { Skeleton } from "@/components/ui/skeleton";

const SO_DONG: readonly number[] = [5, 3, 3, 4, 2, 3, 3]; // Thông tin · Attribution · Đối tượng · Chính sách · Tracking · Thống kê · Lịch sử

export function ChiTietNguonSkeleton() {
  return (
    <div className="max-w-6xl" role="status" aria-busy aria-label="Đang tải chi tiết nguồn…">
      <div className="mb-5 sm:mb-6">
        <Skeleton className="h-7 w-64 max-w-full" />
        <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      </div>
      <div className="mb-4 flex gap-1 overflow-hidden border-b border-border">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-28 shrink-0" />
        ))}
      </div>
      <Skeleton className="mb-4 h-4 w-28" />
      <div className="rounded-xl border border-border bg-card px-4 py-5 sm:px-6">
        {SO_DONG.map((n, i) => (
          <div key={i} className="border-b border-border py-6 first:pt-0 last:border-0 last:pb-0">
            <Skeleton className="h-5 w-40" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: n }, (_, r) => (
                <div key={r} className="grid gap-2 sm:grid-cols-[12.5rem_1fr] sm:gap-4">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-full max-w-md" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
