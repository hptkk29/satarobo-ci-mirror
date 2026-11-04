"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cancelParentRequest } from "../actions";

export function CancelButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Confirm-delete 2 bước (pattern dự án): bấm 1 → xác nhận, bấm 2 mới huỷ.
  // Chống chạm nhầm khi cuộn trên mobile; tự reset sau 4s nếu không bấm tiếp.
  const [confirming, setConfirming] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer khi unmount (không phải data fetching).
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  function handleClick() {
    if (!confirming) {
      setConfirming(true);
      resetTimer.current = setTimeout(() => setConfirming(false), 4000);
      return;
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    startTransition(async () => {
      const res = await cancelParentRequest(id);
      if (res.ok) {
        toast.success("Đã huỷ yêu cầu");
        router.refresh();
      } else toast.error(res.error ?? "Lỗi");
      setConfirming(false);
    });
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={handleClick}
      // py-2.5 + text-xs ≈ 36px cao — đạt vùng bấm tối thiểu trên mobile (375px).
      className={`rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
        confirming
          ? "bg-rose-600 text-white hover:bg-rose-700"
          : "text-rose-600 hover:bg-rose-50"
      }`}
    >
      {pending ? "Đang huỷ…" : confirming ? "Bấm lần nữa để huỷ" : "Huỷ"}
    </button>
  );
}
