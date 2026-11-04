"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { StringArrayEditor } from "@/app/(admin)/admin/kits/_components/string-array-editor";
import { ImageUploader } from "@/components/admin/ImageUploader";
import { FieldLabel, HelpHint } from "@/components/admin/ui/help-hint";
import {
  createQuestionAndRedirect,
  updateQuestion,
  deleteQuestionAndRedirect,
} from "../_actions";

type QuestionType =
  | "MULTIPLE_CHOICE"
  | "TRUE_FALSE"
  | "SHORT_ANSWER"
  | "ESSAY"
  | "CODE"
  // Parity site GV 18/08 — 3 loại mới soạn ở kho GV/thư viện mẫu (payload Question.meta).
  // Form ngân hàng này KHÔNG soạn mới 3 loại đó (TYPE_OPTIONS giữ 5) — chỉ nhận kiểu.
  | "FILL_BLANK"
  | "MATCHING"
  | "ORDERING";
type Difficulty = "EASY" | "MEDIUM" | "HARD" | "EXPERT";

interface LessonOption {
  id: string;
  order: number;
  title: string;
  curriculumName: string;
}

interface CurriculumOption {
  id: string;
  /** Nhãn hiển thị: "Lập trình Robot Sata 4 — Khung v2". */
  label: string;
  /** Khoá dạy chứa khung CT — dùng để suy `courseId`. */
  courseId: string;
}

type ChoiceValue = {
  order: number;
  text: string;
  isCorrect: boolean;
  imageUrl: string | null;
};

export type QuestionFormValue = {
  id: string;
  questionCode: string | null;
  type: QuestionType;
  text: string;
  explanation: string | null;
  imageUrl: string | null;
  difficulty: Difficulty;
  tags: string[];
  curriculumId: string | null;
  courseId: string | null;
  points: number | null;
  timeLimitSec: number | null;
  lessonId: string | null;
  correctAnswer: string | null;
  choices: ChoiceValue[];
  isPublic: boolean;
  notes: string | null;
};

const TYPE_OPTIONS: { value: QuestionType; label: string }[] = [
  { value: "MULTIPLE_CHOICE", label: "Trắc nghiệm" },
  { value: "TRUE_FALSE", label: "Đúng/Sai" },
  { value: "SHORT_ANSWER", label: "Trả lời ngắn" },
  { value: "ESSAY", label: "Tự luận" },
  { value: "CODE", label: "Lập trình" },
];

const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: "EASY", label: "Dễ" },
  { value: "MEDIUM", label: "Trung bình" },
  { value: "HARD", label: "Khó" },
  { value: "EXPERT", label: "Chuyên gia" },
];

function defaultChoices(type: QuestionType): ChoiceValue[] {
  if (type === "TRUE_FALSE") {
    return [
      { order: 1, text: "Đúng", isCorrect: false, imageUrl: null },
      { order: 2, text: "Sai", isCorrect: false, imageUrl: null },
    ];
  }
  if (type === "MULTIPLE_CHOICE") {
    return [
      { order: 1, text: "", isCorrect: false, imageUrl: null },
      { order: 2, text: "", isCorrect: false, imageUrl: null },
    ];
  }
  return [];
}

