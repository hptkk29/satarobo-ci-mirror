"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, RotateCcw, X } from "lucide-react";
import {
  REQUEST_TYPE_LABEL,
  REQUEST_STATUS_LABEL,
  REQUEST_STATUS_BADGE,
} from "@/lib/portal/request-labels";
import type { ParentRequestType, ParentRequestStatus } from "@prisma/client";
import { handleParentRequest, resolveAbsence } from "../actions";
import { formatDateVN } from "@/lib/format/date";

export type RequestItem = {
  id: string;
  type: ParentRequestType;
  status: ParentRequestStatus;
  content: string;
  preferredDate: string | null;
  response: string | null;
  createdAt: string;
  parentName: string | null;
  studentName: string;
  studentCode: string | null;
  className: string | null;
  handledByName: string | null;
  // Báo vắng (ABSENCE):
  hasSession: boolean;
  sessionDate: string | null;
  urgency: "URGENT" | "ON_TIME" | null;
};

export function RequestRow({ item }: { item: RequestItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [response, setResponse] = useState("");
  const [open, setOpen] = useState(false);

  const isAbsence = item.type === "ABSENCE";
  // Báo vắng gắn buổi cụ thể → dùng luồng resolveAbsence (học bù / đánh vắng).
  const useAbsenceFlow = isAbsence && item.hasSession;

  function decide(decision: "APPROVED" | "REJECTED") {
    startTransition(async () => {
      const res = await handleParentRequest({ id: item.id, decision, response });
      if (res.ok) {
        toast.success(decision === "APPROVED" ? "Đã duyệt" : "Đã từ chối");
        setOpen(false);
        router.refresh();
      } else toast.error(res.error ?? "Lỗi");
    });
  }

  function resolve(action: "MAKEUP" | "ABSENT", excused?: boolean) {
    startTransition(async () => {
      const res = await resolveAbsence({
        requestId: item.id,
        action,
        excused,
        response: response || null,
      });
      if (res.ok) {
        toast.success(action === "MAKEUP" ? "Đã xếp học bù" : "Đã ghi nhận vắng");
        setOpen(false);
        router.refresh();
      } else toast.error(res.error ?? "Lỗi xử lý");
    });
  }

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-foreground">
            {REQUEST_TYPE_LABEL[item.type]}
          </span>
          {isAbsence && item.urgency === "URGENT" && (
            <span className="rounded-full bg-state-danger-soft px-2 py-0.5 text-xs font-bold text-state-danger-ink">
              GẤP
            </span>
          )}
          <span className="text-sm text-muted-foreground">
            {item.studentName}
            {item.studentCode ? ` (${item.studentCode})` : ""}
            {item.className ? ` · ${item.className}` : ""}
          </span>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${REQUEST_STATUS_BADGE[item.status]}`}
        >
          {REQUEST_STATUS_LABEL[item.status]}
        </span>
      </div>

      {item.parentName && (
        <p className="mt-1 text-xs text-muted-foreground">PH: {item.parentName}</p>
      )}

      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.content}</p>

      {item.sessionDate && (
        <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5" />
          Buổi/ngày: {formatDateVN(item.sessionDate)}
        </p>
      )}
      {!item.sessionDate && item.preferredDate && (
        <p className="mt-1 text-xs text-muted-foreground">
          Ngày: {formatDateVN(item.preferredDate)}
        </p>
      )}

      {item.response && (
        <p className="mt-2 rounded-lg bg-muted p-2 text-sm text-muted-foreground">
          Ghi chú xử lý: {item.response}
          {item.handledByName ? ` — ${item.handledByName}` : ""}
        </p>
      )}

      <p className="mt-1 text-xs text-muted-foreground">
        Gửi: {new Date(item.createdAt).toLocaleString("vi-VN")}
      </p>

      {item.status === "PENDING" && (
        <div className="mt-3">
          {open ? (
            <div className="space-y-2">
              <textarea
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                rows={2}
                placeholder="Phản hồi / ghi chú xử lý cho phụ huynh (tuỳ chọn)…"
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
              {useAbsenceFlow ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => resolve("MAKEUP")}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
                  >
                    <RotateCcw className="h-4 w-4" /> Xếp học bù
                  </button>
                  <button
                    type="button"
                    onClick={() => resolve("ABSENT", true)}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60"
                  >
                    <X className="h-4 w-4" /> Đánh vắng (có phép)
                  </button>
                  <button
                    type="button"
                    onClick={() => resolve("ABSENT", false)}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-state-danger bg-card px-3 py-1.5 text-sm font-semibold text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-60"
                  >
                    <X className="h-4 w-4" /> Đánh vắng (không phép)
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground"
                  >
                    Đóng
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => decide("APPROVED")}
                    disabled={pending}
                    className="rounded-lg bg-state-success-ink px-3 py-1.5 text-sm font-semibold text-white hover:bg-state-success-ink-hover disabled:opacity-60"
                  >
                    Duyệt / Hoàn tất
                  </button>
                  <button
                    type="button"
                    onClick={() => decide("REJECTED")}
                    disabled={pending}
                    className="rounded-lg bg-state-danger-ink px-3 py-1.5 text-sm font-semibold text-white hover:bg-state-danger-ink-hover disabled:opacity-60"
                  >
                    Từ chối
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground"
                  >
                    Đóng
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-dark"
            >
              Xử lý
            </button>
          )}
          {isAbsence && !item.hasSession && (
            <p className="mt-2 rounded-lg bg-state-warning-soft p-2 text-xs text-state-warning-ink">
              Báo vắng không gắn buổi cụ thể — duyệt/từ chối thủ công, đánh vắng
              ở module điểm danh.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
