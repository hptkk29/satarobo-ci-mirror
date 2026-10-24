import { Skeleton } from "@/components/ui/skeleton";

// Khung chờ của "Hồ sơ học viên" — ĐÚNG hình dạng trang thật (DESIGN.md §5): dải đầu,
// tờ form, cột phải. Cùng lưới + cùng bậc nở với `page.tsx` để lúc nội dung về không nhảy.

function KhungO({ n }: { n: number }) {
  return (
    <div className="grid gap-4 @lg:grid-cols-2 @4xl:grid-cols-3">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full rounded-lg sm:h-9" />
        </div>
      ))}
    </div>
  );
}

function KhungPhai({ dong }: { dong: number }) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-3">
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="space-y-3 p-4">
        {Array.from({ length: dong }, (_, i) => (
          <div key={i} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div
      aria-busy="true"
      aria-label="Đang tải hồ sơ học viên…"
      className="mx-auto w-full max-w-[1180px] space-y-5 min-[1536px]:max-w-[1440px] min-[2200px]:max-w-[2200px] min-[3200px]:max-w-[2880px]"
    >
      <Skeleton className="h-5 w-40" />

      <div className="flex items-start gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <Skeleton className="size-16 shrink-0 rounded-xl sm:size-20" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-2/3 max-w-72" />
          <Skeleton className="h-4 w-1/2 max-w-80" />
          <Skeleton className="h-9 w-full max-w-md rounded-lg" />
        </div>
      </div>

      <div className="grid items-start gap-5 min-[1280px]:grid-cols-[minmax(0,1fr)_380px] min-[2200px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_400px]">
        <div className="@container min-w-0 space-y-6 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
          <Skeleton className="h-4 w-24" />
          <KhungO n={6} />
          <Skeleton className="h-4 w-24" />
          <KhungO n={6} />
          <Skeleton className="h-4 w-24" />
          <KhungO n={3} />
        </div>
        <div className="hidden min-w-0 space-y-4 min-[2200px]:block">
          <KhungPhai dong={6} />
        </div>
        <div className="min-w-0 space-y-4">
          <KhungPhai dong={9} />
          <KhungPhai dong={3} />
        </div>
      </div>
    </div>
  );
}
