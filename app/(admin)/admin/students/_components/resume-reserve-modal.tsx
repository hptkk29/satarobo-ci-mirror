"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { resumeStudentReserveAction } from "../_actions";

export function ResumeReserveModal({
  reserveId,
  studentName,
  onClose,
}: {
  reserveId: string;
  studentName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [endReason, setEndReason] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await resumeStudentReserveAction({
        reserveId,
        endReason: endReason || null,
      });
      if (result.ok) {
        toast.success("Đã kết thúc bảo lưu — học viên trở lại học");
        onClose();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !isPending && !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Kết thúc bảo lưu — {studentName}</DialogTitle>
          <DialogDescription>
            Học viên sẽ chuyển về trạng thái "Đang học" và các lớp đang
            bảo lưu sẽ được resume.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Ghi chú (tuỳ chọn)</Label>
            <Textarea
              value={endReason}
              onChange={(e) => setEndReason(e.target.value)}
              rows={3}
              placeholder="Lý do trở lại sớm/muộn..."
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
            >
              Huỷ
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? "Đang xử lý..." : "Kết thúc bảo lưu"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
