"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { sendStaffMessage } from "../_actions";

export function ReplyForm({ enrollmentId }: { enrollmentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");

  function submit() {
    const text = body.trim();
    if (!text) {
      toast.error("Vui lòng nhập nội dung");
      return;
    }
    startTransition(async () => {
      const res = await sendStaffMessage({ enrollmentId, body: text });
      if (res.ok) {
        setBody("");
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi gửi tin nhắn");
      }
    });
  }

  return (
    <div className="flex items-end gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Trả lời phụ huynh…"
        className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Đang gửi…" : "Gửi"}
      </button>
    </div>
  );
}
