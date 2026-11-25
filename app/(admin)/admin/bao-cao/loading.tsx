/**
 * REQ-09 — Skeleton chung cho 8 trang báo cáo (segment bao-cao). Mỗi trang query +
 * reduce nặng (dù đã cache theo scope, lần miss vẫn tốn) → hiện khung stat + chart ngay.
 */
export default function BaoCaoLoading() {
  return (
    <div className="animate-pulse space-y-5 p-4" aria-busy="true" aria-label="Đang tải báo cáo…">
      {/* Tiêu đề */}
      <div className="space-y-2">
        <div className="h-6 w-52 rounded-lg bg-muted" />
        <div className="h-4 w-80 max-w-full rounded bg-muted" />
      </div>

      {/* Thẻ số liệu tổng quan */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-muted" />
        ))}
      </div>

      {/* Biểu đồ chính */}
      <div className="h-80 rounded-xl bg-muted" />

      {/* Bảng / biểu đồ phụ */}
      <div className="h-56 rounded-xl bg-muted" />
    </div>
  );
}
