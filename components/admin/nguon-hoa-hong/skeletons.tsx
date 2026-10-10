// components/admin/nguon-hoa-hong/skeletons.tsx — hình dạng của màn khi dữ liệu chưa về (`loading.tsx` từng route).
//
// Skeleton phải mang ĐÚNG hình nội dung thật (bảng ra bảng, hàng dòng 44px) — không phải spinner giữa màn
// (DESIGN.md §5). `role="status"` + `aria-busy` + `aria-label` (nhãn trên <div> trơ không có role bị trình đọc bỏ qua): nghe "đang tải", không đọc vanh vách ô rỗng.
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const BUSY = { "aria-busy": true, "aria-label": "Đang tải…" } as const;

export function BangSkeleton({ cot, dong = 8 }: { cot: number; dong?: number }) {
  return (
    <div {...BUSY} role="status" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex gap-6 border-b border-border bg-muted/40 px-5 py-3">
        {Array.from({ length: cot }, (_, i) => (
          <Skeleton key={i} className="h-3 w-20" />
        ))}
      </div>
      {Array.from({ length: dong }, (_, r) => (
        <div key={r} className="flex h-11 items-center gap-6 border-b border-border/60 px-5 last:border-0">
          {Array.from({ length: cot }, (_, c) => (
            <Skeleton key={c} className={cn("h-4", c === 0 ? "w-40" : "w-20")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Khung chung: PageHeader + hàng tab + ScopeBar (+ công tắc) đứng yên, chỉ phần thân nhấp nháy. */
export function KhungSkeleton({
  nhan,
  cot,
  dong,
  congTac = true,
}: {
  nhan: string;
  cot: number;
  dong?: number;
  congTac?: boolean;
}) {
  return (
    <div className="max-w-6xl" role="status" aria-busy aria-label={`Đang tải ${nhan}…`}>
      <div className="mb-5 sm:mb-6">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="mb-4 flex gap-1 border-b border-border">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-28" />
        ))}
      </div>
      <Skeleton className="mb-4 h-14 w-full rounded-xl" />
      {congTac && <Skeleton className="mb-4 h-8 w-48 rounded-lg" />}
      <BangSkeleton cot={cot} dong={dong} />
    </div>
  );
}

/** Trình soạn chính sách: PageHeader + hàng tab + thanh bước + (khối form | cột điều kiện). */
export function TrinhSoanSkeleton() {
  return (
    <div className="max-w-6xl" role="status" aria-busy aria-label="Đang tải trình soạn chính sách…">
      <div className="mb-5 sm:mb-6">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="mb-4 flex gap-1 border-b border-border">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-28" />
        ))}
      </div>
      <div className="mb-5 flex gap-1">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-28 rounded-lg" />
        ))}
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** Chi tiết chính sách: PageHeader + hàng tab + (danh sách phiên bản | chi tiết). */
export function ChiTietSkeleton() {
  return (
    <div className="max-w-6xl" role="status" aria-busy aria-label="Đang tải chi tiết chính sách…">
      <div className="mb-5 sm:mb-6">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="mb-4 flex gap-1 border-b border-border">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-28" />
        ))}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="grid gap-1.5">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
        <div className="grid gap-3">
          <Skeleton className="h-6 w-48" />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
          <Skeleton className="mt-4 h-40 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
