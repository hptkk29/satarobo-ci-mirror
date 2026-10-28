"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteStudent } from "../_actions";

export function DeleteStudentButton({
  studentId,
  studentName,
}: {
  studentId: string;
  studentName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function onClick() {
    // 2-click confirm
    if (!confirming) {
      setConfirming(true);
      return;
    }
    startTransition(async () => {
      const r = await deleteStudent(studentId);
      if (r.error) {
        toast.error(r.error);
        setConfirming(false);
      } else {
        toast.success(`Đã xoá học viên ${studentName}`);
        setConfirming(false);
        router.refresh();
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onBlur={() => setConfirming(false)}
      disabled={isPending}
      aria-label={
        confirming ? `Xác nhận xoá ${studentName}` : `Xoá ${studentName}`
      }
      className={
        "rounded-md border px-2.5 py-1 text-xs font-semibold disabled:opacity-50 " +
        (confirming
          ? "border-state-danger-ink bg-state-danger-ink text-white hover:bg-state-danger-ink"
          : "border-state-danger text-state-danger-ink hover:bg-state-danger-soft")
      }
    >
      {confirming ? "Xác nhận xoá?" : "Xoá"}
    </button>
  );
}
