"use client";

// US-12 AC2 — GV/Admin gỡ tin NGƯỜI KHÁC: bắt buộc nhập lý do.
//
// ⚠️ CỐ Ý KHÔNG CHẶN Ở CLIENT: nút "Gỡ tin" luôn bấm được, kể cả khi ô lý do trống.
// Lý do bắt buộc là luật của SERVER (zod trong `lib/chat/moderation.ts` → VALIDATION +
// `field: "reason"`, TS-03.6b đòi 400). Nếu client tự chặn rồi không bao giờ gọi server,
// ta mất chốt kiểm chứng duy nhất rằng luật đó còn sống — và ngày nào đó ai gỡ zod đi
// thì không test nào đỏ. Ở đây chỉ HIỂN THỊ lỗi server trả về, gắn đúng ô nhập theo
// `error.field`.

import { useState, useTransition } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { deleteStaffMessage } from "./_actions";

export function DeleteMessageDialog({
  messageId,
  preview,
  open,
  onOpenChange,
  onDeleted,
}: {
  messageId: string | null;
  /** Trích nội dung tin sắp gỡ — để người gỡ biết chắc mình đang gỡ đúng tin. */
  preview: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: (messageId: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close(next: boolean) {
    if (pending) return;
    if (!next) {
      setReason("");
      setFieldError(null);
    }
    onOpenChange(next);
  }

  function submit() {
    if (!messageId) return;
    setFieldError(null);
    startTransition(async () => {
      // Gửi NGUYÊN VĂN những gì người dùng gõ (kể cả chuỗi rỗng) — server phán quyết.
      const res = await deleteStaffMessage({ messageId, reason });
      if (res.ok) {
        toast.success("Đã gỡ tin nhắn. Nhóm nhận được thông báo của hệ thống.");
        onDeleted(messageId);
        setReason("");
        onOpenChange(false);
        return;
      }
      if (res.error.field === "reason") {
        setFieldError(res.error.message);
        return;
      }
      toast.error(res.error.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-600" aria-hidden />
            Gỡ tin nhắn
          </DialogTitle>
          <DialogDescription>
            Tin sẽ hiển thị là &quot;Tin nhắn đã được gỡ&quot; với mọi thành viên, và nhóm
            nhận một dòng thông báo của hệ thống. Nội dung gốc vẫn được lưu để đối chất
            khi có khiếu nại.
          </DialogDescription>
        </DialogHeader>

        {preview && (
          <p className="line-clamp-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            {preview}
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="chat-delete-reason" className="text-xs">
            Lý do gỡ tin
          </Label>
          <Textarea
            id="chat-delete-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ví dụ: tin nhắn chứa số điện thoại cá nhân của phụ huynh khác"
            rows={3}
            disabled={pending}
            aria-invalid={fieldError ? true : undefined}
            className={cn(fieldError && "border-destructive")}
          />
          {fieldError && (
            <p role="alert" className="text-xs text-destructive">
              {fieldError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={pending}>
            Huỷ
          </Button>
          <Button type="button" variant="destructive" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Gỡ tin nhắn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
