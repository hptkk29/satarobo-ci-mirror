"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, RotateCcw, X } from "lucide-react";
import { resolveAbsence } from "../_actions";
import { formatDateVN } from "@/lib/format/date";

export interface AbsenceItem {
  id: string;
  studentName: string;
  studentCode: string | null;
  className: string | null;
  sessionDate: string | null;
  reason: string;
  urgency: "URGENT" | "ON_TIME";
  createdAt: string;
  hasSession: boolean;
}

export function AbsenceRow({ item }: { item: AbsenceItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [response, setResponse] = useState("");

  function handle(action: "MAKEUP" | "ABSENT", excused?: boolean) {
    startTransition(async () => {
      const res = await resolveAbsence({
        requestId: item.id,
        action,
        excused,
        response: response || null,
      });
      if (res.ok) {
        toast.success(action === "MAKEUP" ? "Đã xếp học bù" : "Đã ghi nhận vắng");
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi xử lý");
      }
    });
  }

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">{item.studentName}</span>
          {item.studentCode && (
            <span className="text-xs text-muted-foreground">{item.studentCode}</span>
          )}
          {item.urgency === "URGENT" ? (
            <span className="rounded-full bg-state-danger-soft px-2 py-0.5 text-xs font-bold text-state-danger-ink">
              GẤP
            </span>
          ) : (
            <span className="rounded-full bg-state-success-soft px-2 py-0.5 text-xs font-semibold text-state-success-ink">
              Đúng hạn
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {formatDateVN(item.createdAt)}
        </span>
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        {item.className ?? "—"}
        {item.sessionDate && (
          <>
            {" · "}
            <span className="inline-flex items-center gap-1 text-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              {new Date(item.sessionDate).toLocaleDateString("vi-VN", {
                weekday: "short",
                day: "2-digit",
                month: "2-digit",
              })}
            </span>
          </>
        )}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{item.reason}</p>

      {!item.hasSession ? (
        <p className="mt-2 rounded-lg bg-state-warning-soft p-2 text-xs text-state-warning-ink">
          Yêu cầu không gắn buổi cụ thể — xử lý ở trang Yêu cầu phụ huynh.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <input
            type="text"
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Phản hồi cho phụ huynh (tuỳ chọn)"
            disabled={pending}
            className="w-full rounded-lg border border-border px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handle("MAKEUP")}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" /> Xếp học bù
            </button>
            <button
              type="button"
              onClick={() => handle("ABSENT", true)}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
            >
              <X className="h-4 w-4" /> Đánh vắng (có phép)
            </button>
            <button
              type="button"
              onClick={() => handle("ABSENT", false)}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-state-danger bg-card px-3 py-1.5 text-sm font-semibold text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-50"
            >
              <X className="h-4 w-4" /> Đánh vắng (không phép)
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
