"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cancelParentRequest } from "../actions";

// Huỷ yêu cầu đang chờ, hoặc (13/11/2026) RÚT đơn xin nghỉ đã được trung tâm tiếp nhận — cùng một Server Action `cancelParentRequest`, máy chủ tự rẽ theo trạng thái đơn.
// Nhãn do nơi gọi truyền (máy chủ quyết nút nói gì): «Huỷ» hay «Rút đơn xin nghỉ».
export function CancelButton({
  id,
  nhan = "Huỷ",
  nhanXacNhan = "Bấm lần nữa để huỷ",
  thanhCong = "Đã huỷ yêu cầu",
}: {
  id: string;
  nhan?: string;
  nhanXacNhan?: string;
  thanhCong?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Confirm 2 bước (pattern dự án): bấm 1 → xác nhận, bấm 2 mới làm.
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
        toast.success(thanhCong);
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
      // min-h-11 (44px) — vùng bấm tối thiểu trên điện thoại.
      className={`min-h-11 rounded-lg px-3 text-xs font-semibold transition-colors disabled:opacity-60 ${
        confirming ? "bg-rose-600 text-white hover:bg-rose-700" : "text-rose-600 hover:bg-rose-50"
      }`}
    >
      {pending ? "Đang xử lý…" : confirming ? nhanXacNhan : nhan}
    </button>
  );
}
