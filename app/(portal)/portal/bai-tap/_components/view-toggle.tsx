"use client";

// R7-14 — chuyển giữa chế độ "Phụ huynh" (tổng quan) và "Học viên" (làm bài).
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, PencilLine } from "lucide-react";
import { setPortalViewAction } from "../actions";

export function ViewToggle({ current }: { current: "parent" | "student" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchTo(view: "parent" | "student") {
    if (view === current) return;
    startTransition(async () => {
      await setPortalViewAction(view);
      router.refresh();
    });
  }

  return (
    <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5 text-xs font-semibold">
      <button
        type="button"
        disabled={pending}
        onClick={() => switchTo("parent")}
        className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 ${
          current === "parent"
            ? "bg-purple-100 text-purple-700"
            : "text-neutral-500"
        }`}
      >
        <Eye className="h-3.5 w-3.5" /> Phụ huynh
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => switchTo("student")}
        className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 ${
          current === "student"
            ? "bg-orange-100 text-orange-700"
            : "text-neutral-500"
        }`}
      >
        <PencilLine className="h-3.5 w-3.5" /> Học viên (làm bài)
      </button>
    </div>
  );
}
