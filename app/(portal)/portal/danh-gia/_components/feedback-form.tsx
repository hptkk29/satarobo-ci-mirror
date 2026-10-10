"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { createParentFeedback } from "../actions";

export function FeedbackForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState("");

  function submit() {
    startTransition(async () => {
      const res = await createParentFeedback({ rating, content });
      if (res.ok) {
        toast.success("Cảm ơn đánh giá của quý phụ huynh!");
        setContent("");
        setRating(5);
        router.refresh();
      } else toast.error(res.error ?? "Lỗi gửi đánh giá");
    });
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-neutral-700">
        Gửi đánh giá
      </h2>
      <div className="mb-3 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            aria-label={`${n} sao`}
          >
            <Star
              className={`h-7 w-7 ${
                n <= rating
                  ? "fill-amber-400 text-amber-400"
                  : "text-neutral-300"
              }`}
            />
          </button>
        ))}
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        placeholder="Chia sẻ cảm nhận của quý phụ huynh về Sata Robo…"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none"
      />
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="mt-3 rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-60"
      >
        {pending ? "Đang gửi…" : "Gửi đánh giá"}
      </button>
    </section>
  );
}
