// Skeleton ĐÚNG HÌNH DẠNG (không spinner giữa màn). Dùng làm `fallback` của <Suspense> ở danh sách và làm `loading.tsx` của chi tiết.
// Cố ý KHÔNG đặt `loading.tsx` ở cấp /ai-lead: nó sẽ phủ luôn /ai-lead/cau-hinh và /ai-lead/ket-noi (của lát khác) bằng khung danh sách.
import { Skeleton } from "@/components/ui/skeleton";

export function KhungChoDanhSach() {
  return (
    <div role="status" aria-label="Đang tải danh sách hồ sơ chờ AI" className="mx-auto w-full max-w-[120rem]">
      <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-border p-3 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-11 sm:h-10 bg-border" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full bg-border" />
        ))}
      </div>
    </div>
  );
}

export function KhungChoChiTiet() {
  return (
    <div role="status" aria-label="Đang tải hồ sơ" className="mx-auto w-full max-w-[90rem] space-y-4">
      <Skeleton className="h-7 w-64 max-w-full bg-border" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="space-y-4">
          <Skeleton className="h-56 w-full bg-border" />
          <Skeleton className="h-40 w-full bg-border" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-64 w-full bg-border" />
          <Skeleton className="h-48 w-full bg-border" />
        </div>
      </div>
    </div>
  );
}
