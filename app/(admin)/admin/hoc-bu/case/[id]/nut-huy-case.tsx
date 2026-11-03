"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { huyCaseAction } from "../../_actions";

// Huỷ case — xác nhận hai nhịp (nếp admin: bấm lần hai mới chạy), không cần modal.
// `rutLai`: case còn CHỜ DUYỆT (20/10/2026) — người tạo RÚT LẠI chứ không "huỷ" một lịch thật; cùng action (máy chủ phân biệt theo trạng thái case).
export function NutHuyCase({ caseId, rutLai = false }: { caseId: string; rutLai?: boolean }) {
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
      toast.success(rutLai ? "Đã rút lại case — các bé quay lại danh sách cần bù" : "Đã huỷ case — các bé quay lại danh sách cần bù");
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
        {pending ? (rutLai ? "Đang rút lại…" : "Đang huỷ…") : xacNhan ? (rutLai ? "Bấm lần nữa để rút lại" : "Bấm lần nữa để huỷ case") : rutLai ? "Rút lại case" : "Huỷ case"}
      </Button>
    </div>
  );
}
