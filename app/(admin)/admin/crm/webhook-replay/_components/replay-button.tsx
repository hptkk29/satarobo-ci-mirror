"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { replayAction } from "../actions";

export function ReplayButton({ deliveryId }: { deliveryId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await replayAction(deliveryId);
          if (res.ok) {
            toast.success(`Đã replay (tạo ${res.created} tin)`);
            router.refresh();
          } else {
            toast.error(res.error);
          }
        })
      }
    >
      {pending ? "Đang xử lý..." : "Replay"}
    </Button>
  );
}
