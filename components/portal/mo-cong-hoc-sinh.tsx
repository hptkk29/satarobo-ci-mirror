"use client";

import { ExternalLink } from "lucide-react";
import { useSetActiveSite } from "@/components/portal/use-set-active-site";

// Nút "Mở Cổng học sinh cho con" — cùng cơ chế với mục "Cho con vào Cổng học sinh" ở thanh bên: đặt con đang xem rồi đi tới màn "Cho con vào" (/portal/hoc-sinh/vao) — nơi tạo mã thoát và bấm vào.
export function MoCongHocSinh({ studentId }: { studentId: string }) {
  const { pending, switchTo } = useSetActiveSite();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        switchTo(studentId, {
          onSuccess: (r) => {
            r.push("/portal/hoc-sinh/vao");
            r.refresh();
          },
        })
      }
      className="flex h-11 items-center gap-2 rounded-xl bg-[var(--sr-orange)] px-[18px] text-sm font-bold text-[var(--sr-on-orange)] disabled:opacity-70"
    >
      <ExternalLink className="size-4" aria-hidden="true" />
      Mở Cổng học sinh cho con
    </button>
  );
}
