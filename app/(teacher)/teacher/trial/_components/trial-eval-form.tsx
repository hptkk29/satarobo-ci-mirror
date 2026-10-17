"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileDown, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  RUBRIC,
  RUBRIC_MAX,
  computeTotal,
  fmtScore,
  rankOf,
  DEFAULT_GENERAL_COMMENT,
  DEFAULT_ORIENTATION,
} from "@/lib/trial/rubric";
import { saveTrialRubricAction } from "../_actions";

export interface TrialEvalExisting {
  scores: Record<string, number>;
  generalComment: string | null;
  orientation: string | null;
}

const RANK_TONE: Record<string, string> = {
  green: "bg-state-success-soft text-white",
  blue: "bg-state-info-soft text-white",
  amber: "bg-state-warning-soft text-white",
  red: "bg-state-danger-soft text-white",
};

export function TrialEvalForm({
  enrollmentId,
  sessionId,
  studentName,
  courseName,
  existing,
  pdfHref,
}: {
  enrollmentId: string;
  /** GĐ4 — BUỔI được chấm. Phiếu khoá theo cặp (ca, buổi) nên phải gửi kèm, nếu
   * không server lại rơi về buổi đang xếp và ca chỉ đẻ được đúng một phiếu. */
  sessionId?: string | null;
  studentName: string;
  courseName: string | null;
  existing: TrialEvalExisting | null;
  /**
   * 25/08 — `null` thì KHÔNG hiện nút "Xuất PDF". Site GV truyền null (chủ dự án bỏ nút
   * này khỏi màn Trial); prop giữ lại vì route PDF vẫn sống và màn khác còn dùng.
   */
  pdfHref: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Chưa có phiếu → mặc định mức cao nhất (điểm max) mỗi tiêu chí → tổng 8.0.
  const [scores, setScores] = useState<Record<string, number>>(() => {
    if (existing) return { ...existing.scores };
    const s: Record<string, number> = {};
    for (const sec of RUBRIC)
      for (const c of sec.criteria) s[c.id] = c.levels[0]!.points;
    return s;
  });
  const [comment, setComment] = useState(
    existing?.generalComment ?? DEFAULT_GENERAL_COMMENT,
  );
  const [orientation, setOrientation] = useState(
    existing?.orientation ?? DEFAULT_ORIENTATION,
  );
  const [saved, setSaved] = useState(existing != null);

  const total = useMemo(() => computeTotal(scores), [scores]);
  const rank = rankOf(total);

  function submit() {
    start(async () => {
      const res = await saveTrialRubricAction({
        enrollmentId,
        sessionId: sessionId ?? undefined,
        scores,
        generalComment: comment,
        orientation,
      });
      if (res.ok) {
        toast.success(
          `Đã lưu phiếu — ${fmtScore(res.totalScore)}/8.0 · ${res.rank}`,
        );
        setSaved(true);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Header điểm tổng */}
      <div className="brand-gradient flex flex-wrap items-center justify-between gap-4 rounded-xl px-5 py-4 text-white">
        <div>
          <p className="text-xs font-semibold tracking-wider text-white/80 uppercase">
            Học viên Trial{courseName ? ` · ${courseName}` : ""}
          </p>
          <p className="text-2xl font-extrabold">{studentName}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl leading-none font-extrabold">
            {fmtScore(total)}{" "}
            <span className="text-lg font-semibold text-white/80">
              / {RUBRIC_MAX}.0
            </span>
          </p>
          <p className="text-[11px] font-semibold tracking-wider text-white/80 uppercase">
            Tổng điểm đánh giá
          </p>
          <span
            className={cn(
              "mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold",
              RANK_TONE[rank.tone] ?? "bg-white/20 text-white",
            )}
          >
            {rank.label}
          </span>
        </div>
      </div>

      {/* Các nhóm tiêu chí */}
      {RUBRIC.map((sec) => (
        <section key={sec.num} className="space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-bold tracking-wide text-foreground uppercase">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              {sec.num}
            </span>
            {sec.title}
          </h3>

          {sec.criteria.map((c) => {
            const selected = scores[c.id];
            return (
              <div key={c.id} className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    {c.label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.levels.map((l) => fmtScore(l.points)).join(" – ")}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {c.levels.map((l) => {
                    const active = selected === l.points;
                    return (
                      <button
                        key={l.points}
                        type="button"
                        onClick={() =>
                          setScores((s) => ({ ...s, [c.id]: l.points }))
                        }
                        className={cn(
                          "rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "border-primary bg-primary-soft dark:border-primary dark:bg-primary-soft"
                            : "border-border bg-card hover:bg-muted/50",
                        )}
                      >
                        <span
                          className={cn(
                            "block text-lg font-extrabold",
                            active
                              ? "text-primary-ink dark:text-primary-ink"
                              : "text-muted-foreground",
                          )}
                        >
                          {fmtScore(l.points)}
                        </span>
                        <span className="mt-0.5 block text-sm font-semibold text-foreground">
                          {l.title}
                        </span>
                        {l.desc && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {l.desc}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      ))}

      {/* Định hướng */}
      <section className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-bold tracking-wide text-foreground uppercase">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
            4
          </span>
          Định hướng của SataRobo
        </h3>
        <div className="space-y-1.5">
          <label
            htmlFor="tr-comment"
            className="text-sm font-semibold text-foreground"
          >
            Nhận xét chung
          </label>
          <textarea
            id="tr-comment"
            rows={4}
            value={comment}
            disabled={pending}
            maxLength={4000}
            onChange={(e) => setComment(e.target.value)}
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="tr-orient"
            className="text-sm font-semibold text-foreground"
          >
            Định hướng
          </label>
          <textarea
            id="tr-orient"
            rows={4}
            value={orientation}
            disabled={pending}
            maxLength={4000}
            onChange={(e) => setOrientation(e.target.value)}
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </section>

      {/* Hành động: Lưu + (sau khi lưu) Xuất PDF, nếu chỗ gọi còn muốn nút đó */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {saved && pdfHref && (
          <a
            href={pdfHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FileDown className="h-4 w-4" aria-hidden /> Xuất PDF
          </a>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white outline-none transition-colors hover:bg-primary-darker focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          <Save className="h-4 w-4" aria-hidden />{" "}
          {pending ? "Đang lưu…" : "Lưu đánh giá"}
        </button>
      </div>
    </div>
  );
}
