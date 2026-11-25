/** Khung chờ đúng hình MỘT văn bản khuyến mãi: tiêu đề + dòng meta · ưu đãi | cột thông tin · bảng mã. */
export default function ChiTietKhuyenMaiLoading() {
  return (
    <div className="animate-pulse space-y-5" aria-busy="true" aria-label="Đang tải chính sách…">
      <div className="h-4 w-36 rounded bg-muted" />
      <div className="space-y-2">
        <div className="h-7 w-80 max-w-full rounded-lg bg-muted" />
        <div className="h-5 w-64 max-w-full rounded bg-muted" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3 lg:items-start">
        <div className="space-y-3 rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="h-4 w-40 rounded bg-muted" />
          <div className="h-5 w-full rounded bg-muted" />
          <div className="h-5 w-4/5 rounded bg-muted" />
          <div className="mt-4 h-4 w-32 rounded bg-muted" />
          <div className="h-4 w-3/4 rounded bg-muted" />
        </div>
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3 w-20 rounded bg-muted" />
              <div className="h-4 w-36 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
      <div className="h-40 rounded-xl border border-border bg-card" />
    </div>
  );
}
