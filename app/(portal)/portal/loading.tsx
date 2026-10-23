/**
 * Loading skeleton chung cho mọi trang portal phụ huynh (route group force-dynamic
 * await trực tiếp DB) — tránh màn trắng khi điều hướng chậm.
 */
export default function PortalLoading() {
  return (
    <div
      className="mx-auto w-full max-w-6xl animate-pulse space-y-6"
      aria-busy="true"
      aria-label="Đang tải..."
    >
      <div className="h-8 w-48 rounded-lg bg-neutral-200" />
      <div className="h-28 rounded-2xl bg-neutral-200" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="h-20 rounded-2xl bg-neutral-200" />
        <div className="h-20 rounded-2xl bg-neutral-200" />
        <div className="h-20 rounded-2xl bg-neutral-200" />
      </div>
      <div className="h-64 rounded-2xl bg-neutral-200" />
    </div>
  );
}
