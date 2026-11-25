/**
 * REQ-09 — Skeleton dashboard admin. Dashboard fetch nặng (aggregate nhiều bảng theo
 * scope) → hiện khung ngay khi điều hướng thay vì màn trắng, RSC stream vào sau.
 */
export default function DashboardLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Đang tải bảng điều khiển…">
      {/* Header */}
      <div className="space-y-2">
        <div className="h-7 w-56 rounded-lg bg-muted" />
        <div className="h-4 w-40 rounded bg-muted" />
      </div>

      {/* Băng "Cần xử lý" */}
      <div className="h-40 rounded-xl bg-muted" />

      {/* 5 thẻ KPI */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-muted" />
        ))}
      </div>

      {/* 3 KPI phụ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-muted" />
        ))}
      </div>

      {/* 2 biểu đồ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-72 rounded-xl bg-muted" />
        <div className="h-72 rounded-xl bg-muted" />
      </div>
    </div>
  );
}
