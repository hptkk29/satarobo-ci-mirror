// Skeleton ĐÚNG HÌNH DẠNG của màn «Ngoại lệ» (không spinner giữa màn). Dùng cho `loading.tsx` và làm `fallback` của <Suspense>.
// Khối dùng `bg-border` (không phải `bg-muted` mặc định): nền admin là #f5f5f5 = đúng màu `--muted` nên khung chờ vô hình (đo 28/10/2026).
import { Skeleton } from "@/components/ui/skeleton";

export function KhungChoNgoaiLe() {
  return (
    <div role="status" aria-label="Đang tải danh sách ngoại lệ" className="mx-auto w-full max-w-[120rem]">
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-14 bg-border" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full 2xl:h-11 bg-border" />
        ))}
      </div>
    </div>
  );
}
