"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteClassGroupAction } from "../_actions";

/** Nút xoá nhóm lớp với xác nhận 2-click (click 1 = chuyển sang "Xác nhận"). */
export function DeleteGroupButton({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    startTransition(async () => {
      const res = await deleteClassGroupAction(id);
      if (res.ok) {
        toast.success("Đã xoá nhóm lớp");
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi xoá nhóm lớp");
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
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold disabled:opacity-50 ${ confirming ? "border-state-danger bg-state-danger text-white" : "border-state-danger text-state-danger-ink hover:bg-state-danger-soft" }`}
    >
      <Trash2 size={12} /> {confirming ? "Xác nhận" : "Xoá"}
    </button>
  );
}
