"use client";

// app/(admin)/admin/lop-trial/_components/cancel-class-button.tsx — GĐ2.
//
// Nút huỷ lớp hai nhịp. KHÔNG dùng `window.confirm`: hộp thoại đó chặn toàn bộ vòng lặp
// sự kiện của trình duyệt, nên transition đang chạy và toast đều đứng hình cho tới khi
// người dùng bấm — mà trên WebView nhúng thì nó còn có thể không hiện ra gì cả.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { cancelLopTrialClassAction } from "../_actions";

/** Nhịp 1 tự huỷ sau ngần này nếu không bấm tiếp — tránh để nút nằm ở trạng thái "đã sẵn sàng xoá". */
const THOI_GIAN_CHO_MS = 4000;

export function CancelClassButton({
  trialClassId,
  className,
}: {
  trialClassId: string;
  className?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  // Hẹn giờ trả nút về nhịp 1. Cleanup là bắt buộc: mỗi lần `confirming` đổi hoặc dòng bị
  // gỡ khỏi bảng (phân trang, router.refresh) mà còn timer treo thì nó gọi setState trên
  // component đã unmount, và bấm lại liên tục sẽ chồng nhiều timer cùng lúc.
  useEffect(() => {
    if (!confirming) return;
    const id = window.setTimeout(() => setConfirming(false), THOI_GIAN_CHO_MS);
    return () => window.clearTimeout(id);
  }, [confirming]);

  function onClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    startTransition(async () => {
      const res = await cancelLopTrialClassAction(trialClassId);
      if (res.ok) {
        toast.success("Đã huỷ lớp");
        router.refresh();
      } else {
        toast.error(res.error);
        setConfirming(false);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50",
        confirming
          ? "border-state-danger bg-state-danger text-white"
          : "border-border text-muted-foreground hover:bg-muted",
        className,
      )}
    >
      <Ban className="h-3.5 w-3.5" />
      {pending
        ? "Đang huỷ…"
        : confirming
          ? "Bấm lại để xác nhận"
          : "Huỷ lớp"}
    </button>
  );
}
