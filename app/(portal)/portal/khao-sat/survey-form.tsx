"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { submitSurveyResponse } from "./_actions";

type SurveyQuestion = {
  id: string;
  text: string;
  type: "NPS" | "RATING" | "TEXT";
};

// @deprecated FL4-03 — form Survey/NPS (bản cũ). Khảo sát cơ sở nhiều loại câu hỏi
// dùng <CenterSurveyForm> (CENTER_SURVEY). Giữ song song 2-phase, không xoá.
//
// Survey CÓ SurveyQuestion trong DB → render ĐỦ câu hỏi (NPS 0-10 / RATING 1-5 /
// TEXT) và gửi answers theo questionId — KHÔNG hardcode 1 câu NPS cho mọi survey
// (thẻ hiện "5 câu · 2 phút" mà form chỉ hỏi 1 câu là dữ liệu thu sai nguồn).
// Survey KHÔNG có câu hỏi (NPS thuần kiểu cũ) → giữ 1 câu NPS giới thiệu như cũ.
export function SurveyForm({
  surveyId,
  title,
  questions = [],
}: {
  surveyId: string;
  title: string;
  questions?: SurveyQuestion[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Legacy (0 câu hỏi): 1 câu NPS hardcode.
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  // Có câu hỏi: đáp án theo questionId (number cho NPS/RATING, string cho TEXT).
  const [answers, setAnswers] = useState<Record<string, number | string>>({});

  const hasQuestions = questions.length > 0;

  function submit() {
    if (hasQuestions) {
      const missing = questions.find(
        (q) => q.type !== "TEXT" && typeof answers[q.id] !== "number",
      );
      if (missing) {
        toast.error(`Vui lòng trả lời: ${missing.text}`);
        return;
      }
    } else if (score == null) {
      toast.error("Vui lòng chọn điểm 0–10");
      return;
    }
    startTransition(async () => {
      const res = await submitSurveyResponse(
        hasQuestions
          ? {
              surveyId,
              comment,
              answers: questions
                .filter(
                  (q) => answers[q.id] !== undefined && answers[q.id] !== "",
                )
                .map((q) => ({
                  questionId: q.id,
                  value: answers[q.id] as number | string,
                })),
            }
          : { surveyId, npsScore: score, comment },
      );
      if (res.ok) {
        toast.success("Cảm ơn đánh giá của quý phụ huynh!");
        router.refresh();
      } else toast.error(res.error ?? "Lỗi gửi khảo sát");
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="font-semibold text-neutral-900">{title}</p>

      {hasQuestions ? (
        <div className="mt-3 space-y-4">
          {questions.map((q, i) => (
            <div key={q.id}>
              <p className="text-sm font-medium text-neutral-800">
                {i + 1}. {q.text}
                {q.type !== "TEXT" && (
                  <span className="ml-1 text-rose-500">*</span>
                )}
              </p>
              {q.type === "NPS" && (
                <ScaleButtons
                  min={0}
                  max={10}
                  value={
                    typeof answers[q.id] === "number"
                      ? (answers[q.id] as number)
                      : null
                  }
                  onSelect={(n) => setAnswers((a) => ({ ...a, [q.id]: n }))}
                />
              )}
              {q.type === "RATING" && (
                <ScaleButtons
                  min={1}
                  max={5}
                  value={
                    typeof answers[q.id] === "number"
                      ? (answers[q.id] as number)
                      : null
                  }
                  onSelect={(n) => setAnswers((a) => ({ ...a, [q.id]: n }))}
                />
              )}
              {q.type === "TEXT" && (
                <textarea
                  value={
                    typeof answers[q.id] === "string"
                      ? (answers[q.id] as string)
                      : ""
                  }
                  onChange={(e) =>
                    setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                  }
                  rows={2}
                  maxLength={2000}
                  placeholder="Nhập ý kiến…"
                  className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none"
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-neutral-600">
            Anh/chị có sẵn sàng giới thiệu Sata Robo cho phụ huynh khác? (0 =
            không, 10 = rất sẵn sàng)
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Array.from({ length: 11 }).map((_, n) => (
              <button
                key={n}
                type="button"
                onClick={() => setScore(n)}
                className={`h-9 w-9 rounded-lg border text-sm font-bold ${
                  score === n
                    ? "border-orange-500 bg-orange-700 text-white"
                    : "border-neutral-200 text-neutral-600 hover:border-orange-300"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </>
      )}

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        placeholder="Góp ý thêm (tuỳ chọn)…"
        className="mt-3 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none"
      />
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="mt-3 rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-60"
      >
        {pending ? "Đang gửi…" : "Gửi khảo sát"}
      </button>
    </div>
  );
}

/** Dãy nút chọn điểm (NPS 0-10 / RATING 1-5). */
function ScaleButtons({
  min,
  max,
  value,
  onSelect,
}: {
  min: number;
  max: number;
  value: number | null;
  onSelect: (n: number) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {Array.from({ length: max - min + 1 }).map((_, i) => {
        const n = min + i;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onSelect(n)}
            className={`h-9 w-9 rounded-lg border text-sm font-bold ${
              value === n
                ? "border-orange-500 bg-orange-700 text-white"
                : "border-neutral-200 text-neutral-600 hover:border-orange-300"
            }`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}
