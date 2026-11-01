"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import {
  addAssignmentQuestion,
  updateAssignmentQuestion,
  deleteAssignmentQuestion,
} from "../_actions";

type QuestionType =
  | "MULTIPLE_CHOICE"
  | "TRUE_FALSE"
  | "SHORT_ANSWER"
  | "ESSAY"
  | "CODE"
  // Parity site GV 18/08 — loại mới (soạn ở thư viện mẫu / kho GV, payload Question.meta);
  // editor này chỉ HIỂN THỊ nhãn, không soạn mới 3 loại này.
  | "FILL_BLANK"
  | "MATCHING"
  | "ORDERING";

type ChoiceValue = { text: string; isCorrect: boolean };

export type AssignmentQuestionData = {
  id: string;
  type: QuestionType;
  text: string;
  correctAnswer: string | null;
  choices: { text: string; isCorrect: boolean; order: number }[];
};

// Loại câu hỏi theo nhu cầu người dùng (#14.4) ánh xạ vào QuestionType enum.
const TYPE_OPTIONS: { value: QuestionType; label: string; hint?: string }[] = [
  { value: "ESSAY", label: "Tự luận" },
  { value: "MULTIPLE_CHOICE", label: "Trắc nghiệm (một / nhiều đáp án)" },
  { value: "TRUE_FALSE", label: "Đúng / Sai" },
  { value: "SHORT_ANSWER", label: "Trả lời ngắn" },
  { value: "CODE", label: "Lập trình" },
];

const TYPE_LABEL: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: "Trắc nghiệm",
  TRUE_FALSE: "Đúng / Sai",
  SHORT_ANSWER: "Trả lời ngắn",
  ESSAY: "Tự luận",
  CODE: "Lập trình",
  FILL_BLANK: "Điền chỗ trống",
  MATCHING: "Ghép cặp",
  ORDERING: "Sắp xếp thứ tự",
};

const inputClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

function defaultChoices(type: QuestionType): ChoiceValue[] {
  if (type === "TRUE_FALSE") {
    return [
      { text: "Đúng", isCorrect: false },
      { text: "Sai", isCorrect: false },
    ];
  }
  if (type === "MULTIPLE_CHOICE") {
    return [
      { text: "", isCorrect: false },
      { text: "", isCorrect: false },
    ];
  }
  return [];
}

