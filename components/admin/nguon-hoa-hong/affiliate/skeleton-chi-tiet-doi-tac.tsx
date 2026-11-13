// components/admin/nguon-hoa-hong/affiliate/skeleton-chi-tiet-doi-tac.tsx — hình dạng của TRANG CHI TIẾT ĐỐI TÁC khi dữ liệu chưa về (`loading.tsx` của `affiliate/[id]`).
// Mang ĐÚNG hình nội dung thật (tiêu đề + hàng tab + liên kết quay lại + MỘT thẻ năm mục) — không phải spinner giữa màn (DESIGN.md §5).
import { Skeleton } from "@/components/ui/skeleton";
import { KHUNG_NOI_DUNG } from "@/components/admin/nguon-hoa-hong/khung-rong";

export function ChiTietDoiTacSkeleton() {
  return (
    <div className={KHUNG_NOI_DUNG} role="status" aria-busy aria-label="Đang tải chi tiết đối tác…">
      <div className="mb-5 sm:mb-6">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="mb-4 flex gap-1 border-b border-border">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-28" />
        ))}
      </div>
      <Skeleton className="mb-4 h-5 w-32" />
      <div className="divide-y divide-border rounded-xl border border-border bg-card px-4 sm:px-6">
        {[6, 5, 3, 3, 2].map((soDong, m) => (
          <div key={m} className="space-y-3 py-5">
            <Skeleton className="h-5 w-44" />
            {Array.from({ length: soDong }, (_, i) => (
              <Skeleton key={i} className="h-4 w-full max-w-2xl" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
