"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { saveAnswer, submitAttempt } from "../../actions";

type Choice = { id: string; text: string };
type Question = {
  eqId: string;
  type: string;
  text: string;
  points: number;
  choices: Choice[];
  initialSelected: string[];
  initialText: string;
};

type AnswerState = { selected: string[]; text: string };

export function ExamTaking({
  attemptId,
  title,
  deadlineMs,
  totalPoints,
  questions,
}: {
  attemptId: string;
  title: string;
  deadlineMs: number;
  totalPoints: number;
  questions: Question[];
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, AnswerState>>(() => {
    const init: Record<string, AnswerState> = {};
    for (const q of questions) {
      init[q.eqId] = { selected: q.initialSelected, text: q.initialText };
    }
    return init;
  });
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.floor((deadlineMs - Date.now()) / 1000)),
  );
  const [submitting, setSubmitting] = useState(false);
  const [savingCount, setSavingCount] = useState(0);
  const submittedRef = useRef(false);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const doSubmit = useCallback(
    async (auto: boolean) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      // Flush pending autosaves.
      Object.values(timersRef.current).forEach(clearTimeout);
      const res = await submitAttempt(attemptId);
      if (res.ok) {
        toast.success(auto ? "Hết giờ — đã nộp bài tự động" : "Đã nộp bài");
        router.push("/portal/ket-qua");
        router.refresh();
      } else {
        submittedRef.current = false;
        setSubmitting(false);
        toast.error(res.error ?? "Nộp bài thất bại");
      }
    },
    [attemptId, router],
  );

  // Countdown.
  useEffect(() => {
    const t = setInterval(() => {
      const rem = Math.max(0, Math.floor((deadlineMs - Date.now()) / 1000));
      setRemaining(rem);
      if (rem <= 0) {
        clearInterval(t);
        void doSubmit(true);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [deadlineMs, doSubmit]);

  const persist = useCallback(
    (eqId: string, next: AnswerState) => {
      if (timersRef.current[eqId]) clearTimeout(timersRef.current[eqId]);
      timersRef.current[eqId] = setTimeout(() => {
        setSavingCount((c) => c + 1);
        void saveAnswer({
          attemptId,
          examQuestionId: eqId,
          selectedChoiceIds: next.selected,
          textAnswer: next.text,
        }).finally(() => setSavingCount((c) => Math.max(0, c - 1)));
      }, 800);
    },
    [attemptId],
  );

  function update(eqId: string, patch: Partial<AnswerState>) {
    setAnswers((prev) => {
      const next = { ...prev[eqId], ...patch };
      const all = { ...prev, [eqId]: next };
      persist(eqId, next);
      return all;
    });
  }

  function toggleChoice(eqId: string, choiceId: string, single: boolean) {
    setAnswers((prev) => {
      const cur = prev[eqId].selected;
      const selected = single
        ? [choiceId]
        : cur.includes(choiceId)
          ? cur.filter((c) => c !== choiceId)
          : [...cur, choiceId];
      const next = { ...prev[eqId], selected };
      persist(eqId, next);
      return { ...prev, [eqId]: next };
    });
  }

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const low = remaining <= 60;

  return (
    <div className="space-y-5">
      <div className="sticky top-[112px] z-10 -mx-4 flex items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50/95 px-4 py-2 backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold text-neutral-900">
            {title}
          </h1>
          <p className="text-xs text-neutral-600">
            {questions.length} câu · {totalPoints} điểm
          </p>
        </div>
        <div
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-sm font-bold ${
            low ? "bg-red-100 text-red-700" : "bg-neutral-200 text-neutral-800"
          }`}
        >
          <Clock className="h-4 w-4" />
          {mm}:{ss}
        </div>
      </div>

      <ol className="space-y-4">
        {questions.map((q, i) => {
          const a = answers[q.eqId];
          const isChoice =
            q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE";
          const single = q.type === "TRUE_FALSE";
          return (
            <li
              key={q.eqId}
              className="rounded-xl border border-neutral-200 bg-white p-4"
            >
              <div className="mb-3 flex items-start gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">
                  {i + 1}
                </span>
                <p className="whitespace-pre-wrap text-sm font-medium text-neutral-900">
                  {q.text}
                  <span className="ml-2 text-xs font-normal text-neutral-500">
                    ({q.points} điểm)
                  </span>
                </p>
              </div>

              {isChoice ? (
                <div className="space-y-2 pl-8">
                  {q.choices.map((c) => {
                    const checked = a.selected.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm ${
                          checked
                            ? "border-orange-400 bg-orange-50"
                            : "border-neutral-200 hover:bg-neutral-50"
                        }`}
                      >
                        <input
                          type={single ? "radio" : "checkbox"}
                          name={q.eqId}
                          checked={checked}
                          onChange={() => toggleChoice(q.eqId, c.id, single)}
                          disabled={submitting}
                          className="h-4 w-4"
                        />
                        <span>{c.text}</span>
                      </label>
                    );
                  })}
                </div>
              ) : q.type === "SHORT_ANSWER" ? (
                <input
                  value={a.text}
                  onChange={(e) => update(q.eqId, { text: e.target.value })}
                  disabled={submitting}
                  className="ml-8 w-[calc(100%-2rem)] rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none"
                  placeholder="Nhập câu trả lời…"
                />
              ) : (
                <textarea
                  value={a.text}
                  onChange={(e) => update(q.eqId, { text: e.target.value })}
                  disabled={submitting}
                  rows={5}
                  className="ml-8 w-[calc(100%-2rem)] rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none"
                  placeholder="Nhập bài làm… (giáo viên sẽ chấm)"
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex items-center justify-between gap-3 border-t border-neutral-200 pt-4">
        <span className="flex items-center gap-1.5 text-xs text-neutral-600">
          {savingCount > 0 ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang lưu…
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Đã lưu
              tự động
            </>
          )}
        </span>
        <button
          type="button"
          onClick={() => doSubmit(false)}
          disabled={submitting}
          className="rounded-lg bg-orange-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-60"
        >
          {submitting ? "Đang nộp…" : "Nộp bài"}
        </button>
      </div>
    </div>
  );
}
