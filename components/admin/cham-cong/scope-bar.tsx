// components/admin/cham-cong/scope-bar.tsx — "tôi đang xem KHỐI nào, KỲ nào, kỳ đó còn sửa được không".
//
// Vì sao file này tồn tại: ba câu hỏi trên quyết định mọi thao tác phía dưới, nhưng trước đây mỗi
// màn trả lời một kiểu — có màn để `<select>` cơ sở, có màn để nút ‹ ›, có màn không nói gì về kỳ.
// Một thanh duy nhất, đứng ngay dưới ModuleNav ở mọi màn có phạm vi.
//
// Chip khối phải dựng từ `scope.blocksWith(action CỦA MÀN)` — không phải từ `scope.blocks`. Bày
// khối người ta không có quyền là mời họ bấm vào một màn rỗng.
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { hrefWith } from "@/lib/cham-cong/scope-href";
import type { PeriodStatus } from "@/lib/cham-cong/module-scope";
import { CHIP, CHIP_ACTIVE, CHIP_IDLE } from "./classes";
import { PeriodStatusPill } from "./period-status-pill";

/** "2026-09" → "Tháng 09/2026". Kỳ sai định dạng ⇒ in nguyên (không đoán hộ). */
function kyLabel(ky: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ky.trim());
  return m ? `Tháng ${m[2]}/${m[1]}` : ky;
}

export function ScopeBar({
  basePath,
  blocks,
  coSo,
  allLabel,
  month,
  period,
  keep,
  paramName = "coSo",
  right,
}: {
  basePath: string;
  blocks: { id: string; label: string }[];
  coSo: string | null;
  /** Có chip "Tất cả" (bỏ tham số khối) — chỉ vài màn dùng: /don-tu, khung-ca, ghi-chu. */
  allLabel?: string;
  month?: { ky: string; prevHref: string; nextHref: string };
  period?: { status: PeriodStatus | null; standardUnits: number | null; href: string };
  /** Tham số khác của màn phải sống sót khi đổi khối (`loc`, `q`, `status`, `date`…). */
  keep?: Record<string, string>;
  /** Kiosk dùng `?centerId=`, phần còn lại dùng `?coSo=`. */
  paramName?: "coSo" | "centerId";
  right?: React.ReactNode;
}) {
  const chipHref = (id: string | null) => hrefWith(basePath, { ...keep, [paramName]: id });

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
      {allLabel && (
        <Link
          href={chipHref(null)}
          aria-current={coSo ? undefined : "page"}
          className={cn(CHIP, coSo ? CHIP_IDLE : CHIP_ACTIVE)}
        >
          {allLabel}
        </Link>
      )}
      {blocks.map((b) => {
        const active = b.id === coSo;
        return (
          <Link
            key={b.id}
            href={chipHref(b.id)}
            aria-current={active ? "page" : undefined}
            className={cn(CHIP, active ? CHIP_ACTIVE : CHIP_IDLE)}
          >
            {b.label}
          </Link>
        );
      })}

      {month && (
        <div className="flex items-center gap-1">
          <Link
            href={month.prevHref}
            aria-label="Tháng trước"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-muted"
          >
            <ChevronLeft aria-hidden className="h-4 w-4" />
          </Link>
          <span className="min-w-[9rem] text-center text-sm font-semibold tabular-nums">
            {kyLabel(month.ky)}
          </span>
          <Link
            href={month.nextHref}
            aria-label="Tháng sau"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-muted"
          >
            <ChevronRight aria-hidden className="h-4 w-4" />
          </Link>
        </div>
      )}

      {(period || right) && (
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {period && (
            <>
              <PeriodStatusPill status={period.status} href={period.href} />
              {period.standardUnits !== null && (
                <span className="text-xs text-muted-foreground">
                  Công chuẩn <b className="text-foreground tabular-nums">{period.standardUnits}</b>
                </span>
              )}
            </>
          )}
          {right}
        </div>
      )}
    </div>
  );
}
