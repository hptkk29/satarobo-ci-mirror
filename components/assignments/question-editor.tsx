"use client";

// components/assignments/question-editor.tsx — bộ soạn câu hỏi 8 loại (parity site
// GV 18/08, port từ satarobo-ui-giaovien create-assignment-dialog.tsx). Dùng chung
// cho dialog "Tạo bài tập" của GV và form thư viện mẫu của admin/Đào tạo.
//
// Component KHÔNG giữ state — nhận `questions` + `onChange` từ form cha; validate
// tổng thể (validateQuestion/cleanQuestion) do form cha gọi trước khi submit.
import {
  Plus,
  Trash2,
  CheckCircle2,
  CircleDot,
  ListChecks,
  ToggleLeft,
  TextCursorInput,
  MessageSquare,
  AlignLeft,
  ArrowLeftRight,
  ArrowDownUp,
  ArrowUp,
  ArrowDown,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  MAX_OPTIONS,
  MAX_QUESTIONS,
  QUESTION_TYPE_META,
  QUESTION_TYPE_ORDER,
  blankQuestion,
  countBlanks,
  isAutoGraded,
  type ContentQuestion,
  type ContentQuestionType,
  type SingleChoiceQuestion,
  type MultipleChoiceQuestion,
  type BooleanQuestion,
  type FillBlankQuestion,
  type ShortAnswerQuestion,
  type EssayQuestion,
  type MatchingQuestion,
  type OrderingQuestion,
} from "@/lib/assignments/question-content";

/** Biểu tượng gợi nhớ cho từng loại câu hỏi. */
const TYPE_ICON: Record<ContentQuestionType, React.ElementType> = {
  single: CircleDot,
  multiple: ListChecks,
  boolean: ToggleLeft,
  fill: TextCursorInput,
  short: MessageSquare,
  essay: AlignLeft,
  matching: ArrowLeftRight,
  ordering: ArrowDownUp,
};

let uid = 0;
/** Id cục bộ cho câu hỏi mới soạn (server sinh id thật khi lưu). */
export const newQuestionId = () =>
  `q_${Date.now().toString(36)}_${(uid++).toString(36)}`;

const inputCls =
  "w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Danh sách câu hỏi của một đầu bài: đếm chấm tự động/chấm tay, thêm/xoá/di
 * chuyển/đổi loại từng câu, editor riêng theo loại.
 */
