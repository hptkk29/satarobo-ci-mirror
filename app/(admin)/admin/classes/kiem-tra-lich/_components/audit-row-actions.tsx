"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarSync } from "lucide-react";
import { resyncClassSessionsAction } from "../../_actions";

/**
 * Nút "Xếp lại" một lớp ngay trên bảng rà soát — cùng action với nút ở màn lớp.
 *
 * 2 CLICK để chốt (đúng quy ước confirm của repo): với lớp "lệch giữa khoá" thì việc
 * lệch có thể là CÓ CHỦ ĐÍCH (đổi lịch giữa khoá) — xếp lại sẽ kéo cả những buổi quá khứ
 * chưa kịp điểm danh về dãy chuẩn. Bắt bấm 2 lần để không quét nhầm cả bảng.
 */
export function AuditRowActions({ classId, canEdit }: { classId: string; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);

  if (!canEdit) return <span className="text-xs text-muted-foreground">Không có quyền</span>;

  function run() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    startTransition(async () => {
      const res = await resyncClassSessionsAction(classId);
      if (!res.ok) {
        toast.error(res.error ?? "Không xếp lại được buổi học");
        return;
      }
      const parts: string[] = [];
      if (res.generated) parts.push(`sinh ${res.generated} buổi`);
      if (res.moved) parts.push(`dời ${res.moved} buổi`);
      if (res.kept) parts.push(`giữ ${res.kept} buổi đã có dữ liệu`);
      toast.success(parts.length ? `Đã xếp lại: ${parts.join(", ")}` : "Dãy buổi đã khớp lịch");
      if (res.warning) toast.warning(res.warning, { duration: 10000 });
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={run}
      onBlur={() => setArmed(false)}
      disabled={pending}
      className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${ armed ? "bg-state-danger-ink hover:bg-state-danger-ink" : "bg-primary hover:bg-primary-dark" }`}
    >
      <CalendarSync className="h-3.5 w-3.5" />
      {pending ? "Đang xếp…" : armed ? "Bấm lần nữa để xếp lại" : "Xếp lại"}
    </button>
  );
}
