"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Lock, Unlock } from "lucide-react";
import type { UnifiedAuditRow } from "../_types";

interface Props {
  open: boolean;
  onClose: () => void;
  row: UnifiedAuditRow | null;
  revealed: boolean;
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

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(date));
}

export function AuditLogDetailModal({ open, onClose, row, revealed }: Props) {
  if (!row) return null;

  const actionCls = ACTION_COLORS[row.action] ?? "bg-muted text-foreground";
  const hasOld = row.oldValues && Object.keys(row.oldValues).length > 0;
  const hasNew = row.newValues && Object.keys(row.newValues).length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Chi tiết audit log</DialogTitle>
          <DialogDescription>
            {formatDateTime(row.createdAt)} ·{" "}
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${actionCls}`}
            >
              {row.action}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* PII state banner */}
          <div
            className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs ${ revealed ? "border-state-warning-soft bg-state-warning-soft text-state-warning-ink" : "border-border bg-muted text-muted-foreground" }`}
          >
            {revealed ? (
              <>
                <Unlock className="h-3.5 w-3.5 shrink-0" />
                Đang xem đầy đủ — SĐT/email KHÔNG che (đã ghi log break-glass).
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5 shrink-0" />
                SĐT/email được che (dạng 09***67 / a***@x.com). Dùng &quot;Xem đầy
                đủ&quot; để mở có kiểm soát.
              </>
            )}
          </div>

          {/* Actor */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Thực hiện bởi
            </h4>
            <p className="mt-1 text-sm text-foreground">{row.actorName}</p>
          </div>

          {/* Module / entity */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Module
              </h4>
              <p className="mt-1 text-sm text-foreground">{row.module}</p>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Đối tượng
              </h4>
              <p className="mt-1 text-sm text-foreground">
                {row.entityType}
                <span className="block break-all text-xs text-muted-foreground">
                  {row.entityId}
                </span>
              </p>
            </div>
          </div>

          {/* Reason */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Lý do
            </h4>
            <p className="mt-1 text-sm italic text-foreground">
              {row.reason ?? "—"}
            </p>
          </div>

          {/* Changed fields */}
          {row.changedFields.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Trường thay đổi
              </h4>
              <div className="mt-1 flex flex-wrap gap-1">
                {row.changedFields.map((f) => (
                  <span
                    key={f}
                    className="inline-flex rounded-full bg-state-info-soft px-2 py-0.5 text-xs font-semibold text-state-info-ink"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Old values */}
          {hasOld && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Giá trị cũ
              </h4>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-muted p-3 text-xs text-foreground">
                {JSON.stringify(row.oldValues, null, 2)}
              </pre>
            </div>
          )}

          {/* New values */}
          {hasNew && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Giá trị mới
              </h4>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-state-success-soft p-3 text-xs text-foreground">
                {JSON.stringify(row.newValues, null, 2)}
              </pre>
            </div>
          )}

          {/* Metadata */}
          {(row.ip || row.userAgent) && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Metadata
              </h4>
              <div className="mt-1 space-y-0.5 text-xs italic text-muted-foreground">
                {row.ip && <div>IP: {row.ip}</div>}
                {row.userAgent && (
                  <div className="break-all">UA: {row.userAgent}</div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
