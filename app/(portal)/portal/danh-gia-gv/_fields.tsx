"use client";

import type { QuestionType } from "@/lib/eval/schema";

export type PortalQuestion = {
  id: string;
  type: QuestionType;
  label: string;
  options: string[];
  required: boolean;
};

export type AnswerValue = {
  number?: number | null;
  options?: string[];
  text?: string;
};
export type AnswerState = Record<string, AnswerValue>;

/** Chuyển state UI → mảng SubmittedAnswer cho server action. */
export function toSubmitAnswers(
  questions: PortalQuestion[],
  state: AnswerState,
) {
  return questions.map((q) => {
    const v = state[q.id] ?? {};
    return {
      questionId: q.id,
      valueNumber: q.type === "STAR_RATING" ? (v.number ?? null) : null,
      valueOptions:
        q.type === "RADIO" || q.type === "CHECKBOX" ? (v.options ?? []) : null,
      valueText: q.type === "TEXTBOX" ? (v.text ?? "") : null,
    };
  });
}

export function QuestionField({
  q,
  value,
  onChange,
  kidFriendly = false,
}: {
  q: PortalQuestion;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
  kidFriendly?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-neutral-800">
        {q.label}
        {q.required && <span className="ml-1 text-rose-500">*</span>}
      </p>

      {q.type === "STAR_RATING" && (
        <div
          className={`flex gap-1.5 ${kidFriendly ? "text-4xl" : "text-2xl"}`}
        >
          {[1, 2, 3, 4, 5].map((n) => {
            const active = (value.number ?? 0) >= n;
            return (
              <button
                key={n}
                type="button"
                aria-label={`${n} sao`}
                onClick={() => onChange({ number: n })}
                className={`leading-none transition-transform hover:scale-110 ${active ? "text-amber-400" : "text-neutral-300"}`}
              >
                ★
              </button>
            );
          })}
        </div>
      )}

      {q.type === "RADIO" &&
        (kidFriendly ? (
          // Kid-friendly: thẻ to (emoji đầu option nếu có) — giống SataUI Q1.
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {q.options.map((opt) => {
              const active = value.options?.[0] === opt;
              const m = opt.match(/^(\p{Extended_Pictographic}+)\s*(.*)$/u);
              const emoji = m?.[1] ?? null;
              const label = (m?.[2] || opt).trim();
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => onChange({ options: [opt] })}
                  className={`flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-3 text-center transition-colors ${active ? "border-orange-400 bg-orange-50" : "border-neutral-200 bg-white hover:bg-neutral-50"}`}
                >
                  {emoji && (
                    <span className="text-3xl leading-none">{emoji}</span>
                  )}
                  <span
                    className={`text-xs font-semibold ${active ? "text-orange-700" : "text-neutral-600"}`}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-1.5">
            {q.options.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 text-sm text-neutral-700"
              >
                <input
                  type="radio"
                  name={q.id}
                  checked={value.options?.[0] === opt}
                  onChange={() => onChange({ options: [opt] })}
                  className="h-4 w-4"
                />
                {opt}
              </label>
            ))}
          </div>
        ))}

      {q.type === "CHECKBOX" && (
        <div className="space-y-1.5">
          {q.options.map((opt) => {
            const picked = value.options ?? [];
            const checked = picked.includes(opt);
            return (
              <label
                key={opt}
                className="flex items-center gap-2 text-sm text-neutral-700"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onChange({
                      options: checked
                        ? picked.filter((o) => o !== opt)
                        : [...picked, opt],
                    })
                  }
                  className="h-4 w-4"
                />
                {opt}
              </label>
            );
          })}
        </div>
      )}

      {q.type === "TEXTBOX" && (
        <textarea
          value={value.text ?? ""}
          maxLength={2000}
          onChange={(e) => onChange({ text: e.target.value })}
          rows={3}
          placeholder="Nhập ý kiến…"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none"
        />
      )}
    </div>
  );
}
