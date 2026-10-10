"use client";

// US-03 — xoá nhóm (SOFT DELETE) với xác nhận 2-click. Grant nhóm giữ nguyên trong DB
// nhưng vô hiệu ngay lần resolve kế (resolveActor chỉ nạp nhóm deletedAt null).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteUserGroupAction } from "../_actions";

export function DeleteGroupButton({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function onClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    startTransition(async () => {
      const res = await deleteUserGroupAction(groupId);
      if (res.ok) {
        toast.success("Đã xoá nhóm — grant nhóm vô hiệu từ request kế tiếp");
        router.push("/user-groups");
        router.refresh();
      } else {
        toast.error(res.error);
        setConfirming(false);
      }
    });
  }

  return (
    <Button
      variant={confirming ? "destructive" : "outline"}
      size="sm"
      onClick={onClick}
      disabled={pending}
    >
      <Trash2 className="mr-1 h-4 w-4" />
      {pending ? "Đang xoá..." : confirming ? "Bấm lần nữa để xoá nhóm" : "Xoá nhóm"}
    </Button>
  );
}
