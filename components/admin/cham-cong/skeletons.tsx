// components/admin/cham-cong/skeletons.tsx — hình dạng của màn khi dữ liệu chưa về.
//
// Vì sao file này tồn tại: module chấm công chưa có `loading.tsx` nào, nên mỗi lần đổi khối/tháng
// là màn trắng rồi nhảy — người dùng tưởng bấm hụt và bấm lại. Skeleton phải mang ĐÚNG hình của
// nội dung thật (bảng ra bảng, dải ngày ra dải ngày), không phải một vòng xoay giữa màn.
//
// Tất cả đều `aria-busy` + `aria-label`: trình đọc màn hình phải nghe "đang tải", chứ không đọc
// vanh vách một mớ ô rỗng.
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const BUSY = { "aria-busy": true, "aria-label": "Đang tải…" } as const;

export function ScopeBarSkeleton({ className }: { className?: string }) {
  return <Skeleton {...BUSY} className={cn("mb-4 h-12 w-full rounded-xl", className)} />;
}

export function KpiSkeleton({ n = 4 }: { n?: number }) {
  return (
    <div {...BUSY} className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-[72px] rounded-xl" />
      ))}
    </div>
  );
}

export function DayStripSkeleton() {
  return (
    <div {...BUSY} className="mb-4 grid grid-cols-7 gap-1 sm:flex sm:flex-wrap">
      {Array.from({ length: 31 }, (_, i) => (
        <Skeleton key={i} className="h-11 w-11 rounded-lg" />
      ))}
    </div>
  );
}

export function TableSkeleton({ cols, rows = 8 }: { cols: number; rows?: number }) {
  return (
    <div {...BUSY} className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex h-11 items-center gap-4 bg-muted/40 px-5">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-11 items-center gap-4 border-b border-border/60 px-5">
          {Array.from({ length: cols }, (_, i) => (
            <Skeleton key={i} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Lưới người × ngày (phân ca, khung ca): cột tên cố định + dải ô 44px. */
export function GridSkeleton({ rows = 10, days = 20 }: { rows?: number; days?: number }) {
  return (
    <div {...BUSY} className="overflow-hidden rounded-xl border border-border bg-card p-3">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-1 py-1">
          <Skeleton className="h-8 w-40 shrink-0 rounded-md" />
          {Array.from({ length: days }, (_, i) => (
            <Skeleton key={i} className="h-8 w-12 shrink-0 rounded-md" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div {...BUSY} className="rounded-xl border border-border bg-card p-5">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="mb-4 last:mb-0">
          <Skeleton className="mb-2 h-3 w-28" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