export function QuestionListEditor({
  questions,
  onChange,
}: {
  questions: ContentQuestion[];
  onChange: (next: ContentQuestion[]) => void;
}) {
  const updateQuestion = (idx: number, next: ContentQuestion) =>
    onChange(questions.map((q, i) => (i === idx ? next : q)));

  const changeType = (idx: number, type: ContentQuestionType) =>
    onChange(
      questions.map((q, i) =>
        i === idx ? { ...blankQuestion(type, q.id), question: q.question } : q,
      ),
    );

  const addQuestion = () => {
    if (questions.length >= MAX_QUESTIONS) return;
    onChange([...questions, blankQuestion("single", newQuestionId())]);
  };

  const removeQuestion = (idx: number) =>
    onChange(questions.length === 1 ? questions : questions.filter((_, i) => i !== idx));

  const moveQuestion = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= questions.length) return;
    const copy = [...questions];
    [copy[idx], copy[j]] = [copy[j], copy[idx]];
    onChange(copy);
  };

  const autoCount = questions.filter((q) => isAutoGraded(q.type)).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">
            Câu hỏi ({questions.length})
          </p>
          <p className="text-xs text-muted-foreground">
            {autoCount} câu chấm tự động · {questions.length - autoCount} câu chấm tay
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={addQuestion}
          disabled={questions.length >= MAX_QUESTIONS}
        >
          <Plus className="h-4 w-4" aria-hidden /> Thêm câu hỏi
        </Button>
      </div>

      {questions.map((q, idx) => (
        <QuestionCard
          key={q.id}
          question={q}
          index={idx}
          total={questions.length}
          onChange={(next) => updateQuestion(idx, next)}
          onChangeType={(type) => changeType(idx, type)}
          onRemove={() => removeQuestion(idx)}
          onMove={(dir) => moveQuestion(idx, dir)}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Thẻ một câu hỏi: ô chọn loại + đề + phần soạn riêng theo loại        *
 * ------------------------------------------------------------------ */

function QuestionCard({
  question,
  index,
  total,
  onChange,
  onChangeType,
  onRemove,
  onMove,
}: {
  question: ContentQuestion;
  index: number;
  total: number;
  onChange: (next: ContentQuestion) => void;
  onChangeType: (type: ContentQuestionType) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const meta = QUESTION_TYPE_META[question.type];

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3.5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          {index + 1}
        </span>

        <Select
          value={question.type}
          onValueChange={(v) => {
            if (v !== null) onChangeType(v as ContentQuestionType);
          }}
        >
          <SelectTrigger className="w-auto min-w-[10rem] gap-2">
            <SelectValue>
              {(v: string | null) => {
                const t = (v ?? "single") as ContentQuestionType;
                const TIcon = TYPE_ICON[t];
                return (
                  <span className="flex items-center gap-2">
                    <TIcon className="h-4 w-4" aria-hidden />
                    {QUESTION_TYPE_META[t].label}
                  </span>
                );
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {QUESTION_TYPE_ORDER.map((t) => {
              const TIcon = TYPE_ICON[t];
              return (
                <SelectItem key={t} value={t}>
                  <span className="flex items-center gap-2">
                    <TIcon className="h-4 w-4" aria-hidden />
                    {QUESTION_TYPE_META[t].label}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={`Đưa câu ${index + 1} lên trên`}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label={`Đưa câu ${index + 1} xuống dưới`}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ArrowDown className="h-4 w-4" aria-hidden />
          </button>
          {total > 1 && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Xoá câu ${index + 1}`}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-state-danger-soft hover:text-state-danger-ink"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <textarea
        value={question.question}
        onChange={(e) => onChange({ ...question, question: e.target.value })}
        rows={2}
        placeholder={
          question.type === "fill"
            ? "Đề bài — dùng ______ cho mỗi chỗ trống. VD: HTML là viết tắt của ______"
            : `Nội dung câu hỏi. ${meta.hint}`
        }
        className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="mt-2.5">
        <QuestionTypeEditor question={question} onChange={onChange} />
      </div>
    </div>
  );
}

function QuestionTypeEditor({
  question,
  onChange,
}: {
  question: ContentQuestion;
  onChange: (next: ContentQuestion) => void;
}) {
  switch (question.type) {
    case "single":
      return <SingleEditor q={question} onChange={onChange} />;
    case "multiple":
      return <MultipleEditor q={question} onChange={onChange} />;
    case "boolean":
      return <BooleanEditor q={question} onChange={onChange} />;
    case "fill":
      return <FillEditor q={question} onChange={onChange} />;
    case "short":
      return <ShortEditor q={question} onChange={onChange} />;
    case "essay":
      return <EssayEditor q={question} onChange={onChange} />;
    case "matching":
      return <MatchingEditor q={question} onChange={onChange} />;
    case "ordering":
      return <OrderingEditor q={question} onChange={onChange} />;
  }
}

/* --------------------------- Trắc nghiệm 1 đáp án -------------------------- */

function SingleEditor({
  q,
  onChange,
}: {
  q: SingleChoiceQuestion;
  onChange: (next: SingleChoiceQuestion) => void;
}) {
  const setOption = (i: number, value: string) =>
    onChange({ ...q, options: q.options.map((o, j) => (j === i ? value : o)) });
  const addOption = () => onChange({ ...q, options: [...q.options, ""] });
  const removeOption = (i: number) => {
    const options = q.options.filter((_, j) => j !== i);
    let correctIndex = q.correctIndex;
    if (i === q.correctIndex) correctIndex = 0;
    else if (i < q.correctIndex) correctIndex -= 1;
    onChange({ ...q, options, correctIndex });
  };

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        Bấm vòng tròn để chọn đáp án đúng
      </p>
      <div className="space-y-1.5">
        {q.options.map((opt, i) => (
          <OptionRow
            key={i}
            letter={String.fromCharCode(65 + i)}
            value={opt}
            correct={q.correctIndex === i}
            onValue={(v) => setOption(i, v)}
            onPick={() => onChange({ ...q, correctIndex: i })}
            onRemove={q.options.length > 2 ? () => removeOption(i) : undefined}
            pickShape="radio"
          />
        ))}
      </div>
      {q.options.length < MAX_OPTIONS && <AddOptionButton onClick={addOption} />}
    </div>
  );
}

/* -------------------------- Trắc nghiệm nhiều đáp án ------------------------ */

function MultipleEditor({
  q,
  onChange,
}: {
  q: MultipleChoiceQuestion;
  onChange: (next: MultipleChoiceQuestion) => void;
}) {
  const setOption = (i: number, value: string) =>
    onChange({ ...q, options: q.options.map((o, j) => (j === i ? value : o)) });
  const toggleCorrect = (i: number) =>
    onChange({
      ...q,
      correctIndices: q.correctIndices.includes(i)
        ? q.correctIndices.filter((x) => x !== i)
        : [...q.correctIndices, i],
    });
  const addOption = () => onChange({ ...q, options: [...q.options, ""] });
  const removeOption = (i: number) =>
    onChange({
      ...q,
      options: q.options.filter((_, j) => j !== i),
      correctIndices: q.correctIndices
        .filter((x) => x !== i)
        .map((x) => (x > i ? x - 1 : x)),
    });

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        Bấm ô vuông để đánh dấu các đáp án đúng (có thể chọn nhiều)
      </p>
      <div className="space-y-1.5">
        {q.options.map((opt, i) => (
          <OptionRow
            key={i}
            letter={String.fromCharCode(65 + i)}
            value={opt}
            correct={q.correctIndices.includes(i)}
            onValue={(v) => setOption(i, v)}
            onPick={() => toggleCorrect(i)}
            onRemove={q.options.length > 2 ? () => removeOption(i) : undefined}
            pickShape="checkbox"
          />
        ))}
      </div>
      {q.options.length < MAX_OPTIONS && <AddOptionButton onClick={addOption} />}
    </div>
  );
}

/* -------------------------------- Đúng / Sai ------------------------------ */

function BooleanEditor({
  q,
  onChange,
}: {
  q: BooleanQuestion;
  onChange: (next: BooleanQuestion) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Đáp án đúng</p>
      <Segmented
        options={[
          { value: "true", label: "Đúng" },
          { value: "false", label: "Sai" },
        ]}
        value={String(q.correct)}
        onChange={(v) => onChange({ ...q, correct: v === "true" })}
      />
    </div>
  );
}

/* ----------------------------- Điền vào chỗ trống -------------------------- */

function FillEditor({
  q,
  onChange,
}: {
  q: FillBlankQuestion;
  onChange: (next: FillBlankQuestion) => void;
}) {
  const count = countBlanks(q.question);
  const setAnswer = (i: number, value: string) => {
    const answers = Array.from({ length: count }, (_, j) => q.answers[j] ?? "");
    answers[i] = value;
    onChange({ ...q, answers });
  };

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        Đáp án đúng cho từng chỗ trống ({count} chỗ)
      </p>
      <div className="space-y-1.5">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs font-semibold text-muted-foreground">
              Chỗ {i + 1}
            </span>
            <input
              value={q.answers[i] ?? ""}
              onChange={(e) => setAnswer(i, e.target.value)}
              placeholder={`Đáp án cho chỗ trống ${i + 1}`}
              className={inputCls}
            />
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Chấm tự động, không phân biệt hoa/thường và khoảng trắng đầu cuối.
      </p>
    </div>
  );
}

/* ------------------------------- Trả lời ngắn ----------------------------- */

function ShortEditor({
  q,
  onChange,
}: {
  q: ShortAnswerQuestion;
  onChange: (next: ShortAnswerQuestion) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        Đáp án gợi ý (không bắt buộc — dùng để đối chiếu khi chấm tay)
      </p>
      <input
        value={q.sampleAnswer ?? ""}
        onChange={(e) => onChange({ ...q, sampleAnswer: e.target.value })}
        placeholder="VD: AI là trí tuệ nhân tạo..."
        className={inputCls}
      />
      <ManualNote />
    </div>
  );
}

/* --------------------------------- Tự luận -------------------------------- */

function EssayEditor({
  q,
  onChange,
}: {
  q: EssayQuestion;
  onChange: (next: EssayQuestion) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        Đáp án mẫu / thang chấm (không bắt buộc)
      </p>
      <textarea
        value={q.sampleAnswer ?? ""}
        onChange={(e) => onChange({ ...q, sampleAnswer: e.target.value })}
        rows={3}
        placeholder="Ý chính cần có, tiêu chí cho điểm..."
        className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <ManualNote />
    </div>
  );
}

/* --------------------------------- Ghép cặp ------------------------------- */

function MatchingEditor({
  q,
  onChange,
}: {
  q: MatchingQuestion;
  onChange: (next: MatchingQuestion) => void;
}) {
  const setPair = (i: number, side: "left" | "right", value: string) =>
    onChange({
      ...q,
      pairs: q.pairs.map((p, j) => (j === i ? { ...p, [side]: value } : p)),
    });
  const addPair = () => onChange({ ...q, pairs: [...q.pairs, { left: "", right: "" }] });
  const removePair = (i: number) =>
    onChange({ ...q, pairs: q.pairs.filter((_, j) => j !== i) });

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        Nhập các cặp đúng. Khi làm bài, vế phải sẽ được xáo trộn cho học viên ghép.
      </p>
      <div className="space-y-1.5">
        {q.pairs.map((pair, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={pair.left}
              onChange={(e) => setPair(i, "left", e.target.value)}
              placeholder={`Vế trái ${i + 1}`}
              className={inputCls}
            />
            <ArrowLeftRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              value={pair.right}
              onChange={(e) => setPair(i, "right", e.target.value)}
              placeholder={`Vế phải ${i + 1}`}
              className={inputCls}
            />
            {q.pairs.length > 2 && (
              <button
                type="button"
                onClick={() => removePair(i)}
                aria-label={`Xoá cặp ${i + 1}`}
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-state-danger-soft hover:text-state-danger-ink"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
        ))}
      </div>
      {q.pairs.length < MAX_OPTIONS && (
        <AddOptionButton label="+ Thêm cặp" onClick={addPair} />
      )}
    </div>
  );
}

/* ----------------------------- Sắp xếp thứ tự ----------------------------- */

function OrderingEditor({
  q,
  onChange,
}: {
  q: OrderingQuestion;
  onChange: (next: OrderingQuestion) => void;
}) {
  const setItem = (i: number, value: string) =>
    onChange({ ...q, items: q.items.map((it, j) => (j === i ? value : it)) });
  const addItem = () => onChange({ ...q, items: [...q.items, ""] });
  const removeItem = (i: number) =>
    onChange({ ...q, items: q.items.filter((_, j) => j !== i) });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= q.items.length) return;
    const items = [...q.items];
    [items[i], items[j]] = [items[j], items[i]];
    onChange({ ...q, items });
  };

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        Nhập các mục theo ĐÚNG thứ tự. Khi làm bài, học viên sẽ thấy chúng bị xáo trộn.
      </p>
      <div className="space-y-1.5">
        {q.items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-card text-xs font-bold text-muted-foreground ring-1 ring-border">
              {i + 1}
            </span>
            <input
              value={item}
              onChange={(e) => setItem(i, e.target.value)}
              placeholder={`Mục thứ ${i + 1}`}
              className={inputCls}
            />
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`Đưa mục ${i + 1} lên`}
                className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === q.items.length - 1}
                aria-label={`Đưa mục ${i + 1} xuống`}
                className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden />
              </button>
              {q.items.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  aria-label={`Xoá mục ${i + 1}`}
                  className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-state-danger-soft hover:text-state-danger-ink"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {q.items.length < MAX_OPTIONS && (
        <AddOptionButton label="+ Thêm mục" onClick={addItem} />
      )}
    </div>
  );
}

/* --------------------------- Mảnh dùng lại chung -------------------------- */

/** Một dòng đáp án của trắc nghiệm: nút chọn đúng + chữ cái + ô nhập + xoá. */
function OptionRow({
  letter,
  value,
  correct,
  onValue,
  onPick,
  onRemove,
  pickShape,
}: {
  letter: string;
  value: string;
  correct: boolean;
  onValue: (v: string) => void;
  onPick: () => void;
  onRemove?: () => void;
  pickShape: "radio" | "checkbox";
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onPick}
        aria-label={`Đánh dấu đáp án ${letter} là đúng`}
        aria-pressed={correct}
        className={cn(
          "shrink-0 transition-colors",
          correct
            ? "text-state-success-ink"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {pickShape === "radio" ? (
          <CheckCircle2 className="h-5 w-5" aria-hidden />
        ) : (
          <span
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-[6px] border-2",
              correct
                ? "border-state-success bg-state-success text-white"
                : "border-muted-foreground/50",
            )}
          >
            {correct && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />}
          </span>
        )}
      </button>
      <span className="w-4 shrink-0 text-xs font-bold text-muted-foreground">{letter}</span>
      <input
        value={value}
        onChange={(e) => onValue(e.target.value)}
        placeholder={`Đáp án ${letter}`}
        className={cn(
          "w-full rounded-lg border bg-card px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
          correct ? "border-state-success dark:border-state-success" : "border-border",
        )}
      />
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Xoá đáp án ${letter}`}
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-state-danger-soft hover:text-state-danger-ink"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

function AddOptionButton({
  onClick,
  label = "+ Thêm đáp án",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 text-xs font-semibold text-primary-ink hover:text-primary-ink-hover"
    >
      {label}
    </button>
  );
}

function ManualNote() {
  return (
    <p className="mt-1.5 text-xs text-muted-foreground">
      Câu này giáo viên chấm tay khi xem bài làm.
    </p>
  );
}

/** Nhóm nút gạt 2-3 phương án (Bài tập/Kiểm tra, Đúng/Sai...). */
export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; icon?: React.ElementType }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
      {options.map((o) => {
        const Icon = o.icon;
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {Icon && <Icon className="h-4 w-4" aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
