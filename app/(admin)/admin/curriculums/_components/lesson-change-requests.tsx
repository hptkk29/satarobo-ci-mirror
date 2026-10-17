"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LessonChangeStatus } from "@prisma/client";
import { handleLessonChangeRequest } from "../_actions";

export type ChangeRequestRow = {
  id: string;
  lessonOrder: number;
  lessonTitle: string;
  requestedByName: string;
  content: string;
  status: LessonChangeStatus;
  response: string | null;
  createdAt: string;
};

const STATUS_LABEL: Record<LessonChangeStatus, string> = {
  OPEN: "Chờ xử lý",
  ACCEPTED: "Đã chấp nhận",
  REJECTED: "Đã từ chối",
};

const STATUS_CLASS: Record<LessonChangeStatus, string> = {
  OPEN: "bg-state-warning-soft text-state-warning-ink",
  ACCEPTED: "bg-state-success-soft text-state-success-ink",
  REJECTED: "bg-state-danger-soft text-state-danger-ink",
};

export function LessonChangeRequests({
  requests,
  canHandle,
}: {
  requests: ChangeRequestRow[];
  // Duyệt đề xuất (lesson-change:approve — QĐ-T3b: SUPER_ADMIN/TRAINING/CENTER_MANAGER) — accept/reject + phản hồi.
  canHandle: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function handle(
    requestId: string,
    decision: Extract<LessonChangeStatus, "ACCEPTED" | "REJECTED">,
  ) {
    setError(null);
    startTransition(async () => {
      const res = await handleLessonChangeRequest({
        requestId,
        decision,
        response: responses[requestId],
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  if (requests.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Đề xuất chỉnh sửa (GV)
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">Chưa có đề xuất nào.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
        Đề xuất chỉnh sửa (GV) ({requests.length})
      </h2>

      {error && (
        <div className="mt-3 rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <ul className="mt-3 space-y-3">
        {requests.map((r) => (
          <li
            key={r.id}
            className="rounded-lg border border-border bg-muted p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                Bài {r.lessonOrder}: {r.lessonTitle}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS_CLASS[r.status]}`}
              >
                {STATUS_LABEL[r.status]}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {r.requestedByName} · {r.createdAt}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
              {r.content}
            </p>

            {r.response && (
              <div className="mt-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
                <span className="font-semibold text-muted-foreground">Phản hồi: </span>
                {r.response}
              </div>
            )}

            {canHandle && r.status === "OPEN" && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={responses[r.id] ?? ""}
                  onChange={(e) =>
                    setResponses((s) => ({ ...s, [r.id]: e.target.value }))
                  }
                  placeholder="Phản hồi cho GV (tuỳ chọn)…"
                  rows={2}
                  disabled={pending}
                  className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handle(r.id, "ACCEPTED")}
                    disabled={pending}
                    className="rounded-lg bg-state-success-ink px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Chấp nhận
                  </button>
                  <button
                    type="button"
                    onClick={() => handle(r.id, "REJECTED")}
                    disabled={pending}
                    className="rounded-lg bg-state-danger-ink px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Từ chối
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
