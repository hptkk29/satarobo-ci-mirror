"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteEnrollmentAction } from "../_actions";

/** Nút xoá đăng ký với xác nhận 2-click (click 1 = chuyển sang "Xác nhận"). */
export function DeleteEnrollmentButton({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    startTransition(async () => {
      const res = await deleteEnrollmentAction(id);
      if (res.ok) {
        toast.success("Đã xoá đăng ký");
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi xoá đăng ký");
        setConfirming(false);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onBlur={() => setConfirming(false)}
      disabled={isPending}
      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${ confirming ? "border-state-danger bg-state-danger text-white" : "border-state-danger text-state-danger-ink hover:bg-state-danger-soft" }`}
    >
      <Trash2 className="h-3.5 w-3.5" /> {confirming ? "Xác nhận" : "Xoá"}
    </button>
  );
}
