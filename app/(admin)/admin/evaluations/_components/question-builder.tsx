"use client";

import { QUESTION_TYPES, type QuestionType } from "@/lib/eval/schema";
import { Trash2, Plus, ArrowUp, ArrowDown } from "lucide-react";

export type DraftQuestion = {
  type: QuestionType;
  label: string;
  options: string[];
  required: boolean;
  groupLabel: string;
  allowCustomText: boolean;
};

const TYPE_LABEL: Record<QuestionType, string> = {
  STAR_RATING: "Chấm sao (1–5)",
  RADIO: "Một lựa chọn",
  CHECKBOX: "Nhiều lựa chọn",
  TEXTBOX: "Nhập văn bản",
  PHOTO: "Tải ảnh",
};

export function emptyQuestion(): DraftQuestion {
  return { type: "STAR_RATING", label: "", options: [], required: true, groupLabel: "", allowCustomText: false };
}

export function QuestionBuilder({
  questions,
  onChange,
  disabled = false,
  allowPhoto = true,
}: {
  questions: DraftQuestion[];
  onChange: (next: DraftQuestion[]) => void;
  disabled?: boolean;
  /**
   * PHOTO chỉ dành cho SESSION_EVAL (GV tải ảnh). Portal PH (TEACHER_EVAL /
   * CENTER_SURVEY) không render input ảnh → ẩn lựa chọn để khỏi tạo form dead-end
   * (server cũng chặn ở evalFormInputSchema/replaceQuestions).
   */
  allowPhoto?: boolean;
}) {
  const typeOptions = QUESTION_TYPES.filter((t) => allowPhoto || t !== "PHOTO");
  function update(i: number, patch: Partial<DraftQuestion>) {
    onChange(questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  }
  function remove(i: number) {
    onChange(questions.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      {questions.map((q, i) => {
        const needsOptions = q.type === "RADIO" || q.type === "CHECKBOX";
        const canCustomText = q.type === "RADIO" || q.type === "CHECKBOX" || q.type === "STAR_RATING";
        return (
          <div key={i} className="rounded-lg border border-border bg-muted p-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-2">
                <input
                  value={q.groupLabel}
                  disabled={disabled}
                  onChange={(e) => update(i, { groupLabel: e.target.value })}
                  placeholder="Nhóm tiêu chí (vd: Kiến thức) — để trống nếu không nhóm"
                  className="w-full rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground disabled:bg-muted"
                />
                <div className="flex gap-2">
                  <select
                    value={q.type}
                    disabled={disabled}
                    onChange={(e) =>
                      update(i, {
                        type: e.target.value as QuestionType,
                        options:
                          e.target.value === "RADIO" || e.target.value === "CHECKBOX"
                            ? q.options.length
                              ? q.options
                              : ["", ""]
                            : [],
                      })
                    }
                    className="rounded-md border border-border px-2 py-1.5 text-sm disabled:bg-muted"
                  >
                    {typeOptions.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                  <input
                    value={q.label}
                    disabled={disabled}
                    onChange={(e) => update(i, { label: e.target.value })}
                    placeholder="Nội dung câu hỏi…"
                    className="flex-1 rounded-md border border-border px-2 py-1.5 text-sm disabled:bg-muted"
                  />
                </div>

                {needsOptions && (
                  <div className="space-y-1.5 pl-1">
                    {q.options.map((opt, oi) => (
                      <div key={oi} className="flex gap-1.5">
                        <input
                          value={opt}
                          disabled={disabled}
                          onChange={(e) =>
                            update(i, {
                              options: q.options.map((o, idx) => (idx === oi ? e.target.value : o)),
                            })
                          }
                          placeholder={`Lựa chọn ${oi + 1}`}
                          className="flex-1 rounded-md border border-border px-2 py-1 text-sm disabled:bg-muted"
                        />
                        {!disabled && (
                          <button
                            type="button"
                            onClick={() => update(i, { options: q.options.filter((_, idx) => idx !== oi) })}
                            className="rounded-md px-2 text-muted-foreground hover:text-state-danger-ink"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {!disabled && (
                      <button
                        type="button"
                        onClick={() => update(i, { options: [...q.options, ""] })}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary"
                      >
                        <Plus className="h-3 w-3" /> Thêm lựa chọn
                      </button>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={q.required}
                      disabled={disabled}
                      onChange={(e) => update(i, { required: e.target.checked })}
                    />
                    Bắt buộc trả lời
                  </label>
                  {canCustomText && (
                    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={q.allowCustomText}
                        disabled={disabled}
                        onChange={(e) => update(i, { allowCustomText: e.target.checked })}
                      />
                      Cho phép nhập tự do
                    </label>
                  )}
                </div>
              </div>

              {!disabled && (
                <div className="flex flex-col gap-1">
                  <button type="button" onClick={() => move(i, -1)} className="text-muted-foreground hover:text-foreground">
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} className="text-muted-foreground hover:text-foreground">
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => remove(i)} className="text-muted-foreground hover:text-state-danger-ink">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {!disabled && (
        <button
          type="button"
          onClick={() => onChange([...questions, emptyQuestion()])}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary"
        >
          <Plus className="h-4 w-4" /> Thêm câu hỏi
        </button>
      )}
    </div>
  );
}
