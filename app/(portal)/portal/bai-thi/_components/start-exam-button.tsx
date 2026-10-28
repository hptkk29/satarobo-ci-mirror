"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { startAttempt } from "../actions";

export function StartExamButton({
  examId,
  resume,
  label,
}: {
  examId: string;
  resume: boolean;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function go() {
    startTransition(async () => {
      const res = await startAttempt(examId);
      if (res.ok) {
        router.push(`/portal/bai-thi/${examId}`);
      } else {
        toast.error(res.error ?? "Không vào được bài thi");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={go}
      disabled={pending}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60 ${
        resume
          ? // Bậc 700 chứ không phải 500: nút mang chữ TRẮNG, mà amber-500 chỉ cho
            // 2,15:1 và orange-500 cho 2,89:1 — cả hai trượt AA.
            "bg-amber-700 hover:bg-amber-800"
          : "bg-orange-700 hover:bg-orange-800"
      }`}
    >
      {pending ? "Đang mở…" : (label ?? (resume ? "Tiếp tục làm" : "Vào làm"))}
    </button>
  );
}
