"use client";

import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuditLogDetailModal } from "./audit-log-detail-modal";
import type { UnifiedAuditRow } from "../_types";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

interface Props {
  items: UnifiedAuditRow[];
  isPending: boolean;
  hasMore: boolean;
  revealed: boolean;
  onLoadMore: () => void;
}

const ACTION_COLORS: Record<string, string> = {
  CREATE: "bg-state-success-soft text-state-success-ink",
  ADD: "bg-state-success-soft text-state-success-ink",
  ENABLE: "bg-state-success-soft text-state-success-ink",
  UPDATE: "bg-state-info-soft text-state-info-ink",
  STATUS_CHANGE: "bg-state-info-soft text-state-info-ink",
  ASSIGN: "bg-state-info-soft text-state-info-ink",
  DELETE: "bg-state-danger-soft text-state-danger-ink",
  REMOVE: "bg-state-danger-soft text-state-danger-ink",
  DISABLE: "bg-state-danger-soft text-state-danger-ink",
  EXPORT: "bg-primary-soft text-primary",
  PASSWORD_RESET: "bg-primary-soft text-primary",
  ROLE_CHANGE: "bg-primary-soft text-primary",
  "audit.pii-unmasked": "bg-state-warning-soft text-state-warning-ink",
};

// Nhãn hành động (mã tự do — dịch mã phổ biến, còn lại giữ nguyên để không mất thông tin).
const ACTION_LABEL: Record<string, string> = {
  CREATE: "Tạo mới",
  ADD: "Thêm",
  ENABLE: "Bật",
  UPDATE: "Cập nhật",
  STATUS_CHANGE: "Đổi trạng thái",
  ASSIGN: "Phân công",
  DELETE: "Xoá",
  REMOVE: "Gỡ",
  DISABLE: "Vô hiệu",
  EXPORT: "Xuất dữ liệu",
  PASSWORD_RESET: "Đặt lại mật khẩu",
  ROLE_CHANGE: "Đổi vai trò",
  INSTALLMENT_APPROVED: "Duyệt đợt thanh toán",
  "audit.pii-unmasked": "Mở xem PII",
};

function ActionBadge({ action }: { action: string }) {
  const cls = ACTION_COLORS[action] ?? "bg-muted text-foreground";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}
    >
      {ACTION_LABEL[action] ?? action}
    </span>
  );
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function AuditLogTable({
  items,
  isPending,
  hasMore,
  revealed,
  onLoadMore,
}: Props) {
  const [selected, setSelected] = useState<UnifiedAuditRow | null>(null);

  if (!isPending && items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/50 p-12 text-center">
        <p className="text-sm text-muted-foreground">Không có dữ liệu</p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <PhanTrangBang cuonNgang>
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Thời gian
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hành động
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Module / Đối tượng
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Thực hiện bởi
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Chi tiết
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((row) => (
                <tr key={row.id} className="hover:bg-muted/60">
                  <td className="px-4 py-3 text-xs tabular-nums text-foreground">
                    {formatTime(row.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <ActionBadge action={row.action} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm">
                      <div className="font-medium text-foreground">
                        {row.module}
                        <span className="text-muted-foreground"> · </span>
                        <span className="text-muted-foreground">{row.entityType}</span>
                      </div>
                      <div className="max-w-[220px] truncate text-xs text-muted-foreground">
                        {row.entityId}
                      </div>
                      {row.changedFields.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {row.changedFields.slice(0, 4).map((f) => (
                            <span
                              key={f}
                              className="inline-flex rounded bg-state-info-soft px-1.5 py-0.5 text-[10px] font-medium text-state-info-ink"
                            >
                              {f}
                            </span>
                          ))}
                          {row.changedFields.length > 4 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{row.changedFields.length - 4}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground">
                    {row.actorName}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setSelected(row)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Xem
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PhanTrangBang>

        {(hasMore || isPending) && (
          <div className="flex justify-center border-t border-border p-3">
            {isPending ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Đang tải...
              </div>
            ) : hasMore ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onLoadMore}
                disabled={isPending}
              >
                Tải thêm
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <AuditLogDetailModal
        open={!!selected}
        onClose={() => setSelected(null)}
        row={selected}
        revealed={revealed}
      />
    </>
  );
}
