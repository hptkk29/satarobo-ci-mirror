"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gavel } from "lucide-react";
import { gradeAttempt } from "../_actions";

export function GradeButton({
  attemptId,
  disabled,
}: {
  attemptId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (disabled) return;
    setError(null);
    startTransition(async () => {
      const res = await gradeAttempt(attemptId);
      if (!res.ok) {
        setError(res.error);
        alert(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending || disabled}
        className="inline-flex items-center gap-1 rounded-md border border-primary bg-card px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft disabled:opacity-40"
      >
        <Gavel className="h-3.5 w-3.5" />
        {pending ? "Đang chấm..." : "Auto-chấm"}
      </button>
      {error && (
        <span className="ml-2 text-xs text-state-danger-ink" title={error}>
          (lỗi)
        </span>
      )}
    </>
  );
}
