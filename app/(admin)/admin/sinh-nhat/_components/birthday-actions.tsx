"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { markBirthdayCelebrated, runBirthdayScan, undoBirthdayCelebrated } from "../_actions";

export function CelebrateButton({ id, done }: { id: string; done: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await undoBirthdayCelebrated(id);
            if (r.ok) {
              toast.success("Đã bỏ đánh dấu");
              router.refresh();
            } else toast.error(r.error ?? "Lỗi");
          })
        }
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        Bỏ đánh dấu
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await markBirthdayCelebrated(id);
          if (r.ok) {
            toast.success("Đã ghi nhận chúc mừng");
            router.refresh();
          } else toast.error(r.error ?? "Lỗi");
        })
      }
      className="rounded-lg bg-state-success-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-state-success-ink-hover disabled:opacity-50"
    >
      Đã chúc
    </button>
  );
}

/**
 * Chạy tay 3 pha của cron. Cần vì Vercel Cron không chạy trên môi trường `test`
 * — không có nút này thì không nghiệm thu được luồng trước khi lên prod.
 */
export function RunScanButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await runBirthdayScan();
          if (r.ok) {
            toast.success(r.summary ?? "Đã quét xong", { duration: 8000 });
            router.refresh();
          } else toast.error(r.error ?? "Lỗi");
        })
      }
      className="rounded-lg border border-primary px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-soft disabled:opacity-50"
    >
      {pending ? "Đang quét…" : "Chạy quét sinh nhật"}
    </button>
  );
}
