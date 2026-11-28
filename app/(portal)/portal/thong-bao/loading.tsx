// Skeleton khi feed thông báo đang chạy fan-out query (route force-dynamic).
export default function ThongBaoLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="h-28 animate-pulse rounded-3xl bg-muted" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[15rem_1fr]">
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
        <div className="space-y-3">
          <div className="h-20 animate-pulse rounded-2xl bg-muted" />
          <div className="h-20 animate-pulse rounded-2xl bg-muted" />
          <div className="h-20 animate-pulse rounded-2xl bg-muted" />
        </div>
      </div>
    </div>
  );
}
