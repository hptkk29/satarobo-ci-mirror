import { Skeleton } from "@/components/ui/skeleton";

// Khung chờ cho MỌI trang trong khu học tập: thanh bên + thanh trên đứng yên (layout), chỉ phần nội dung hiện
// khung. Hình dạng khớp nội dung thật (tiêu đề · dải số · lưới thẻ) — không phải vòng quay giữa màn (DESIGN.md §5).
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6"
    >
      <span className="sr-only">Đang tải…</span>
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-[5.5rem] w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
