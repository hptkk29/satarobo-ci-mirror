/**
 * Skeleton cho /cong-no.
 *
 * Trang này `force-dynamic` và nay tra DB HAI lượt `getDebtRows` (một cho khối tuổi nợ,
 * một cho bảng đối soát có cả nhóm chưa chốt giá) cộng một lượt gom đợt trả góp — đủ lâu
 * để người dùng nhìn thấy khoảng trắng nếu không có khung.
 *
 * Khung dựng theo ĐÚNG HÌNH DẠNG nội dung thật (DESIGN.md §5: skeleton đúng hình dạng,
 * không phải spinner giữa màn): tiêu đề → 5 ô tuổi nợ → thanh trạng thái → bảng.
 */
export default function CongNoLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Đang tải công nợ…">
      {/* Tiêu đề trang */}
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-lg bg-muted" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-6 w-40 rounded-lg bg-muted" />
          <div className="h-4 w-72 max-w-full rounded bg-muted" />
        </div>
      </div>

      {/* 5 ô tuổi nợ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[4.5rem] rounded-lg bg-muted" />
        ))}
      </div>

      {/* Khối đối soát: đầu khối + thanh trạng thái + bảng */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-5">
        <div className="h-4 w-56 rounded bg-muted" />
        <div className="h-3 w-full max-w-prose rounded bg-muted" />
        <div className="flex gap-2 overflow-hidden pt-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 w-32 shrink-0 rounded-lg bg-muted" />
          ))}
        </div>
        <div className="space-y-2 pt-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-11 rounded bg-muted" />
          ))}
        </div>
      </div>
    </div>
  );
}