export function QuestionForm({
  question,
  lessons,
  curriculums,
}: {
  question?: QuestionFormValue;
  lessons: LessonOption[];
  curriculums: CurriculumOption[];
}) {
  const router = useRouter();
  const isEdit = Boolean(question);

  const [questionCode, setQuestionCode] = useState(question?.questionCode ?? "");
  const [type, setType] = useState<QuestionType>(
    question?.type ?? "MULTIPLE_CHOICE",
  );
  const [text, setText] = useState(question?.text ?? "");
  const [explanation, setExplanation] = useState(question?.explanation ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(
    question?.imageUrl ?? null,
  );
  const [difficulty, setDifficulty] = useState<Difficulty>(
    question?.difficulty ?? "MEDIUM",
  );
  const [tags, setTags] = useState<string[]>(question?.tags ?? []);
  const [curriculumId, setCurriculumId] = useState(question?.curriculumId ?? "");
  const [points, setPoints] = useState(
    question?.points != null ? String(question.points) : "",
  );
  const [timeLimitSec, setTimeLimitSec] = useState(
    question?.timeLimitSec != null ? String(question.timeLimitSec) : "",
  );
  const [lessonId, setLessonId] = useState(question?.lessonId ?? "");
  const [correctAnswer, setCorrectAnswer] = useState(question?.correctAnswer ?? "");
  const [choices, setChoices] = useState<ChoiceValue[]>(
    question?.choices && question.choices.length > 0
      ? question.choices
      : defaultChoices(question?.type ?? "MULTIPLE_CHOICE"),
  );
  const [isPublic, setIsPublic] = useState(question?.isPublic ?? true);
  const [notes, setNotes] = useState(question?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleTypeChange(newType: QuestionType) {
    setType(newType);
    setError(null);
    if (newType === "TRUE_FALSE") {
      setChoices(defaultChoices("TRUE_FALSE"));
    } else if (newType === "MULTIPLE_CHOICE") {
      // Keep existing MC choices if switching back; otherwise seed.
      setChoices((prev) =>
        prev.length >= 2 ? prev : defaultChoices("MULTIPLE_CHOICE"),
      );
    } else {
      setChoices([]);
    }
  }

  function toggleChoiceCorrect(idx: number, checked: boolean) {
    setChoices((prev) => {
      if (type === "TRUE_FALSE") {
        return prev.map((c, i) => ({
          ...c,
          isCorrect: i === idx ? checked : false,
        }));
      }
      return prev.map((c, i) => (i === idx ? { ...c, isCorrect: checked } : c));
    });
  }

  function updateChoiceText(idx: number, t: string) {
    setChoices((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, text: t } : c)),
    );
  }

  function updateChoiceImage(idx: number, url: string | null) {
    setChoices((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, imageUrl: url } : c)),
    );
  }

  function addChoice() {
    if (choices.length >= 6) return;
    setChoices((prev) => [
      ...prev,
      { order: prev.length + 1, text: "", isCorrect: false, imageUrl: null },
    ]);
  }

  function removeChoice(idx: number) {
    if (choices.length <= 2) return;
    setChoices((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((c, i) => ({ ...c, order: i + 1 })),
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const selectedCurriculum = curriculums.find((c) => c.id === curriculumId);
    const payload = {
      questionCode: questionCode.trim() || null,
      type,
      text,
      explanation: explanation.trim() || null,
      imageUrl: imageUrl || null,
      difficulty,
      tags,
      curriculumId: curriculumId || null,
      // Suy courseId từ khung CT đã chọn (server vẫn re-derive để chắc chắn).
      courseId: selectedCurriculum?.courseId ?? null,
      points: points.trim() === "" ? null : Number(points),
      timeLimitSec: timeLimitSec.trim() === "" ? null : Number(timeLimitSec),
      lessonId: lessonId || null,
      correctAnswer: correctAnswer.trim() || null,
      choices,
      isPublic,
      notes: notes.trim() || null,
    };
    startTransition(async () => {
      const res = isEdit
        ? await updateQuestion(question!.id, payload)
        : await createQuestionAndRedirect(payload);
      if (res && !res.ok) setError(res.error);
      else if (isEdit) router.refresh();
    });
  }

  function handleDelete() {
    if (!question) return;
    if (
      !confirm(
        `Xoá câu hỏi "${question.text.slice(0, 60)}${question.text.length > 60 ? "…" : ""}"? Hành động này không hoàn tác.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteQuestionAndRedirect(question.id);
      if (res && !res.ok) setError(res.error);
    });
  }

  const showChoices = type === "MULTIPLE_CHOICE" || type === "TRUE_FALSE";
  const showCorrectAnswer = !showChoices;

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-5">
      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      {/* Section 1: Identity */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Thông tin câu hỏi
        </h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Mã câu hỏi" hint="Tuỳ chọn — duy nhất toàn hệ thống nếu có">
            <input
              type="text"
              value={questionCode}
              onChange={(e) => setQuestionCode(e.target.value)}
              placeholder="Q-001"
              disabled={pending}
              className={inputClass}
            />
          </Field>

          <Field label="Loại" required>
            <select
              value={type}
              onChange={(e) => handleTypeChange(e.target.value as QuestionType)}
              disabled={pending}
              required
              className={inputClass}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Độ khó">
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              disabled={pending}
              className={inputClass}
            >
              {DIFFICULTY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Khung chương trình" hint="Lọc câu hỏi theo Sata x khi soạn bài">
            <select
              value={curriculumId}
              onChange={(e) => setCurriculumId(e.target.value)}
              disabled={pending}
              className={inputClass}
            >
              <option value="">— Không gắn khung —</option>
              {curriculums.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          {/* Điểm số — KHÔNG phải tiền, giữ nguyên `type="number"`. */}
          <Field label="Điểm/câu" hint="Trống = dùng mặc định của đề">
            <input
              type="number"
              min={0}
              step="0.5"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              placeholder="VD: 1"
              disabled={pending}
              className={inputClass}
            />
          </Field>

          <Field label="Thời gian/câu (giây)" hint="Trống = không giới hạn riêng">
            <input
              type="number"
              min={1}
              step={1}
              value={timeLimitSec}
              onChange={(e) => setTimeLimitSec(e.target.value)}
              placeholder="VD: 60"
              disabled={pending}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Đề bài" required>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Đặt câu hỏi rõ ràng cho HS..."
            rows={4}
            required
            disabled={pending}
            className={`${inputClass} resize-y`}
          />
        </Field>

        <Field label="Ảnh đề bài (tuỳ chọn)">
          <ImageUploader
            value={imageUrl}
            onChange={setImageUrl}
            prefix="questions"
            aspect="video"
            disabled={pending}
            helperText="Ảnh minh hoạ hiển thị kèm đề bài."
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Bài học (tuỳ chọn)">
            <select
              value={lessonId}
              onChange={(e) => setLessonId(e.target.value)}
              disabled={pending}
              className={inputClass}
            >
              <option value="">— Không gắn —</option>
              {lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.curriculumName} — Bài {l.order}: {l.title}
                </option>
              ))}
            </select>
          </Field>

          <label className="flex items-center gap-2 self-end pb-2">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              disabled={pending}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm font-medium text-foreground">
              Public (chia sẻ với GV khác)
            </span>
          </label>
        </div>

        <Field label="Tags">
          <StringArrayEditor
            value={tags}
            onChange={setTags}
            placeholder="VD: loop, function, robot, motor"
          />
        </Field>
      </section>

      {/* Section 2: Choices (MC/TF) */}
      {showChoices && (
        <section className="rounded-xl border border-border bg-card p-6 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Các lựa chọn
            {/* `normal-case tracking-normal` đặt trên NỘI DUNG chứ không trên nút: tiêu đề
                đang uppercase + giãn chữ, hướng dẫn mà kế thừa thì đọc không nổi. */}
            <HelpHint className="ml-1">
              <span className="block normal-case tracking-normal">
                Tick đáp án đúng.
                {type === "MULTIPLE_CHOICE"
                  ? " Có thể chọn nhiều (đa đáp án OK)."
                  : " Đúng/Sai chỉ chọn 1."}
              </span>
            </HelpHint>
          </h2>

          {choices.map((c, idx) => (
            <div
              key={idx}
              className="rounded-lg border border-border bg-muted p-3"
            >
              <div className="flex items-start gap-2">
                <span className="w-8 pt-2 text-center font-bold text-muted-foreground">
                  {String.fromCharCode(64 + c.order)}.
                </span>
                <textarea
                  value={c.text}
                  onChange={(e) => updateChoiceText(idx, e.target.value)}
                  rows={1}
                  disabled={pending || type === "TRUE_FALSE"}
                  placeholder={
                    type === "TRUE_FALSE"
                      ? "(cố định)"
                      : `Nội dung lựa chọn ${String.fromCharCode(64 + c.order)}`
                  }
                  className="flex-1 resize-y rounded-md border border-border bg-card px-2 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-muted"
                />
                <label className="flex items-center gap-1 self-center text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={c.isCorrect}
                    onChange={(e) => toggleChoiceCorrect(idx, e.target.checked)}
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
              {type === "MULTIPLE_CHOICE" && (
                <div className="mt-2 pl-8">
                  <ImageUploader
                    value={c.imageUrl}
                    onChange={(url) => updateChoiceImage(idx, url)}
                    prefix="questions"
                    aspect="video"
                    disabled={pending}
                    helperText="Ảnh đáp án (tuỳ chọn)."
                  />
                </div>
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
        </section>
      )}

      {/* Section 2-alt: correctAnswer */}
      {showCorrectAnswer && (
        <section className="rounded-xl border border-border bg-card p-6 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            {type === "SHORT_ANSWER"
              ? "Đáp án mong đợi"
              : type === "CODE"
                ? "Code mẫu"
                : "Đáp án mẫu (gợi ý chấm)"}
            {type === "SHORT_ANSWER" && (
              <span className="ml-1 text-state-danger-ink">*</span>
            )}
            <HelpHint className="ml-1">
              <span className="block normal-case tracking-normal">
                {type === "SHORT_ANSWER"
                  ? "Hệ thống sẽ so khớp chuỗi để chấm tự động."
                  : type === "CODE"
                    ? "Code mẫu để GV tham chiếu khi chấm."
                    : "Tự luận chấm tay — đáp án mẫu chỉ là gợi ý."}
              </span>
            </HelpHint>
          </h2>
          <textarea
            value={correctAnswer}
            onChange={(e) => setCorrectAnswer(e.target.value)}
            rows={type === "CODE" ? 10 : 4}
            required={type === "SHORT_ANSWER"}
            disabled={pending}
            placeholder={
              type === "SHORT_ANSWER"
                ? "VD: 42"
                : type === "CODE"
                  ? "function solve(x) {\n  return x * 2;\n}"
                  : "Gợi ý các ý chính cần có..."
            }
            className={
              type === "CODE"
                ? "w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                : `${inputClass} resize-y`
            }
          />
        </section>
      )}

      {/* Section 3: Explanation + notes */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Giải thích & Ghi chú
        </h2>
        <Field label="Giải thích đáp án (hiển thị sau khi nộp bài)">
          <textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            rows={3}
            disabled={pending}
            placeholder="Giải thích vì sao đáp án đúng, dẫn link đến bài học liên quan..."
            className={`${inputClass} resize-y`}
          />
        </Field>
        <Field label="Ghi chú nội bộ">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            disabled={pending}
            placeholder="Note cho GV soạn đề / chấm thi"
            className={`${inputClass} resize-y`}
          />
        </Field>
      </section>

      <div className="flex flex-wrap gap-3 border-t border-border pt-5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-primary px-6 py-3 font-bold text-white shadow-md hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo câu hỏi"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/questions")}
          disabled={pending}
          className="rounded-xl border-2 border-border bg-card px-6 py-3 font-bold text-foreground hover:bg-muted"
        >
          Huỷ
        </button>
        {isEdit && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="ml-auto rounded-xl border-2 border-state-danger-soft bg-card px-6 py-3 font-bold text-state-danger-ink hover:bg-state-danger-soft"
          >
            Xoá
          </button>
        )}
      </div>
    </form>
  );
}

const inputClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  /** Hướng dẫn ngắn — ra icon "?" cạnh nhãn thay vì dòng chữ mờ dưới ô. */
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // Nút "?" nằm trong <label> vẫn an toàn: <button> là interactive content nên trình
    // duyệt KHÔNG chuyển tiếp cú bấm xuống ô nhập.
    <label className="block">
      <FieldLabel label={label} required={required} hint={hint} />
      {children}
    </label>
  );
}
