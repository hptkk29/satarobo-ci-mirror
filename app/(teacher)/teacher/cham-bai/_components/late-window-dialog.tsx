"use client";

// late-window-dialog.tsx — "Mở nộp bù" trên từng dòng bài tập (chủ dự án 25/08).
//
// Quá hạn nay TỰ ĐÓNG (trạng thái suy ở lib/lms/assignment-window.ts). Đây là nút mở
// lại: chọn hạn nộp bù mới + ghi lý do. Chỉ gắn vào dòng đang "Đã đóng" hoặc "Nộp trễ"
// — bài còn trong hạn thì chưa có gì để gia hạn.
//
// ⚠️ Ô giờ là `datetime-local` = ĐỒNG HỒ TREO TƯỜNG, không có múi giờ. Server đọc chuỗi
// đó là +07:00 (`parseDateTime` trong _actions.ts), nên mọi chuỗi giờ ở đây — giá trị
// gợi ý lẫn mốc `min` — đều do SERVER dựng theo giờ VN (`buildAssignmentWindowView`).
// Tự đổi ở client là máy đặt lệch múi giờ sẽ gửi lên một mốc khác cái GV nhìn thấy.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { grantLateWindowAction, revokeLateWindowAction } from "../_actions";
import type { AssignmentWindowView } from "../_data";

export function LateWindowDialog({
  assignmentId,
  title,
  win,
}: {
  assignmentId: string;
  title: string;
  win: AssignmentWindowView;
}) {
  const [open, setOpen] = useState(false);

  if (!win.canExtend) return null;
  const dangMo = win.state === "late-open";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary-ink outline-none hover:text-primary-ink-hover focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CalendarClock className="h-4 w-4" aria-hidden />
        {dangMo ? "Sửa hạn nộp bù" : "Mở nộp bù"}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dangMo ? "Sửa hạn nộp bù" : "Mở nộp bù cho học viên"}</DialogTitle>
            <DialogDescription>
              {title} ·{" "}
              {dangMo
                ? `đang cho nộp bù đến ${win.lateUntilText}`
                : // Không có hạn gốc mà nói "đã hết hạn nộp" là sai: bài này đóng do
                  // người đóng tay, GV đi tìm cái hạn đó sẽ không thấy ở đâu.
                  win.dueText
                  ? "bài đã hết hạn nộp"
                  : "bài đang đóng"}
            </DialogDescription>
          </DialogHeader>
          {/* key: mở lại là form sạch, không giữ chữ đã gõ dở lần trước */}
          <LateWindowForm
            key={String(open)}
            assignmentId={assignmentId}
            win={win}
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function LateWindowForm({
  assignmentId,
  win,
  onDone,
}: {
  assignmentId: string;
  win: AssignmentWindowView;
  onDone: () => void;
}) {
  const router = useRouter();
  const [lateUntil, setLateUntil] = useState(win.suggestedInput);
  const [reason, setReason] = useState(win.lateReason ?? "");
  const [pending, start] = useTransition();
  const dangMo = win.state === "late-open";

  function luu() {
    if (!lateUntil) {
      toast.error("Hãy chọn hạn nộp bù");
      return;
    }
    // So chuỗi "YYYY-MM-DDTHH:mm" là so đúng thứ tự thời gian (cùng giờ VN, cùng độ dài)
    // — không cần dựng Date ở client, nơi múi giờ máy có thể lệch.
    if (lateUntil < win.minInput) {
      toast.error("Hạn nộp bù phải sau hạn nộp gốc và sau thời điểm hiện tại");
      return;
    }
    if (reason.trim().length < 5) {
      toast.error("Hãy ghi lý do gia hạn — đây là ngoại lệ, cần nói rõ vì sao");
      return;
    }
    start(async () => {
      const res = await grantLateWindowAction({ assignmentId, lateUntil, reason });
      if (res.ok) {
        toast.success(dangMo ? "Đã đổi hạn nộp bù" : "Đã mở nộp bù cho học viên");
        router.refresh();
        onDone();
      } else {
        toast.error(res.error);
      }
    });
  }

  function thuHoi() {
    start(async () => {
      const res = await revokeLateWindowAction({ assignmentId });
      if (res.ok) {
        // Bài không có hạn gốc thì server đóng bằng cột `status` — nói "đóng lại theo
        // hạn nộp gốc" cho GV là hứa một cái mốc không tồn tại.
        toast.success(
          win.dueText
            ? "Đã thu hồi — bài đóng lại theo hạn nộp gốc"
            : "Đã thu hồi — bài đóng lại ngay (bài không có hạn nộp gốc)",
        );
        router.refresh();
        onDone();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor={`late-until-${assignmentId}`}
          className="mb-1.5 block text-sm font-semibold text-foreground"
        >
          Cho nộp bù đến
        </label>
        <input
          id={`late-until-${assignmentId}`}
          type="datetime-local"
          value={lateUntil}
          min={win.minInput}
          onChange={(e) => setLateUntil(e.target.value)}
          className="w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {/* Không có hạn gốc thì không có gì để “muộn” so với — và server cũng ghi bản nộp
            là SUBMITTED chứ không phải LATE. Nói y câu kia cho cả hai ca là dạy GV sai. */}
        <p className="mt-1.5 text-xs text-muted-foreground">
          {win.dueText
            ? `Hạn nộp gốc ${win.dueText} giữ nguyên — bài nộp sau hạn gốc vẫn ghi là “nộp muộn”.`
            : "Bài không đặt hạn nộp gốc — mốc này thành hạn đóng của bài, bài nộp trong hạn không bị ghi “nộp muộn”."}
        </p>
      </div>

      <div>
        <label
          htmlFor={`late-reason-${assignmentId}`}
          className="mb-1.5 block text-sm font-semibold text-foreground"
        >
          Lý do gia hạn <span className="text-state-danger">*</span>
        </label>
        <textarea
          id={`late-reason-${assignmentId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="VD: học viên ốm, lớp nghỉ bù, bài giao sát ngày nghỉ lễ…"
          className="w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {/* Gia hạn không rút lại được là một cái bẫy: gõ nhầm tháng là bài mở toang. */}
        {dangMo && (
          <Button variant="outline" onClick={thuHoi} disabled={pending} className="mr-auto">
            <Undo2 className="h-4 w-4" aria-hidden /> Thu hồi gia hạn
          </Button>
        )}
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Huỷ
        </Button>
        <Button onClick={luu} disabled={pending}>
          {pending ? "Đang lưu…" : dangMo ? "Lưu hạn mới" : "Mở nộp bù"}
        </Button>
      </div>
    </div>
  );
}
