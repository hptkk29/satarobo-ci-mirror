"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2, ClipboardCheck, ListChecks } from "lucide-react";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { deleteSession } from "../_actions";

type Row = {
  id: string;
  date: Date;
  topic: string | null;
  className: string;
  classId: string;
  attendanceCount: number;
};

function formatDateTime(d: Date): string {
  const date = new Date(d);
  const time = date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const day = date.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return `${day} · ${time}`;
}

function isPast(d: Date): boolean {
  return new Date(d).getTime() < Date.now();
}

export function SessionListRow({
  session,
  returnTo,
}: {
  session: Row;
  /** QA 20/07 Vấn đề C — bộ lọc hiện tại, để form Sửa quay về đúng ngữ cảnh. */
  returnTo?: string;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const past = isPast(session.date);

  const editHref = returnTo
    ? `/sessions/${session.id}/edit?returnTo=${encodeURIComponent(returnTo)}`
    : `/sessions/${session.id}/edit`;

  // QA 20/07 Lỗi B — bỏ window.confirm (block renderer, không đồng nhất UI)
  // → ConfirmDialog dùng chung + toast kết quả.
  function handleDelete() {
    startTransition(async () => {
      const res = await deleteSession(session.id);
      if (res?.error) {
        toast.error(res.error);
      } else {
        toast.success("Đã xoá buổi học");
        router.refresh();
      }
      setConfirmOpen(false);
    });
  }

  return (
    <tr className="border-b border-border hover:bg-muted">
      <td className="p-4 text-sm">
        <div className="font-bold tabular-nums text-foreground">{formatDateTime(session.date)}</div>
        <div className="mt-0.5 text-xs">
          {past ? (
            <span className="text-muted-foreground">Đã diễn ra</span>
          ) : (
            <span className="text-state-success-ink">Sắp tới</span>
          )}
        </div>
      </td>
      <td className="p-4">
        <div className="font-semibold text-foreground">{session.className}</div>
        {session.topic && (
          <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">📚 {session.topic}</div>
        )}
      </td>
      <td className="p-4 text-center">
        {session.attendanceCount > 0 ? (
          <span className="inline-block rounded-full bg-state-info-soft px-2 py-1 text-xs font-medium text-state-info-ink">
            {session.attendanceCount} điểm danh
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Chưa có</span>
        )}
      </td>
      <td className="p-4 text-right">
        <div className="inline-flex items-center gap-1">
          <Link
            href={`/attendance?sessionId=${session.id}`}
            className="rounded p-1.5 text-state-info-ink hover:bg-state-info-soft"
            title="Điểm danh"
          >
            <ClipboardCheck className="h-4 w-4" />
          </Link>
          <Link
            href={`/sessions/${session.id}`}
            className="rounded p-1.5 text-state-success-ink hover:bg-state-success-soft"
            title="Chi tiết / Nhận xét / Checklist"
          >
            <ListChecks className="h-4 w-4" />
          </Link>
          <Link
            href={editHref}
            className="rounded p-1.5 text-primary hover:bg-primary-soft"
            title="Sửa"
          >
            <Pencil className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={pending}
            className="rounded p-1.5 text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-50"
            title="Xoá"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            pending={pending}
            title={`Xoá buổi học "${session.topic ?? formatDateTime(session.date)}"?`}
            description={
              session.attendanceCount > 0 ? (
                <>
                  Buổi thuộc lớp <strong>{session.className}</strong>.{" "}
                  <strong>{session.attendanceCount} bản ghi điểm danh</strong> của buổi
                  này sẽ bị xoá theo. Hành động không thể hoàn tác.
                </>
              ) : (
                <>
                  Buổi thuộc lớp <strong>{session.className}</strong>, chưa có điểm
                  danh. Hành động không thể hoàn tác.
                </>
              )
            }
            confirmLabel="Xoá buổi học"
            onConfirm={handleDelete}
          />
        </div>
      </td>
    </tr>
  );
}
