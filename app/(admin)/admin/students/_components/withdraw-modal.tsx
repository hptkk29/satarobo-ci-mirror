"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { withdrawStudentAction } from "../_actions";

export function WithdrawModal({
  studentId,
  studentName,
  onClose,
}: {
  studentId: string;
  studentName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      toast.error("Vui lòng nhập lý do");
      return;
    }
    startTransition(async () => {
      const result = await withdrawStudentAction({ studentId, reason });
      if (result.ok) {
        toast.success("Đã đánh dấu nghỉ học");
        // PHIÊN D — ghi danh đã quyết toán qua "Dừng học" KHÔNG sinh đề xuất hoàn lần hai.
        // Phải nói ra: một đề xuất hoàn vắng mặt trong im lặng đọc y hệt một lượt bỏ sót,
        // và kế toán là người phải phân biệt được hai thứ đó.
        for (const bq of result.boQuaHoanTien ?? []) {
          toast.info(`Không tạo đề xuất hoàn: ${bq.lyDo}`, { duration: 8000 });
        }
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
          <DialogTitle className="text-state-danger-ink">
            Nghỉ học hẳn — {studentName}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="flex items-start gap-2 rounded-lg border border-state-danger-soft bg-state-danger-soft p-3 text-sm text-state-danger-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Học viên chuyển sang <strong>INACTIVE</strong>, tất cả đợt bảo
              lưu sẽ kết thúc, mọi enrollment chưa hoàn thành chuyển sang{" "}
              <strong>WITHDREW</strong>. Có thể kích hoạt lại sau.
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Lý do nghỉ học *</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="VD: Chuyển trường, gia đình khó khăn..."
              required
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
            <Button
              type="submit"
              variant="destructive"
              disabled={isPending}
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? "Đang xử lý..." : "Xác nhận nghỉ học"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
