"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { generateClassProgressReports } from "../../_actions";

export function GenerateReportsButton({ classId }: { classId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);

  function run() {
    startTransition(async () => {
      const res = await generateClassProgressReports(classId);
      setConfirm(false);
      if (res.ok) {
        toast.success(
          `Đã tạo ${res.created} báo cáo · gửi email ${res.emailed} phụ huynh`,
        );
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi tạo báo cáo");
      }
    });
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => (confirm ? run() : setConfirm(true))}
      onBlur={() => setConfirm(false)}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 ${ confirm ? "bg-state-success-ink" : "bg-state-success-ink hover:bg-state-success-ink" }`}
    >
      <Mail className="h-4 w-4" />
      {pending
        ? "Đang gửi…"
        : confirm
          ? "Xác nhận tạo & gửi?"
          : "Tạo & gửi báo cáo"}
    </button>
  );
}
