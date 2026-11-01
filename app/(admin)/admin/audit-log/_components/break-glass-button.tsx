"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { revealAuditPii } from "../_actions";

const MIN_REASON = 10;

export function BreakGlassButton({
  revealed,
  onRevealed,
  onHide,
}: {
  revealed: boolean;
  onRevealed: () => void;
  onHide: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  // Đang ở chế độ xem đầy đủ → nút "Ẩn lại" (che PII trở lại).
  if (revealed) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onHide}
        className="border-state-warning text-state-warning-ink hover:bg-state-warning-soft"
      >
        <EyeOff className="h-4 w-4" />
        Ẩn PII lại
      </Button>
    );
  }

  function submit() {
    if (reason.trim().length < MIN_REASON) {
      toast.error(`Vui lòng nhập lý do tối thiểu ${MIN_REASON} ký tự`);
      return;
    }
    startTransition(async () => {
      const result = await revealAuditPii({ reason: reason.trim() });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Đã mở xem đầy đủ. Hành động này đã được ghi log.");
      setOpen(false);
      setReason("");
      onRevealed();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="border-state-warning text-state-warning-ink hover:bg-state-warning-soft"
      >
        <Eye className="h-4 w-4" />
        Xem đầy đủ
      </Button>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-state-warning-ink" />
              Xem đầy đủ thông tin nhạy cảm
            </DialogTitle>
            <DialogDescription>
              PII (SĐT/email) đang được che mặc định. Mở xem đầy đủ là hành động
              có kiểm soát — bắt buộc nhập lý do và sẽ được ghi log riêng (ai,
              lúc nào, lý do gì).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="break-glass-reason" className="text-xs">
              Lý do (tối thiểu {MIN_REASON} ký tự)
            </Label>
            <Textarea
              id="break-glass-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: đối soát khiếu nại phụ huynh về thay đổi SĐT ngày 05/07..."
              rows={3}
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">{reason.trim().length}/{MIN_REASON}</p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Huỷ
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={pending || reason.trim().length < MIN_REASON}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Xác nhận xem đầy đủ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
