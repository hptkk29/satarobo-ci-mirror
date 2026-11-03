// app/(teacher)/teacher/lich/_components/session-actions.tsx — #06 (L6): 2 nút thao tác
// trên card buổi ở trang Lịch dạy. shadcn THUẦN (Dialog/Button/Textarea) — KHÔNG Magic/Motion.
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { completeSessionAction, requestLessonChangeAction } from "../_actions";

type Props = {
  sessionId: string;
  status: string;
  hasLesson: boolean;
  lifecycleV2: boolean;
};

/** Buổi cho phép "Hoàn tất" — khớp canCompleteSession (SCHEDULED/IN_PROGRESS). */
const COMPLETABLE = new Set(["SCHEDULED", "IN_PROGRESS"]);

export function SessionActions({
  sessionId,
  status,
  hasLesson,
  lifecycleV2,
}: Props) {
  const [pending, startTransition] = useTransition();

  const canComplete = lifecycleV2 && COMPLETABLE.has(status);

  const [completeOpen, setCompleteOpen] = useState(false);
  const [classComment, setClassComment] = useState("");
  // Cảnh báo thiếu điểm danh (needsConfirm) — hiện thì đổi nút sang "Vẫn hoàn tất".
  const [confirmWarning, setConfirmWarning] = useState<string | null>(null);

  const [changeOpen, setChangeOpen] = useState(false);
  const [content, setContent] = useState("");

  function runComplete(confirmNoAttendance: boolean) {
    startTransition(async () => {
      const res = await completeSessionAction(sessionId, {
        classComment: classComment.trim() || undefined,
        confirmNoAttendance,
      });
      if (res.needsConfirm) {
        setConfirmWarning(
          res.warning ?? "Chưa lưu điểm danh cho buổi này. Vẫn hoàn tất?",
        );
        return;
      }
      if (res.ok) {
        toast.success(
          res.warning
            ? `Đã hoàn tất buổi — ${res.warning}`
            : "Đã hoàn tất buổi.",
        );
        setCompleteOpen(false);
        setClassComment("");
        setConfirmWarning(null);
      } else {
        toast.error(res.error ?? "Không hoàn tất được buổi.");
      }
    });
  }

  function submitChange() {
    startTransition(async () => {
      const res = await requestLessonChangeAction(sessionId, content);
      if (res.ok) {
        toast.success("Đã gửi đề xuất sửa giáo án.");
        setChangeOpen(false);
        setContent("");
      } else {
        toast.error(res.error);
      }
    });
  }

  if (!canComplete && !hasLesson) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {canComplete && (
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setConfirmWarning(null);
            setCompleteOpen(true);
          }}
        >
          Hoàn tất buổi
        </Button>
      )}

      {hasLesson && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setChangeOpen(true)}
        >
          Đề xuất sửa giáo án
        </Button>
      )}

      {/* Dialog — Hoàn tất buổi */}
      <Dialog
        open={completeOpen}
        onOpenChange={(o) => {
          setCompleteOpen(o);
          if (!o) {
            setClassComment("");
            setConfirmWarning(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hoàn tất buổi dạy</DialogTitle>
            <DialogDescription>
              Nhận xét chung cho cả lớp (tuỳ chọn). Sau khi hoàn tất, buổi
              chuyển sang trạng thái “Đã dạy”.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label
              htmlFor="class-comment"
              className="text-sm font-medium text-foreground"
            >
              Nhận xét lớp (tuỳ chọn)
            </label>
            <Textarea
              id="class-comment"
              rows={4}
              maxLength={2000}
              value={classComment}
              onChange={(e) => setClassComment(e.target.value)}
              placeholder="Ví dụ: Cả lớp hoàn thành mục tiêu buổi…"
            />
            {confirmWarning && (
              <p className="rounded-md border border-state-warning-soft bg-state-warning-soft p-2 text-sm text-state-warning-ink dark:border-state-warning">
                {confirmWarning}
              </p>
            )}
          </div>

          <DialogFooter>
            {confirmWarning ? (
              <Button
                type="button"
                disabled={pending}
                onClick={() => runComplete(true)}
              >
                Vẫn hoàn tất
              </Button>
            ) : (
              <Button
                type="button"
                disabled={pending}
                onClick={() => runComplete(false)}
              >
                Xác nhận hoàn tất
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog — Đề xuất sửa giáo án */}
      <Dialog
        open={changeOpen}
        onOpenChange={(o) => {
          setChangeOpen(o);
          if (!o) setContent("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Đề xuất sửa giáo án</DialogTitle>
            <DialogDescription>
              Mô tả nội dung cần chỉnh trong bài giảng của buổi. Đề xuất được
              gửi tới bộ phận Đào tạo để duyệt.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            rows={5}
            maxLength={2000}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Nội dung đề xuất (tối thiểu 5 ký tự)…"
          />

          <DialogFooter>
            <Button
              type="button"
              disabled={pending || content.trim().length < 5}
              onClick={submitChange}
            >
              Gửi đề xuất
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
