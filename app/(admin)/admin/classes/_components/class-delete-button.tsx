"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { deleteClass } from "../_actions";

/**
 * Nút xoá lớp trên danh sách Lớp học. Xoá mềm (set deletedAt) qua server action
 * `deleteClass` — list đã lọc `deletedAt: null` nên lớp biến mất khỏi danh sách.
 * QA 20/07 Vấn đề 3: pattern 2-click cũ tự reset nhanh + không nêu hậu quả →
 * chuyển sang ConfirmDialog kèm số học viên/buổi học của lớp.
 */
export function ClassDeleteButton({
  classId,
  name,
  enrollmentCount,
  sessionCount,
}: {
  classId: string;
  name: string;
  enrollmentCount: number;
  sessionCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const res = await deleteClass(classId);
      if (res?.error) {
        toast.error(res.error);
      } else {
        toast.success(`Đã xoá lớp "${name}"`);
        router.refresh();
      }
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-state-danger-ink transition-colors hover:bg-state-danger-soft"
        aria-label={`Xoá ${name}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Xoá
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        pending={pending}
        title={`Xoá lớp "${name}"?`}
        description={
          <>
            Lớp này có <strong>{enrollmentCount} học viên đang học</strong> và{" "}
            <strong>{sessionCount} buổi học</strong>. Lớp sẽ bị ẩn khỏi danh sách
            (xoá mềm) — điểm danh, buổi học và ghi danh vẫn được giữ nhưng không
            còn truy cập từ giao diện.
          </>
        }
        confirmLabel="Xoá lớp"
        onConfirm={handleConfirm}
      />
    </>
  );
}