// ──────────────────────────────────────────────────────────────────────────
// Editor dùng chung cho "thêm" và "sửa".
// ──────────────────────────────────────────────────────────────────────────
function QuestionEditor({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: AssignmentQuestionData;
  submitLabel: string;
  pending: boolean;
  onSubmit: (payload: {
    type: QuestionType;
    text: string;
    correctAnswer: string | null;
    choices: ChoiceValue[];
  }) => void;
  onCancel?: () => void;
}) {
  const [type, setType] = useState<QuestionType>(initial?.type ?? "ESSAY");
  const [text, setText] = useState(initial?.text ?? "");
  const [correctAnswer, setCorrectAnswer] = useState(
    initial?.correctAnswer ?? "",
  );
  const [choices, setChoices] = useState<ChoiceValue[]>(
    initial?.choices && initial.choices.length > 0
      ? initial.choices.map((c) => ({ text: c.text, isCorrect: c.isCorrect }))
      : defaultChoices(initial?.type ?? "ESSAY"),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const showChoices = type === "MULTIPLE_CHOICE" || type === "TRUE_FALSE";
  const showCorrectAnswer = !showChoices;

  function handleTypeChange(next: QuestionType) {
    setType(next);
    setLocalError(null);
    if (next === "TRUE_FALSE") setChoices(defaultChoices("TRUE_FALSE"));
    else if (next === "MULTIPLE_CHOICE")
      setChoices((prev) => (prev.length >= 2 ? prev : defaultChoices("MULTIPLE_CHOICE")));
    else setChoices([]);
  }

  function toggleCorrect(idx: number, checked: boolean) {
    setChoices((prev) => {
      // TRUE_FALSE = đúng 1 đáp án; MULTIPLE_CHOICE cho phép nhiều.
      if (type === "TRUE_FALSE") {
        return prev.map((c, i) => ({ ...c, isCorrect: i === idx ? checked : false }));
      }
      return prev.map((c, i) => (i === idx ? { ...c, isCorrect: checked } : c));
    });
  }

  function setChoiceText(idx: number, value: string) {
    setChoices((prev) => prev.map((c, i) => (i === idx ? { ...c, text: value } : c)));
  }

  function addChoice() {
    if (choices.length >= 6) return;
    setChoices((prev) => [...prev, { text: "", isCorrect: false }]);
  }

  function removeChoice(idx: number) {
    if (choices.length <= 2) return;
    setChoices((prev) => prev.filter((_, i) => i !== idx));
  }

  function submit() {
    setLocalError(null);
    if (!text.trim()) {
      setLocalError("Nội dung câu hỏi bắt buộc");
      return;
    }
    if (showChoices && choices.some((c) => !c.text.trim())) {
      setLocalError("Lựa chọn không được để trống");
      return;
    }
    onSubmit({
      type,
      text: text.trim(),
      correctAnswer: showCorrectAnswer ? correctAnswer.trim() || null : null,
      choices: showChoices ? choices : [],
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted p-4">
      {localError && (
        <div className="rounded-md border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
          {localError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="block md:col-span-1">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">
            Loại câu hỏi
          </span>
          <select
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as QuestionType)}
            disabled={pending}
            className={inputClass}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">
          Nội dung câu hỏi <span className="text-state-danger-ink">*</span>
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          disabled={pending}
          placeholder="Nhập nội dung câu hỏi..."
          className={`${inputClass} resize-y`}
        />
      </label>

      {showChoices && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Tick đáp án đúng.
            {type === "MULTIPLE_CHOICE"
              ? " Trắc nghiệm có thể chọn nhiều đáp án đúng."
              : " Đúng/Sai chỉ chọn 1."}
          </p>
          {choices.map((c, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 rounded-lg border border-border bg-card p-2.5"
            >
              <span className="w-6 pt-2 text-center font-bold text-muted-foreground">
                {String.fromCharCode(65 + idx)}.
              </span>
              <textarea
                value={c.text}
                onChange={(e) => setChoiceText(idx, e.target.value)}
                rows={1}
                disabled={pending || type === "TRUE_FALSE"}
                placeholder={
                  type === "TRUE_FALSE"
                    ? "(cố định)"
                    : `Lựa chọn ${String.fromCharCode(65 + idx)}`
                }
                className="flex-1 resize-y rounded-md border border-border bg-card px-2 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-muted"
              />
              <label className="flex items-center gap-1 self-center text-sm font-medium">
                <input
                  type="checkbox"
                  checked={c.isCorrect}
                  onChange={(e) => toggleCorrect(idx, e.target.checked)}
                  disabled={pending}
                  className="h-4 w-4 rounded border-border"
                />
                <span className="text-foreground">Đúng</span>
              </label>
              {type === "MULTIPLE_CHOICE" && choices.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeChoice(idx)}
                  disabled={pending}
                  className="self-center rounded p-1.5 text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-40"
                  aria-label="Xoá lựa chọn"
                  title="Xoá"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {type === "MULTIPLE_CHOICE" && choices.length < 6 && (
            <button
              type="button"
              onClick={addChoice}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-muted"
            >
              <Plus className="h-4 w-4" />
              Thêm lựa chọn
            </button>
          )}
        </div>
      )}

      {showCorrectAnswer && (
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">
            {type === "SHORT_ANSWER"
              ? "Đáp án mong đợi"
              : type === "CODE"
                ? "Code mẫu (gợi ý chấm)"
                : "Đáp án mẫu / gợi ý chấm (tuỳ chọn)"}
          </span>
          <textarea
            value={correctAnswer}
            onChange={(e) => setCorrectAnswer(e.target.value)}
            rows={type === "CODE" ? 6 : 3}
            disabled={pending}
            placeholder={
              type === "ESSAY"
                ? "HS có thể nộp bài tự luận / upload file qua phần nộp bài."
                : "Gợi ý đáp án..."
            }
            className={`${inputClass} resize-y`}
          />
          {type === "ESSAY" && (
            <span className="mt-1 block text-xs text-muted-foreground">
              Dạng &quot;Upload file&quot; dùng Tự luận — HS đính kèm file ở phần nộp bài.
            </span>
          )}
        </label>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Đang lưu..." : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
          >
            Huỷ
          </button>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
export function QuestionBank({
  assignmentId,
  questions,
}: {
  assignmentId: string;
  questions: AssignmentQuestionData[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAdd(payload: {
    type: QuestionType;
    text: string;
    correctAnswer: string | null;
    choices: ChoiceValue[];
  }) {
    setError(null);
    startTransition(async () => {
      const res = await addAssignmentQuestion({ assignmentId, ...payload });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAdding(false);
      router.refresh();
    });
  }

  function handleUpdate(
    id: string,
    payload: {
      type: QuestionType;
      text: string;
      correctAnswer: string | null;
      choices: ChoiceValue[];
    },
  ) {
    setError(null);
    startTransition(async () => {
      const res = await updateAssignmentQuestion(id, payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Xoá câu hỏi này khỏi bài tập? Hành động không hoàn tác.")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteAssignmentQuestion(id);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border p-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
            <ListChecks className="h-4 w-4 text-primary" />
            Bộ câu hỏi trong bài tập ({questions.length})
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Soạn các câu hỏi gắn riêng với bài tập này (tự luận, trắc nghiệm, đúng/sai...).
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
            }}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            Thêm câu hỏi
          </button>
        )}
      </header>

      {error && (
        <div className="border-b border-state-danger-soft bg-state-danger-soft px-4 py-2 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <div className="space-y-3 p-4">
        {questions.length === 0 && !adding && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Chưa có câu hỏi nào. Bấm &quot;Thêm câu hỏi&quot; để bắt đầu.
          </div>
        )}

        {questions.map((q, idx) =>
          editingId === q.id ? (
            <QuestionEditor
              key={q.id}
              initial={q}
              submitLabel="Cập nhật"
              pending={pending}
              onSubmit={(payload) => handleUpdate(q.id, payload)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div
              key={q.id}
              className="rounded-lg border border-border bg-card p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-sm font-bold text-muted-foreground">
                      {idx + 1}.
                    </span>
                    <span className="inline-flex rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
                      {TYPE_LABEL[q.type]}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-foreground">
                    {q.text}
                  </p>

                  {(q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE") &&
                    q.choices.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {q.choices.map((c, ci) => (
                          <li
                            key={ci}
                            className={`flex items-start gap-1.5 text-sm ${ c.isCorrect ? "font-semibold text-state-success-ink" : "text-muted-foreground" }`}
                          >
                            <span className="w-5 text-muted-foreground">
                              {String.fromCharCode(65 + ci)}.
                            </span>
                            <span className="flex-1">{c.text}</span>
                            {c.isCorrect && (
                              <Check className="h-4 w-4 flex-shrink-0 text-state-success-ink" />
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                  {q.type !== "MULTIPLE_CHOICE" &&
                    q.type !== "TRUE_FALSE" &&
                    q.correctAnswer && (
                      <div className="mt-2 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                        <span className="font-semibold">Đáp án/gợi ý: </span>
                        <span className="whitespace-pre-wrap">{q.correctAnswer}</span>
                      </div>
                    )}
                </div>

                <div className="flex flex-shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(q.id);
                      setAdding(false);
                    }}
                    disabled={pending}
                    className="rounded-md border border-primary-soft p-1.5 text-primary hover:bg-primary-soft disabled:opacity-40"
                    aria-label="Sửa câu hỏi"
                    title="Sửa"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(q.id)}
                    disabled={pending}
                    className="rounded-md border border-state-danger-soft p-1.5 text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-40"
                    aria-label="Xoá câu hỏi"
                    title="Xoá"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ),
        )}

        {adding && (
          <QuestionEditor
            submitLabel="Thêm câu hỏi"
            pending={pending}
            onSubmit={handleAdd}
            onCancel={() => setAdding(false)}
          />
        )}
      </div>
    </section>
  );
}
