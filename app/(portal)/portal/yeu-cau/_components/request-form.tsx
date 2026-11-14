"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ALL_REQUEST_TYPES,
  REQUEST_TYPE_LABEL,
} from "@/lib/portal/request-labels";
import { createParentRequest } from "../actions";

const inputCls =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none";

export function RequestForm({
  upcomingSessions = [],
  initialType,
  initialContent,
  makeupNeedId,
}: {
  upcomingSessions?: { id: string; label: string }[];
  /** Giá trị khởi tạo (CTA "Gửi yêu cầu học bù" prefill type=MAKEUP + nội dung buổi vắng). */
  initialType?: string;
  initialContent?: string;
  /** Mở từ nút "Xin học bù" của một buổi vắng ⇒ đơn gắn đúng buổi đó. */
  makeupNeedId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState(initialType ?? "ABSENCE");
  const [content, setContent] = useState(initialContent ?? "");
  const [date, setDate] = useState("");
  const [sessionId, setSessionId] = useState("");

  function submit() {
    if (type === "ABSENCE" && upcomingSessions.length > 0 && !sessionId) {
      toast.error("Vui lòng chọn buổi xin vắng");
      return;
    }
    startTransition(async () => {
      const res = await createParentRequest({
        type,
        content,
        preferredDate: date || null,
        sessionId: type === "ABSENCE" ? sessionId || null : null,
        makeupNeedId: type === "MAKEUP" ? makeupNeedId ?? null : null,
      });
      if (res.ok) {
        toast.success("Đã gửi yêu cầu");
        setContent("");
        setDate("");
        setSessionId("");
        router.refresh();
      } else toast.error(res.error ?? "Lỗi gửi yêu cầu");
    });
  }

  const isAbsence = type === "ABSENCE";
  const showDate = (type === "MAKEUP" || type === "RESERVE") && !isAbsence;

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-neutral-700">
        Gửi yêu cầu mới
      </h2>
      <div className="space-y-3">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className={inputCls}
        >
          {ALL_REQUEST_TYPES.map((t) => (
            <option key={t} value={t}>
              {REQUEST_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        {isAbsence && upcomingSessions.length > 0 && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              Buổi xin vắng
            </span>
            <select
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className={inputCls}
            >
              <option value="">— Chọn buổi —</option>
              {upcomingSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {showDate && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              Ngày liên quan (tuỳ chọn)
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputCls}
            />
          </label>
        )}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          placeholder="Mô tả chi tiết yêu cầu…"
          className={inputCls}
        />
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-60"
        >
          {pending ? "Đang gửi…" : "Gửi yêu cầu"}
        </button>
      </div>
    </section>
  );
}
