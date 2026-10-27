// hub-tab-skeleton.tsx — khung chờ cho NỘI DUNG một tab của Class Hub.
//
// Vì sao có (24/10/2026): đổi tab = đổi `?tab=` trên CÙNG một trang, nên `loading.tsx` của segment KHÔNG hiện
// (cùng segment ⇒ React giữ giao diện cũ trong transition). Hệ quả: bấm "Tài liệu học phần" rồi nhìn màn cũ
// đứng yên cho tới khi MỌI truy vấn của trang xong — đúng cảm giác "bấm mà không thấy gì xảy ra". Bọc nội dung tab
// bằng `<Suspense key={…} fallback={<HubTabSkeleton />}>` cho thanh tab + khung đổi NGAY, phần dữ liệu tới sau.
//
// Chỉ token `:root` của site GV (`bg-muted`, `.t-card`) — mobile 375px: một cột, không bề rộng cố định.
export function HubTabSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Đang tải…" role="status">
      <div className="rounded-xl border border-border bg-muted/40 p-4">
        <div className="h-3 w-28 rounded bg-muted" />
        <div className="mt-2 h-5 w-48 max-w-full rounded bg-muted" />
        <div className="mt-2 h-3 w-16 rounded bg-muted" />
      </div>
      <ul className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="t-card space-y-2 p-4">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 shrink-0 rounded-full bg-muted" />
              <div className="h-4 w-56 max-w-full rounded bg-muted" />
            </div>
            <div className="h-3 w-3/4 max-w-full rounded bg-muted" />
            <div className="h-3 w-1/2 max-w-full rounded bg-muted" />
          </li>
        ))}
      </ul>
    </div>
  );
}
