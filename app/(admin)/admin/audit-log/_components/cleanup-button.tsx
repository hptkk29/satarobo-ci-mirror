"use client";

import { useState, useTransition } from "react";
import { Trash2, Loader2 } from "lucide-react";
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
import { cleanupOldAuditLogs } from "../_actions";

export function CleanupButton() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await cleanupOldAuditLogs();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { user, grant, lead, class: cls, student } = result.deleted;
      const total = user + grant + lead + cls + student;
      toast.success(
        `Đã xoá ${total} log cũ — User:${user}, Grant:${grant}, Lead:${lead}, Class:${cls}, Student:${student}`,
        { duration: 6000 },
      );
      setOpen(false);
      window.location.reload();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="border-state-danger text-state-danger-ink hover:bg-state-danger-soft"
      >
        <Trash2 className="h-4 w-4" />
        Xoá log &gt; 365 ngày
      </Button>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Xác nhận xoá log cũ</DialogTitle>
            <DialogDescription>
              Sẽ xoá toàn bộ audit log cũ hơn 365 ngày khỏi tất cả 5 bảng
              (User, Grant, Lead, Class, Student). Thao tác không thể hoàn
              tác.
            </DialogDescription>
          </DialogHeader>
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
              variant="destructive"
              onClick={onConfirm}
              disabled={pending}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Xoá
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
