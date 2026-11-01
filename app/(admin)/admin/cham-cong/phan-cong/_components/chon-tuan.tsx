// Chọn tuần — link thuần (chạy trước khi JS tải), đặt ở khe phải của ScopeBar.
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const NUT =
  "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11 pointer-coarse:w-11";

export function ChonTuan({ nhan, truoc, sau, tuanNay }: { nhan: string; truoc: string; sau: string; tuanNay: string | null }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Link href={truoc} aria-label="Tuần trước" className={NUT}>
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </Link>
      <span className="min-w-[8.5rem] whitespace-nowrap text-center text-sm font-semibold tabular-nums text-foreground">
        Tuần {nhan}
      </span>
      <Link href={sau} aria-label="Tuần sau" className={NUT}>
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>
      {tuanNay && (
        <Link href={tuanNay} className={cn("ml-1 whitespace-nowrap px-2 text-xs font-medium text-primary hover:underline")}>
          Tuần này
        </Link>
      )}
    </div>
  );
}
