"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { huyCaseAction } from "../../_actions";

// Huỷ case — xác nhận hai nhịp (nếp admin: bấm lần hai mới chạy), không cần modal.
export function NutHuyCase({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [xacNhan, setXacNhan] = useState(false);
  const [pending, start] = useTransition();

  function bam() {
    if (!xacNhan) {
      setXacNhan(true);
      return;
    }
    start(async () => {
      const kq = await huyCaseAction(caseId);
      if (!kq.ok) {
        toast.error(kq.error);
        setXacNhan(false);
        return;
      }
      toast.success("Đã huỷ case — các bé quay lại danh sách cần bù");
      router.push("/hoc-bu?tab=case");
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {xacNhan && (
        <Button size="sm" variant="ghost" onClick={() => setXacNhan(false)} disabled={pending}>
          Thôi
        </Button>
      )}
      <Button size="sm" variant={xacNhan ? "destructive" : "outline"} onClick={bam} disabled={pending}>
        {pending ? "Đang huỷ…" : xacNhan ? "Bấm lần nữa để huỷ case" : "Huỷ case"}
      </Button>
    </div>
  );
}
