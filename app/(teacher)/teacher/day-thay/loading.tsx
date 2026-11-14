/** Khung chờ đúng hình dạng danh sách dạy thay (ô ngày + 3 dòng chữ + chip) — không phải spinner giữa màn. */
export default function DayThayLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Đang tải…">
      <div className="space-y-2">
        <div className="h-7 w-32 rounded-lg bg-muted" />
        <div className="h-4 w-80 max-w-full rounded bg-muted" />
      </div>
      <div className="t-card divide-y divide-border overflow-hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-4 px-5 py-4">
            <div className="h-[72px] w-14 shrink-0 rounded-lg bg-muted" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-5 w-56 max-w-full rounded bg-muted" />
              <div className="h-4 w-72 max-w-full rounded bg-muted" />
              <div className="flex gap-1.5">
                <div className="h-6 w-28 rounded-full bg-muted" />
                <div className="h-6 w-24 rounded-full bg-muted" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
