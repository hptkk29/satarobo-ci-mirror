"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { startAttempt } from "@/app/(portal)/portal/bai-thi/actions";
import { NUT_CAM } from "@/components/portal/hv-ui";
import { cn } from "@/lib/utils";

// Nút "Bắt đầu làm bài": gọi CHÍNH hành động bắt đầu lần thi đang chạy (kiểm đề có thuộc con không, hạn đóng, số lần làm), rồi tải lại
// trang để hiện phần làm bài.
export function HvBatDauThi({ examId, nhan }: { examId: string; nhan: string }) {
  const router = useRouter();
  const [dang, bat] = useTransition();
  return (
    <button
      type="button"
      disabled={dang}
      onClick={() =>
        bat(async () => {
          const r = await startAttempt(examId);
          if (r.ok) router.refresh();
          else toast.error(r.error);
        })
      }
      className={cn(NUT_CAM, "h-[46px] text-[15px]")}
    >
      {dang ? "Đang mở bài…" : nhan}
    </button>
  );
}
