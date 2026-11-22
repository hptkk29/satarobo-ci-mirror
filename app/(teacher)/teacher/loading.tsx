/**
 * REQ-09 (=TEA-04) — Skeleton chung cho site giáo viên. Các trang GV (lịch, học viên,
 * điểm danh, chấm bài…) await DB trực tiếp → hiện khung ngay khi điều hướng.
 */
export default function TeacherLoading() {
  return (
    <div
      className="animate-pulse space-y-6"
      aria-busy="true"
      aria-label="Đang tải…"
    >
      {/* Header */}
      <div className="space-y-2">
        <div className="h-7 w-48 rounded-lg bg-muted" />
        <div className="h-4 w-36 rounded bg-muted" />
      </div>

      {/* Hàng thẻ KPI */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl bg-muted" />
        ))}
      </div>

      {/* Khối nội dung chính */}
      <div className="h-64 rounded-2xl bg-muted" />

      {/* Hai khối phụ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-40 rounded-2xl bg-muted" />
        <div className="h-40 rounded-2xl bg-muted" />
      </div>
    </div>
  );
}
