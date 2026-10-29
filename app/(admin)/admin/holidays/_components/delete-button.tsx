"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { deleteHoliday } from "../_actions";

/**
 * QA 20/07 — bỏ window.confirm (block renderer, không đồng nhất UI)
 * → ConfirmDialog dùng chung + toast kết quả.
 */
export function DeleteHolidayButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const res = await deleteHoliday(id);
      if (res?.error) {
        toast.error(res.error);
        setOpen(false);
        return;
      }
      toast.success(`Đã xoá ngày nghỉ "${name}"`);
      setOpen(false);
      router.push("/holidays");
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border-2 border-state-danger-soft bg-card px-4 py-2 text-sm font-bold text-state-danger-ink hover:bg-state-danger-soft"
      >
        <Trash2 className="h-4 w-4" />
        Xoá
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        pending={pending}
        title={`Xoá ngày nghỉ "${name}"?`}
        description="Các buổi học đã được dời vì ngày nghỉ này sẽ KHÔNG tự quay lại lịch cũ. Hành động không thể hoàn tác."
        confirmLabel="Xoá ngày nghỉ"
        onConfirm={handleConfirm}
      />
    </>
  );
}
