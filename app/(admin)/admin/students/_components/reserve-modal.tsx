"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { reserveStudentAction } from "../_actions";

const ALL_ENROLLMENTS = "ALL";

export function ReserveModal({
  studentId,
  studentName,
  enrollments,
  onClose,
}: {
  studentId: string;
  studentName: string;
  enrollments: Array<{ id: string; status: string; class: { name: string } }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [enrollmentId, setEnrollmentId] = useState<string>(ALL_ENROLLMENTS);
  const [reason, setReason] = useState("");
  const [expectedEndAt, setExpectedEndAt] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      toast.error("Vui lòng nhập lý do");
      return;
    }
    startTransition(async () => {
      const result = await reserveStudentAction({
        studentId,
        enrollmentId: enrollmentId === ALL_ENROLLMENTS ? null : enrollmentId,
        reason,
        expectedEndAt: expectedEndAt || null,
      });
      if (result.ok) {
        // F2 — phần TIỀN (dời hạn đợt thu) chạy sau khi bảo lưu commit và có thể hỏng
        // riêng. Hỏng thì PHẢI nói ra: "đã bảo lưu" mà im về việc hạn chưa dời là để
        // người bấm tin rằng không còn việc gì (luật 12 — affordance phải nói thật).
        if (result.canhBaoTien) toast.warning(result.canhBaoTien);
        else toast.success("Đã bảo lưu học viên");
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
          <DialogTitle>Bảo lưu — {studentName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Lớp bảo lưu</Label>
            <Select
              value={enrollmentId}
              onValueChange={(v) => setEnrollmentId(v ?? ALL_ENROLLMENTS)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ENROLLMENTS}>
                  Tất cả lớp đang học
                </SelectItem>
                {enrollments.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.class.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Lý do *</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="VD: Bệnh, gia đình bận, du lịch..."
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Dự kiến trở lại (tuỳ chọn)</Label>
            <Input
              type="date"
              value={expectedEndAt}
              onChange={(e) => setExpectedEndAt(e.target.value)}
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
              {isPending ? "Đang xử lý..." : "Bảo lưu"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
