"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import { Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { AuditLogFilters } from "./audit-log-filters";
import { AuditLogTable } from "./audit-log-table";
import { ExportButton } from "./export-button";
import { CleanupButton } from "./cleanup-button";
import { BreakGlassButton } from "./break-glass-button";
import { queryAuditLogs } from "../_actions";
import type { AuditFilters, UnifiedAuditRow } from "../_types";

type Actor = { id: string; name: string | null; email: string | null };

export function AuditLogClient({
  actors,
  canViewPii,
  canCleanup,
  xuatDuoc,
}: {
  actors: Actor[];
  canViewPii: boolean;
  canCleanup: boolean;
  /**
   * Cờ "được TẢI VỀ" — phân quyền ở Cấu hình vận hành → Quyền xuất dữ liệu.
   * Khác quyền XEM: người xem được trang vẫn thấy số trên màn, chỉ không lấy được tệp.
   */
  xuatDuoc: boolean;
}) {
  const [filters, setFilters] = useState<AuditFilters>({});
  const [items, setItems] = useState<UnifiedAuditRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [isPending, startTransition] = useTransition();

  const loadPage = useCallback(
    (resetCursor: boolean, cursorOverride?: string | null) => {
      const useCursor = resetCursor ? null : (cursorOverride ?? cursor);
      startTransition(async () => {
        try {
          const result = await queryAuditLogs(filters, useCursor, revealed);
          if (resetCursor) {
            setItems(result.items);
          } else {
            setItems((prev) => [...prev, ...result.items]);
          }
          setCursor(result.nextCursor);
          setHasMore(!!result.nextCursor);
        } catch {
          toast.error("Lỗi tải audit log");
        }
      });
    },
    [filters, cursor, revealed],
  );

  // Reload khi đổi filter hoặc bật/tắt chế độ xem đầy đủ (revealed).
  useEffect(() => {
    setCursor(null);
    setItems([]);
    setHasMore(false);
    loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, revealed]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${ revealed ? "bg-state-warning-soft text-state-warning-ink" : "bg-muted text-muted-foreground" }`}
        >
          {revealed ? (
            <>
              <Unlock className="h-3.5 w-3.5" />
              Đang xem đầy đủ — PII không che (đã ghi log)
            </>
          ) : (
            <>
              <Lock className="h-3.5 w-3.5" />
              PII (SĐT/email) được che mặc định
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {canViewPii && (
            <BreakGlassButton
              revealed={revealed}
              onRevealed={() => setRevealed(true)}
              onHide={() => setRevealed(false)}
            />
          )}
          {xuatDuoc && <ExportButton filters={filters} />}
          {canCleanup && <CleanupButton />}
        </div>
      </div>

      <AuditLogFilters filters={filters} actors={actors} onApply={setFilters} />

      <AuditLogTable
        items={items}
        isPending={isPending}
        hasMore={hasMore}
        revealed={revealed}
        onLoadMore={() => loadPage(false)}
      />
    </div>
  );
}
