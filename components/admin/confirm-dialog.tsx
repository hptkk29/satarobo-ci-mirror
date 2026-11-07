"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Hộp thoại xác nhận dùng chung cho hành động phá huỷ dữ liệu trong admin.
 * Thay cho window.confirm (block renderer, không nêu được hậu quả) và pattern
 * 2-click tự reset (QA 20/07 — Vấn đề 3 / Lỗi B). Controlled: caller giữ state
 * `open` + gọi action trong `onConfirm`, set `pending` khi đang chạy.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Xoá",
  tone = "danger",
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  /** "danger" (mặc định, đỏ — xoá/hủy) hoặc "primary" (tím — hành động tích cực cần xác nhận, vd Publish). */
  tone?: "danger" | "primary";
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!pending) onOpenChange(o);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle
              className={`h-5 w-5 shrink-0 ${tone === "danger" ? "text-state-danger-ink" : "text-primary"}`}
            />
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${ tone === "danger" ? "bg-state-danger-ink hover:bg-state-danger-ink" : "bg-primary hover:opacity-90" }`}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
