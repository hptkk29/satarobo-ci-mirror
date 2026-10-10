// components/admin/nguon-hoa-hong/form-nguon-skeleton.tsx — hình dạng của biểu mẫu Tạo / Sửa nguồn khi dữ liệu chưa về (`loading.tsx` của `/nguon/tao` và `/nguon/[maNguon]/sua`).
// Mang ĐÚNG hình nội dung thật (tiêu đề + hàng tab + liên kết quay lại + 4 mục có nhãn và ô) — không phải spinner giữa màn (DESIGN.md §5).
import { Skeleton } from "@/components/ui/skeleton";

export function FormNguonSkeleton({ nhan }: { nhan: string }) {
  return (
    <div className="max-w-6xl" role="status" aria-busy aria-label={`Đang tải ${nhan}…`}>
      <div className="mb-5 sm:mb-6">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="mb-4 flex gap-1 border-b border-border">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-28" />
        ))}
      </div>
      <Skeleton className="mb-4 h-5 w-32" />
      <div className="max-w-3xl divide-y divide-border rounded-xl border border-border bg-card px-5">
        {[3, 3, 2, 3].map((soO, m) => (
          <div key={m} className="space-y-4 py-5">
            <Skeleton className="h-5 w-40" />
            {Array.from({ length: soO }, (_, i) => (
              <div key={i}>
                <Skeleton className="mb-1.5 h-4 w-28" />
                <Skeleton className="h-9 w-full rounded-lg" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
