// app/(admin)/admin/nguon-hoa-hong/ky/_components/chon-thang.tsx — "‹ Tháng 10/2026 ›" của tab Kỳ (06 §4.2: ScopeBar có THÁNG × cơ sở).
//
// Tháng nằm trên URL (`?thang=`), nên đổi tháng là đổi địa chỉ: F5, chia sẻ link, nút Back đều đúng. Hai mũi tên là liên kết thật; ở biên (không còn tháng để
// đi tiếp) mũi tên là `<button disabled>` chứ KHÔNG phải liên kết mờ đi — liên kết mờ vẫn bấm được và vẫn điều hướng (luật 12, cùng lý do `DieuHuongTrangLink`).
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

const NUT =
  "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

export function ChonThang({ thangNhan, hrefTruoc, hrefTiep }: { thangNhan: string; hrefTruoc: string | null; hrefTiep: string | null }) {
  return (
    <nav aria-label="Chọn tháng" className="flex items-center gap-1.5">
      {hrefTruoc ? (
        <Link href={hrefTruoc} aria-label="Tháng trước" className={NUT}>
          <ChevronLeft aria-hidden className="h-4 w-4" />
        </Link>
      ) : (
        <button type="button" disabled aria-label="Tháng trước" className={NUT}>
          <ChevronLeft aria-hidden className="h-4 w-4" />
        </button>
      )}
      <span aria-live="polite" className="min-w-28 text-center text-base font-semibold tabular-nums text-foreground">
        Tháng {thangNhan}
      </span>
      {hrefTiep ? (
        <Link href={hrefTiep} aria-label="Tháng sau" className={NUT}>
          <ChevronRight aria-hidden className="h-4 w-4" />
        </Link>
      ) : (
        <button type="button" disabled aria-label="Tháng sau" className={NUT}>
          <ChevronRight aria-hidden className="h-4 w-4" />
        </button>
      )}
    </nav>
  );
}
