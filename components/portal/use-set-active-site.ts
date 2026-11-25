"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { toast } from "sonner";
import { setActiveSite } from "@/app/(portal)/portal/actions";

// POR-07 — gom boilerplate đổi "con đang xem" (setActiveSite) lặp ở 4 switcher.
// Mỗi caller chỉ khác: điều hướng khi thành công + câu lỗi mặc định. Truyền qua
// opts để giữ nguyên hành vi từng nơi (behavior-preserving).
export function useSetActiveSite() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchTo(
    id: string,
    opts?: {
      onSuccess?: (router: AppRouterInstance) => void;
      errorMessage?: string;
    },
  ) {
    startTransition(async () => {
      const res = await setActiveSite(id);
      if (res.ok) {
        if (opts?.onSuccess) opts.onSuccess(router);
        else router.refresh();
      } else {
        toast.error(
          res.error ?? opts?.errorMessage ?? "Không đổi được học viên",
        );
      }
    });
  }

  return { pending, switchTo };
}
