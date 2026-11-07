/** Khung chờ cho `/portal/disc` và chi tiết — thay màn trắng khi đọc DB chậm. */
export default function DiscLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl animate-pulse space-y-4" aria-busy="true" aria-label="Đang tải kết quả DISC...">
      <div className="h-24 rounded-3xl bg-muted" />
      <div className="h-16 rounded-2xl bg-muted" />
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="h-56 rounded-2xl bg-muted" />
        <div className="h-56 rounded-2xl bg-muted" />
      </div>
    </div>
  );
}
