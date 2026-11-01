"use client";

// components/assignments/question-view.tsx — hiển thị MỘT câu hỏi kèm đáp án đúng
// (parity site GV 18/08, port từ satarobo-ui-giaovien question-view.tsx, nhánh
// xem-trước). Dùng chung cho preview kho GV, thư viện admin và dialog giao bài.
// Chỉ hiển thị — không sửa, không nhận bài làm.
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  QUESTION_TYPE_META,
  type ContentQuestion,
} from "@/lib/assignments/question-content";

export function QuestionView({
  question,
  index,
}: {
  question: ContentQuestion;
  index: number;
}) {
  return (
    <li className="list-none rounded-xl border border-border p-3.5">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            Câu {index + 1}. {question.question}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[11px] text-muted-foreground">
          {QUESTION_TYPE_META[question.type].label}
        </Badge>
      </div>

      <QuestionBody question={question} />
    </li>
  );
}

const CORRECT_CHIP =
  "border-state-success-soft bg-state-success-soft text-state-success-ink dark:border-state-success";

function QuestionBody({ question }: { question: ContentQuestion }) {
  switch (question.type) {
    case "single":
      return (
        <ul className="space-y-1.5">
          {question.options.map((opt, j) => (
            <ChoiceOption
              key={j}
              letter={String.fromCharCode(65 + j)}
              text={opt}
              isCorrect={j === question.correctIndex}
            />
          ))}
        </ul>
      );
    case "multiple":
      return (
        <ul className="space-y-1.5">
          {question.options.map((opt, j) => (
            <ChoiceOption
              key={j}
              letter={String.fromCharCode(65 + j)}
              text={opt}
              isCorrect={question.correctIndices.includes(j)}
            />
          ))}
        </ul>
      );
    case "boolean":
      return (
        <div className="flex gap-2">
          {[true, false].map((v) => {
            const isCorrect = question.correct === v;
            return (
              <span
                key={String(v)}
                className={cn(
                  "rounded-lg border px-4 py-1.5 text-sm font-semibold",
                  isCorrect ? CORRECT_CHIP : "border-border text-foreground",
                )}
              >
                {v ? "Đúng" : "Sai"}
                {isCorrect && <span className="ml-1.5 text-xs">✓ đúng</span>}
              </span>
            );
          })}
        </div>
      );
    case "fill":
      return (
        <div className="space-y-1.5">
          {question.answers.map((ans, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs font-semibold text-muted-foreground">
                Chỗ {i + 1}:
              </span>
              <span
                className={cn("rounded-md border px-2 py-0.5 font-semibold", CORRECT_CHIP)}
              >
                {ans || "(chưa có đáp án)"}
              </span>
            </div>
          ))}
        </div>
      );
    case "short":
    case "essay":
      return (
        <div className="space-y-2">
          {question.sampleAnswer ? (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">
                {question.type === "essay" ? "Đáp án mẫu / thang chấm" : "Đáp án gợi ý"}
              </p>
              <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap text-muted-foreground">
                {question.sampleAnswer}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Học viên trả lời tự do — giáo viên chấm tay.
            </p>
          )}
        </div>
      );
    case "matching":
      return (
        <ul className="space-y-1.5">
          {question.pairs.map((pair, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-md border border-border bg-card px-2.5 py-1 font-medium text-foreground">
                {pair.left}
              </span>
              <span className="text-muted-foreground">→</span>
              <span className={cn("rounded-md border px-2.5 py-1 font-medium", CORRECT_CHIP)}>
                {pair.right}
              </span>
            </li>
          ))}
        </ul>
      );
    case "ordering":
      return (
        <ol className="space-y-1.5">
          {question.items.map((item, pos) => (
            <li key={pos} className="flex items-center gap-2 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
                {pos + 1}
              </span>
              <span className="rounded-md border border-border bg-card px-2.5 py-1 font-medium text-foreground">
                {item}
              </span>
            </li>
          ))}
        </ol>
      );
  }
}

/** Một dòng đáp án trắc nghiệm ở chế độ xem — đáp án đúng tô xanh. */
function ChoiceOption({
  letter,
  text,
  isCorrect,
}: {
  letter: string;
  text: string;
  isCorrect: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm",
        isCorrect ? cn("font-semibold", CORRECT_CHIP) : "border-border text-foreground",
      )}
    >
      <span className="w-4 shrink-0 text-xs font-bold text-muted-foreground">{letter}</span>
      <span className="flex-1">{text}</span>
      {isCorrect && <span className="shrink-0 text-xs">Đáp án đúng</span>}
    </li>
  );
}
