"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  QuestionField,
  toSubmitAnswers,
  type PortalQuestion,
  type AnswerState,
} from "../danh-gia-gv/_fields";
import { submitCenterSurvey } from "./_eval-actions";

// R7-16 — Form khảo sát cơ sở (round-based). KHÔNG đụng SurveyForm (NPS) cũ.
export function CenterSurveyForm({
  roundId,
  title,
  questions,
}: {
  roundId: string;
  title: string;
  questions: PortalQuestion[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<AnswerState>({});
  const [done, setDone] = useState(false);

  function submit() {
    startTransition(async () => {
      const res = await submitCenterSurvey({
        roundId,
        answers: toSubmitAnswers(questions, state),
      });
      if (res.ok) {
        toast.success("Cảm ơn quý phụ huynh đã tham gia khảo sát!");
        setDone(true);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        Đã ghi nhận khảo sát “{title}”. Cảm ơn quý phụ huynh!
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="font-semibold text-neutral-900">{title}</p>
      <div className="mt-3 space-y-4">
        {questions.map((q) => (
          <QuestionField
            key={q.id}
            q={q}
            value={state[q.id] ?? {}}
            onChange={(v) => setState((s) => ({ ...s, [q.id]: v }))}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="mt-4 rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-60"
      >
        {pending ? "Đang gửi…" : "Gửi khảo sát"}
      </button>
    </div>
  );
}
