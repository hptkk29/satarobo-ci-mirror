"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Ban, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cancelClassAction } from "../../_actions";

/**
 * QA 21/07 (B4) — nút HỦY LỚP đúng nghĩa. Trước đây `cancelClassAction` (rút ghi
 * danh → WITHDREW + hủy buổi tương lai + tạo yêu cầu hoàn tiền) tồn tại nhưng
 * KHÔNG gắn vào UI nào; admin đổi trạng thái "Huỷ" qua dropdown chỉ set cờ →
 * lớp Huỷ nhưng HS vẫn "Đang học", buổi vẫn "Sắp tới". Dropdown giờ không cho
 * chọn Huỷ nữa — hủy lớp bắt buộc đi qua nút này (lý do ≥5 ký tự).
 */
export function ClassCancel({
  classId,
  className,
  status,
  liveEnrollmentCount,
  canEdit,
}: {
  classId: string;
  className: string;
  status: string;
  liveEnrollmentCount: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  if (!canEdit || status === "CANCELLED" || status === "COMPLETED") return null;

  function submit() {
    if (reason.trim().length < 5) {
      toast.error("Nhập lý do hủy lớp (≥5 ký tự)");
      return;
    }
    startTransition(async () => {
      const res = await cancelClassAction(classId, reason);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Đã hủy lớp "${className}" — ghi danh đã rút, buổi tương lai đã hủy`);
      setOpen(false);
      router.push("/classes");
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-state-danger-soft bg-state-danger-soft/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-state-danger-ink">
            <Ban className="h-4 w-4" /> Hủy lớp
          </h2>
          <p className="mt-0.5 text-xs text-state-danger-ink/80">
            Rút toàn bộ ghi danh còn học, hủy các buổi tương lai và tạo yêu cầu hoàn
            tiền cho khoản đã thu. Không thể hoàn tác.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-state-danger bg-card px-4 py-2 text-sm font-semibold text-state-danger-ink hover:bg-state-danger-soft"
        >
          Hủy lớp…
        </button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!pending) setOpen(o);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 shrink-0 text-state-danger-ink" />
              {`Hủy lớp "${className}"?`}
            </DialogTitle>
            <DialogDescription>
              Lớp có <strong>{liveEnrollmentCount} học viên còn học</strong> — tất cả
              sẽ chuyển trạng thái <strong>Đã rút</strong>, buổi học tương lai chuyển{" "}
              <strong>Huỷ</strong>, nhu cầu học bù đang mở bị huỷ, và hệ thống tạo yêu
              cầu hoàn tiền cho khoản đã thu (nếu có). Hành động không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Lý do hủy lớp <span className="text-state-danger-ink">*</span> (≥5 ký tự)
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              disabled={pending}
              placeholder="VD: không đủ sĩ số khai giảng"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-state-danger"
            />
          </label>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-state-danger-ink px-4 py-2 text-sm font-semibold text-white hover:bg-state-danger-ink-hover disabled:opacity-50"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Xác nhận hủy lớp
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
