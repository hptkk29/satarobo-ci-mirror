/**
 * Khung chờ ĐÚNG HÌNH danh sách Khuyến mãi (DESIGN.md §5): tiêu đề · ô tìm + chip · bảng văn bản.
 * Trang con có khung riêng (`[id]/loading.tsx`, `moi/loading.tsx`) — khung danh sách hiện ở màn chi
 * tiết là hứa một bố cục rồi đổi ngay trước mắt người dùng.
 */
export default function KhuyenMaiLoading() {
  return (
    <div className="animate-pulse space-y-5" aria-busy="true" aria-label="Đang tải danh sách khuyến mãi…">
      <div className="space-y-2">
        <div className="h-7 w-40 rounded-lg bg-muted" />
        <div className="h-4 w-96 max-w-full rounded bg-muted" />
      </div>
      <div className="flex flex-col gap-3 xl:flex-row xl:justify-between">
        <div className="h-10 w-full rounded-xl bg-muted xl:max-w-xs" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 w-24 rounded-xl bg-muted" />
          ))}
        </div>
      </div>
      <div className="space-y-px overflow-hidden rounded-xl border border-border bg-card">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-5 px-5 py-4">
            <div className="hidden w-28 space-y-2 sm:block">
              <div className="h-4 w-24 rounded bg-muted" />
              <div className="h-5 w-24 rounded-full bg-muted" />
            </div>
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/5 rounded bg-muted" />
              <div className="h-3 w-4/5 rounded bg-muted" />
            </div>
            <div className="hidden w-36 space-y-2 md:block">
              <div className="h-4 w-32 rounded bg-muted" />
              <div className="h-3 w-20 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
