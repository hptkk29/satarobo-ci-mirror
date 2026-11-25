"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageCircle } from "lucide-react";
import { respondToFeedback } from "../_actions";
import { formatDateVN } from "@/lib/format/date";

// P1-g — ô phản hồi của admin cho 1 đánh giá.
export function FeedbackReply({
  id,
  existing,
  respondedAt,
}: {
  id: string;
  existing: string | null;
  respondedAt: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(existing ?? "");
  const [pending, start] = useTransition();

  function save() {
    if (!text.trim()) {
      toast.error("Nhập nội dung phản hồi");
      return;
    }
    start(async () => {
      const res = await respondToFeedback({ id, response: text });
      if (res.ok) {
        toast.success("Đã lưu phản hồi");
        setOpen(false);
        router.refresh();
      } else toast.error(res.error ?? "Lỗi");
    });
  }

  if (existing && !open) {
    return (
      <div className="mt-2 rounded-lg bg-primary-soft p-2 text-sm text-primary">
        <p className="mb-0.5 flex items-center gap-1 text-xs font-semibold">
          <MessageCircle className="h-3.5 w-3.5" /> Phản hồi của trung tâm
          {respondedAt ? ` · ${formatDateVN(respondedAt)}` : ""}
        </p>
        <p className="whitespace-pre-wrap">{existing}</p>
        <button onClick={() => setOpen(true)} className="mt-1 text-xs font-semibold text-primary hover:underline">
          Sửa phản hồi
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
        <MessageCircle className="h-3.5 w-3.5" /> Phản hồi
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Nội dung phản hồi gửi phụ huynh…"
        className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
      />
      <div className="flex gap-2">
        <button onClick={save} disabled={pending} className="rounded-md bg-primary-dark px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          {pending ? "Đang lưu…" : "Lưu phản hồi"}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground">
          Huỷ
        </button>
      </div>
    </div>
  );
}
