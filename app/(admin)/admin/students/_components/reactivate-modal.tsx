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
import { reactivateStudentAction } from "../_actions";

export function ReactivateModal({
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
  const [note, setNote] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await reactivateStudentAction({
        studentId,
        note: note || null,
      });
      if (result.ok) {
        // 21/08 — cho nghỉ học đã gỡ em khỏi MỌI lớp; kích hoạt lại chỉ đổi trạng thái hồ
        // sơ. Không nói ra thì em thành "đang học mà không lớp nào", biến mất khỏi mọi
        // roster cho tới khi có người nhớ tạo ghi danh mới.
        if (result.liveClassCount === 0) {
          toast.warning(
            `Đã kích hoạt lại ${studentName} — em CHƯA có lớp nào. Vào Đăng ký học để tạo ghi danh mới, hoặc xếp lớp từ trang Học sinh của lớp.`,
            { duration: 8000 },
          );
        } else {
          toast.success("Đã kích hoạt lại học viên");
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
          <DialogTitle className="text-state-success-ink">
            Kích hoạt lại — {studentName}
          </DialogTitle>
          <DialogDescription>
            Học viên chuyển về trạng thái <b>Đang học</b>. <b>KHÔNG</b> tự phục hồi ghi
            danh cũ (lớp cũ có thể đã đầy hoặc đã kết thúc, và ghi danh cũ đã chốt sổ) —
            sau bước này phải <b>tạo ghi danh mới</b> ở màn Đăng ký học, hoặc xếp em vào
            lớp từ trang Học sinh của lớp. Trước khi có ghi danh mới, em nằm ở tab{" "}
            <b>Chờ xếp lớp</b>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Ghi chú (tuỳ chọn)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Lý do quay lại..."
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
              {isPending ? "Đang xử lý..." : "Kích hoạt"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
