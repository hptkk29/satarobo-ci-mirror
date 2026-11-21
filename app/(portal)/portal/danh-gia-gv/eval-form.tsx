"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  QuestionField,
  toSubmitAnswers,
  type PortalQuestion,
  type AnswerState,
} from "./_fields";
import { submitTeacherEval } from "./_actions";

export function TeacherEvalForm({
  roundId,
  enrollmentId,
  teacherId,
  teacherName,
  className,
  role,
  questions,
}: {
  roundId: string;
  enrollmentId: string;
  teacherId: string;
  teacherName: string;
  className: string;
  role: string;
  questions: PortalQuestion[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<AnswerState>({});
  const [done, setDone] = useState(false);

  function submit() {
    startTransition(async () => {
      const res = await submitTeacherEval({
        roundId,
        enrollmentId,
        teacherId,
        answers: toSubmitAnswers(questions, state),
      });
      if (res.ok) {
        toast.success("Cảm ơn em đã đánh giá!");
        setDone(true);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        Đã gửi đánh giá cho thầy/cô <strong>{teacherName}</strong>. Cảm ơn em!
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="mb-3">
        <p className="text-base font-bold text-neutral-900">
          Thầy/cô {teacherName}
        </p>
        <p className="text-xs text-neutral-600">
          {role} · {className}
        </p>
      </div>
      <div className="space-y-4">
        {questions.map((q) => (
          <QuestionField
            key={q.id}
            q={q}
            value={state[q.id] ?? {}}
            onChange={(v) => setState((s) => ({ ...s, [q.id]: v }))}
            kidFriendly
          />
        ))}
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="mt-4 w-full rounded-xl bg-orange-700 px-4 py-3 text-sm font-bold text-white hover:bg-orange-800 disabled:opacity-60"
      >
        {pending ? "Đang gửi…" : "Gửi đánh giá"}
      </button>
    </div>
  );
}
