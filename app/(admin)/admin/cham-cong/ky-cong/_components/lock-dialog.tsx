"use client";

// app/(admin)/admin/cham-cong/ky-cong/_components/lock-dialog.tsx — nghi thức chốt sổ (và mở lại).
//
// Vì sao file này tồn tại: chốt kỳ đóng băng công của cả khối và CHỈ Hội sở mở lại được — thao tác
// không hoàn tác được ở tầm người dùng. Bản cũ xác nhận bằng cách đổi nhãn nút tại chỗ ("Chốt kỳ" →
// "Xác nhận chốt kỳ 2026-09") và KHÔNG có nút Huỷ: bấm nhầm hai lần liền là mất buổi chiều đi xin
// Hội sở. Ở đây là một hộp thoại nêu HỆ QUẢ BẰNG SỐ (bao nhiêu người, bao nhiêu công, bao nhiêu
// ngày còn cờ), cảnh báo riêng cho ngày CHƯA TÍNH (chốt luôn là chốt ở 0 công), ô lý do, và Huỷ.
//
// Dễ vỡ:
// - Chữ ký 4 action là hợp đồng — `lockPeriodAction({ centerId, ky, reason? })`,
//   `reopenPeriodAction({ centerId, ky, reason })` (lý do 5–300, server chặn lại lần nữa).
// - Server mới là nơi quyết định: nút này disabled khi kỳ chưa hết tháng cho đỡ bấm oan, nhưng
//   `lockPeriod` vẫn tự từ chối kỳ tương lai.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, TriangleAlert, Unlock } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";
import { lockPeriodAction, reopenPeriodAction } from "../_actions";

type Res = { ok: true; note?: string } | { ok: false; error: string };

function so(n: number): string {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

export function LockDialog({
  centerId,
  ky,
  kyLabel,
  blockLabel,
  people,
  units,
  flaggedDays,
  notComputedDays,
  periodEnded,
  periodEndLabel,
}: {
  centerId: string;
  ky: string;
  /** "09/2026" — dùng trong tiêu đề và nhãn nút, để người đọc không phải dịch "2026-09". */
  kyLabel: string;
  blockLabel: string;
  people: number;
  units: number;
  flaggedDays: number;
  /** Ngày đã qua, có ca, nhưng máy chưa tính — chốt luôn là chốt ở 0 công. */
  notComputedDays: number;
  periodEnded: boolean;
  /** "30/09/2026" — chỉ để nói vì sao nút đang khoá. */
  periodEndLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const r: Res = await lockPeriodAction({ centerId, ky, reason: reason.trim() || undefined });
      if (r.ok) {
        toast.success(r.note ?? "Đã chốt kỳ");
        setOpen(false);
        setReason("");
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });

  if (!periodEnded) {
    return (
      <span className="inline-flex items-center gap-1">
        <button type="button" className={BTN_PRIMARY} disabled aria-disabled>
          <Lock className="h-4 w-4" aria-hidden /> Chốt kỳ
        </button>
        <HelpHint label="Vì sao chưa chốt được">
          Kỳ {kyLabel} chưa kết thúc — chỉ chốt được sau {periodEndLabel}.
        </HelpHint>
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<button type="button" className={BTN_PRIMARY} />}>
        <Lock className="h-4 w-4" aria-hidden /> Chốt kỳ
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Chốt kỳ {kyLabel} — {blockLabel}
          </DialogTitle>
          <DialogDescription>Chốt xong, số công của kỳ này không đổi được từ màn nào nữa.</DialogDescription>
        </DialogHeader>

        <ul className="space-y-1 text-sm">
          <li>
            Đóng băng công của <b className="tabular-nums">{so(people)} người</b> ·{" "}
            <b className="tabular-nums">{so(units)} công</b>.
          </li>
          <li>
            <b className="tabular-nums">{so(flaggedDays)} ngày còn cờ</b> sẽ giữ nguyên số hiện tại.
          </li>
          {notComputedDays > 0 && (
            <li className="flex items-start gap-1.5 text-state-warning-ink">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                <b className="tabular-nums">{so(notComputedDays)} ngày chưa tính</b> sẽ chốt ở 0 công — nên bấm
                “Tính lại” trước.
              </span>
            </li>
          )}
          <li className="text-muted-foreground">
            Mở lại cần quyền <code className="font-mono text-xs">hr_attendance:close-period</code> tại Hội sở.
          </li>
        </ul>

        <div>
          <label htmlFor="lock-reason" className="mb-1 block text-sm font-semibold text-foreground">
            Lý do (tuỳ chọn)
          </label>
          <input
            id="lock-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            placeholder="vd: chốt sổ lương tháng 09"
            className={cn(FIELD, "w-full")}
          />
        </div>

        <DialogFooter>
          <DialogClose render={<button type="button" className={BTN_OUTLINE} />}>Huỷ</DialogClose>
          <button type="button" className={BTN_PRIMARY} disabled={pending} onClick={submit}>
            <Lock className="h-4 w-4" aria-hidden /> Chốt kỳ {kyLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReopenDialog({
  centerId,
  ky,
  kyLabel,
  blockLabel,
}: {
  centerId: string;
  ky: string;
  kyLabel: string;
  blockLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const tooShort = reason.trim().length < 5;

  const submit = () =>
    start(async () => {
      const r: Res = await reopenPeriodAction({ centerId, ky, reason: reason.trim() });
      if (r.ok) {
        toast.success(r.note ?? "Đã mở lại kỳ");
        setOpen(false);
        setReason("");
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<button type="button" className={BTN_OUTLINE} />}>
        <Unlock className="h-4 w-4" aria-hidden /> Mở lại kỳ
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Mở lại kỳ {kyLabel} — {blockLabel}
          </DialogTitle>
          <DialogDescription>
            Số đã chốt vẫn nằm trong nhật ký; chốt lại sau đó sẽ ghi một bản mới. Lý do đi vào nhật ký kiểm toán.
          </DialogDescription>
        </DialogHeader>

        <div>
          <label htmlFor="reopen-reason" className="mb-1 block text-sm font-semibold text-foreground">
            Lý do mở lại <span className="text-state-danger-ink">*</span>
          </label>
          <input
            id="reopen-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            maxLength={300}
            aria-invalid={reason.length > 0 && tooShort}
            placeholder="vd: sót đơn chỉnh công của Trần B ngày 12/09"
            className={cn(FIELD, "w-full")}
          />
          <p className="mt-1 text-xs text-muted-foreground">Tối thiểu 5 ký tự, tối đa 300.</p>
        </div>

        <DialogFooter>
          <DialogClose render={<button type="button" className={BTN_OUTLINE} />}>Huỷ</DialogClose>
          <button type="button" className={BTN_PRIMARY} disabled={pending || tooShort} onClick={submit}>
            <Unlock className="h-4 w-4" aria-hidden /> Mở lại kỳ {kyLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
