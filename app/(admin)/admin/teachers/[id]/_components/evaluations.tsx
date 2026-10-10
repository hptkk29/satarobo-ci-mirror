"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Star } from "lucide-react";
import { addTeacherReview } from "../../_actions";
import { formatDateVN } from "@/lib/format/date";

type ParentFb = { rating: number; content: string; studentName: string | null; createdAt: string };
type Review = { score: number; note: string | null; reviewerName: string; createdAt: string };

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${i <= Math.round(value) ? "fill-state-warning-ink text-state-warning-ink" : "text-gray-200"}`}
        />
      ))}
    </span>
  );
}

export function TeacherEvaluations({
  userId,
  canEdit,
  parentAvg,
  parentCount,
  parentRecent,
  reviews,
}: {
  userId: string;
  canEdit: boolean;
  parentAvg: number | null;
  parentCount: number;
  parentRecent: ParentFb[];
  reviews: Review[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [score, setScore] = useState(5);
  const [note, setNote] = useState("");

  function submit() {
    // Bắt buộc có nội dung nhận xét → tránh tạo nhầm đánh giá rỗng chỉ vì bấm nút.
    if (note.trim().length < 5) {
      toast.error("Nhập nội dung nhận xét (tối thiểu 5 ký tự) trước khi ghi đánh giá");
      return;
    }
    startTransition(async () => {
      const res = await addTeacherReview({ userId, score, note: note.trim() });
      if (res.ok) {
        toast.success("Đã ghi đánh giá nội bộ");
        setNote("");
        setScore(5);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-muted-foreground">
        Đánh giá giáo viên
      </h2>

      {/* Phụ huynh */}
      <div className="mb-4 rounded-lg bg-muted p-4">
        <div className="flex items-center gap-3">
          <div className="text-2xl font-bold tabular-nums text-foreground">
            {parentAvg != null ? parentAvg.toFixed(1) : "—"}
          </div>
          {parentAvg != null && <Stars value={parentAvg} />}
          <span className="text-xs text-muted-foreground">
            điểm phụ huynh trung bình ({parentCount} đánh giá, từ các lớp GV phụ trách)
          </span>
        </div>
        {parentRecent.length > 0 && (
          <ul className="mt-3 space-y-2">
            {parentRecent.map((f, i) => (
              <li key={i} className="rounded-md border border-border bg-card p-2 text-sm">
                <div className="flex items-center gap-2">
                  <Stars value={f.rating} />
                  <span className="text-xs text-muted-foreground">
                    {f.studentName ?? "PH"} ·{" "}
                    {formatDateVN(f.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-foreground">{f.content}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Nội bộ / dự giờ */}
      <div>
        <p className="mb-2 text-xs font-semibold text-muted-foreground">Đánh giá nội bộ / dự giờ ({reviews.length})</p>
        {reviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có đánh giá nội bộ.</p>
        ) : (
          <ul className="space-y-2">
            {reviews.map((r, i) => (
              <li key={i} className="rounded-md border border-border p-2 text-sm">
                <div className="flex items-center gap-2">
                  <Stars value={r.score} />
                  <span className="text-xs text-muted-foreground">
                    {r.reviewerName} · {formatDateVN(r.createdAt)}
                  </span>
                </div>
                {r.note && <p className="mt-1 text-foreground">{r.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canEdit && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Thêm đánh giá nội bộ</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">Điểm</span>
              <select
                value={score}
                onChange={(e) => setScore(Number(e.target.value))}
                disabled={pending}
                className="rounded-lg border border-border px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
              >
                {[5, 4, 3, 2, 1].map((s) => (
                  <option key={s} value={s}>{s} sao</option>
                ))}
              </select>
            </label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={pending}
              placeholder="Nhận xét dự giờ (bắt buộc)…"
              className="min-w-[16rem] flex-1 rounded-lg border border-border px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
            />
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Đang lưu…" : "Ghi đánh giá"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
