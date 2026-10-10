"use client";

// components/cham-cong/nut-thu-hoi-don.tsx — nút "Thu hồi" một đơn CÒN CHỜ DUYỆT (đợt 1 đơn từ,
// chủ dự án chốt Q-2 08/10/2026: CHỈ người nộp thu hồi được).
//
// Dùng chung cho "Đơn của tôi" ở site admin (`my-requests.tsx`) và site GV (`don-tu-client.tsx`) —
// thư mục dùng chung ⇒ chỉ token `:root`, không import `components/admin/**`.
//
// Bấm HAI lần (mẫu xác nhận của repo, `.claude/rules/admin-site.md`): thu hồi không hoàn tác được
// — muốn xin lại thì nộp đơn mới. Server (`withdrawRequestAction`) tự kiểm "đúng người nộp + còn
// chờ", nút này chỉ là lời mời.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { withdrawRequestAction } from "@/lib/cham-cong/request-actions";

const NUT =
  "inline-flex h-8 items-center rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-60";

export function NutThuHoiDon({ id, className }: { id: string; className?: string }) {
  const router = useRouter();
  const [xacNhan, setXacNhan] = useState(false);
  const [pending, start] = useTransition();

  const thuHoi = () =>
    start(async () => {
      const r = await withdrawRequestAction({ id });
      if (r.ok) {
        toast.success("Đã thu hồi đơn");
        router.refresh();
      } else {
        toast.error(r.error);
        setXacNhan(false);
      }
    });

  if (!xacNhan) {
    return (
      <button
        type="button"
        onClick={() => setXacNhan(true)}
        className={cn(NUT, "block border-border bg-card text-muted-foreground hover:bg-muted", className)}
      >
        Thu hồi
      </button>
    );
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <button
        type="button"
        onClick={thuHoi}
        disabled={pending}
        className={cn(NUT, "border-state-danger bg-state-danger-soft text-state-danger-ink")}
      >
        {pending ? "Đang thu hồi…" : "Chắc chắn thu hồi"}
      </button>
      <button
        type="button"
        onClick={() => setXacNhan(false)}
        disabled={pending}
        className={cn(NUT, "border-border bg-card text-muted-foreground hover:bg-muted")}
      >
        Không
      </button>
    </div>
  );
}
