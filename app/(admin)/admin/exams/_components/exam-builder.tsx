"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  addQuestionToExam,
  autoGenerateExamQuestions,
  removeQuestionFromExam,
  reorderExamQuestions,
  updateExamQuestionPoints,
} from "../_actions";

type QuestionType =
  | "MULTIPLE_CHOICE"
  | "TRUE_FALSE"
  | "SHORT_ANSWER"
  | "ESSAY"
  | "CODE"
  // Parity site GV 18/08 — loại mới soạn ở kho GV/thư viện mẫu (hiển thị được trong bank).
  | "FILL_BLANK"
  | "MATCHING"
  | "ORDERING";
type Difficulty = "EASY" | "MEDIUM" | "HARD" | "EXPERT";

export interface QuestionBankItem {
  id: string;
  type: QuestionType;
  text: string;
  difficulty: Difficulty;
  tags: string[];
  lessonTitle: string | null;
}

export interface SelectedExamQuestion {
  id: string;
  questionId: string;
  order: number;
  points: number;
  type: QuestionType;
  text: string;
  difficulty: Difficulty;
}

interface LessonOption {
  id: string;
  order: number;
  title: string;
  curriculumName: string;
}

const TYPE_LABEL: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: "TN",
  TRUE_FALSE: "Đ/S",
  SHORT_ANSWER: "Trả lời ngắn",
  ESSAY: "Tự luận",
  CODE: "Code",
  FILL_BLANK: "Điền khuyết",
  MATCHING: "Ghép cặp",
  ORDERING: "Sắp xếp",
};

const TYPE_COLOR: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: "bg-state-info-soft text-state-info-ink",
  TRUE_FALSE: "bg-state-success-soft text-state-success-ink",
  SHORT_ANSWER: "bg-state-warning-soft text-state-warning-ink",
  ESSAY: "bg-primary-soft text-primary",
  CODE: "bg-muted text-foreground",
  FILL_BLANK: "bg-state-info-soft text-state-info-ink",
  MATCHING: "bg-state-success-soft text-state-success-ink",
  ORDERING: "bg-state-warning-soft text-state-warning-ink",
};

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  EASY: "Dễ",
  MEDIUM: "TB",
  HARD: "Khó",
  EXPERT: "Chuyên gia",
};

export function ExamBuilder({
  examId,
  bank,
  initialSelected,
  lessons,
}: {
  examId: string;
  bank: QuestionBankItem[];
  initialSelected: SelectedExamQuestion[];
  lessons: LessonOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<SelectedExamQuestion[]>(initialSelected);

  // Như document-picker: thêm câu hỏi gán id giả `temp-<questionId>`, không đồng bộ lại
  // thì danh sách đứng im tới khi F5 và bấm xoá/sửa điểm ngay sau khi thêm sẽ gọi server
  // bằng id giả → lỗi. Nhận id thật khi refresh() trả prop mới.
  useEffect(() => {
    setSelected(initialSelected);
  }, [initialSelected]);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<QuestionType | "">("");
  const [filterDifficulty, setFilterDifficulty] = useState<Difficulty | "">("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [autoGenOpen, setAutoGenOpen] = useState(false);

  const selectedIds = useMemo(
    () => new Set(selected.map((s) => s.questionId)),
    [selected],
  );

  const filteredBank = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bank.filter((b) => {
      if (selectedIds.has(b.id)) return false;
      if (filterType && b.type !== filterType) return false;
      if (filterDifficulty && b.difficulty !== filterDifficulty) return false;
      if (q && !b.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [bank, selectedIds, filterType, filterDifficulty, search]);

  const totalPoints = useMemo(
    () => selected.reduce((sum, s) => sum + (s.points || 0), 0),
    [selected],
  );

  function refresh() {
    router.refresh();
  }

  function handleAdd(question: QuestionBankItem) {
    setError(null);
    startTransition(async () => {
      const res = await addQuestionToExam({
        examId,
        questionId: question.id,
        points: 1,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Optimistic add
      setSelected((prev) => [
        ...prev,
        {
          id: `temp-${question.id}`,
          questionId: question.id,
          order: prev.length + 1,
          points: 1,
          type: question.type,
          text: question.text,
          difficulty: question.difficulty,
        },
      ]);
      refresh();
    });
  }

  function handleRemove(examQuestionId: string, idx: number) {
    setError(null);
    startTransition(async () => {
      const res = await removeQuestionFromExam(examQuestionId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSelected((prev) =>
        prev
          .filter((_, i) => i !== idx)
          .map((s, i) => ({ ...s, order: i + 1 })),
      );
      refresh();
    });
  }

  function handlePointsChange(idx: number, value: string) {
    const num = parseFloat(value);
    if (!Number.isFinite(num) || num < 0) return;
    setSelected((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, points: num } : s)),
    );
  }

  function handlePointsBlur(idx: number) {
    const item = selected[idx];
    if (!item) return;
    startTransition(async () => {
      const res = await updateExamQuestionPoints(item.id, item.points);
      if (!res.ok) setError(res.error);
    });
  }

  function handleMove(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= selected.length) return;
    const next = [...selected];
    [next[idx], next[j]] = [next[j], next[idx]];
    const renumbered = next.map((s, i) => ({ ...s, order: i + 1 }));
    setSelected(renumbered);

    setError(null);
    startTransition(async () => {
      const res = await reorderExamQuestions({
        examId,
        examQuestionIds: renumbered.map((s) => s.id),
      });
      if (!res.ok) {
        setError(res.error);
        setSelected(initialSelected);
        return;
      }
      refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          <strong>{selected.length}</strong> câu · Tổng điểm hiện tại:{" "}
          <strong>{totalPoints.toFixed(1)}</strong>
        </div>
        <button
          type="button"
          onClick={() => setAutoGenOpen(true)}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary bg-card px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary-soft disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4" />
          Auto-generate từ ngân hàng
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Left: bank picker */}
        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border p-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Ngân hàng câu hỏi ({filteredBank.length})
            </h3>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm nội dung..."
                className="sm:col-span-3 rounded-md border border-border px-2.5 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as QuestionType | "")}
                className="rounded-md border border-border px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
              >
                <option value="">Mọi loại</option>
                {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <select
                value={filterDifficulty}
                onChange={(e) =>
                  setFilterDifficulty(e.target.value as Difficulty | "")
                }
                className="rounded-md border border-border px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
              >
                <option value="">Mọi độ khó</option>
                {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((d) => (
                  <option key={d} value={d}>
                    {DIFFICULTY_LABEL[d]}
                  </option>
                ))}
              </select>
            </div>
          </header>
          <div className="max-h-[600px] overflow-y-auto divide-y divide-border">
            {filteredBank.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Không có câu hỏi phù hợp.
              </div>
            ) : (
              filteredBank.map((b) => (
                <div key={b.id} className="flex items-start gap-2 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TYPE_COLOR[b.type]}`}
                      >
                        {TYPE_LABEL[b.type]}
                      </span>
                      <span className="text-[10px] font-semibold text-muted-foreground">
                        {DIFFICULTY_LABEL[b.difficulty]}
                      </span>
                      {b.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="inline-flex rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                    <div className="mt-1 text-sm text-foreground line-clamp-2">
                      {b.text}
                    </div>
                    {b.lessonTitle && (
                      <div className="text-[10px] text-muted-foreground">
                        Bài: {b.lessonTitle}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAdd(b)}
                    disabled={pending}
                    className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3 inline" /> Thêm
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Right: selected questions */}
        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border p-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Câu hỏi trong đề ({selected.length})
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Chỉnh điểm, sắp xếp thứ tự, hoặc xoá câu hỏi.
            </p>
          </header>
          <div className="max-h-[600px] overflow-y-auto divide-y divide-border">
            {selected.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Chưa có câu hỏi. Thêm từ ngân hàng bên trái hoặc dùng Auto-generate.
              </div>
            ) : (
              selected.map((s, idx) => (
                <div key={s.id} className="flex items-start gap-2 p-3">
                  <span className="w-8 pt-1 text-center font-bold tabular-nums text-muted-foreground">
                    {s.order}.
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TYPE_COLOR[s.type]}`}
                      >
                        {TYPE_LABEL[s.type]}
                      </span>
                      <span className="text-[10px] font-semibold text-muted-foreground">
                        {DIFFICULTY_LABEL[s.difficulty]}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-foreground line-clamp-2">
                      {s.text}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <label className="flex items-center gap-1 text-xs font-semibold text-foreground">
                      Điểm:
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={s.points}
                        onChange={(e) => handlePointsChange(idx, e.target.value)}
                        onBlur={() => handlePointsBlur(idx)}
                        disabled={pending}
                        className="w-16 rounded border border-border px-1 py-0.5 text-xs text-right"
                      />
                    </label>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => handleMove(idx, -1)}
                        disabled={pending || idx === 0}
                        aria-label="Lên"
                        className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMove(idx, 1)}
                        disabled={pending || idx === selected.length - 1}
                        aria-label="Xuống"
                        className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemove(s.id, idx)}
                        disabled={pending}
                        aria-label="Xoá"
                        className="rounded p-1 text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {autoGenOpen && (
        <AutoGenerateModal
          examId={examId}
          lessons={lessons}
          onClose={() => setAutoGenOpen(false)}
          onSuccess={() => {
            setAutoGenOpen(false);
            refresh();
          }}
          onError={(msg) => setError(msg)}
        />
      )}
    </div>
  );
}

function AutoGenerateModal({
  examId,
  lessons,
  onClose,
  onSuccess,
  onError,
}: {
  examId: string;
  lessons: LessonOption[];
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [lessonId, setLessonId] = useState("");
  const [type, setType] = useState<QuestionType | "">("");
  const [difficulty, setDifficulty] = useState<Difficulty | "">("");
  const [tagsText, setTagsText] = useState("");
  const [count, setCount] = useState(5);
  const [defaultPoints, setDefaultPoints] = useState(1);
  const [pending, startTransition] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);

  function close() {
    if (pending) return;
    onClose();
  }

  function handleSubmit() {
    setLocalError(null);
    const tags = tagsText
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    startTransition(async () => {
      const res = await autoGenerateExamQuestions({
        examId,
        lessonId: lessonId || null,
        type: type || null,
        difficulty: difficulty || null,
        tags,
        count,
        defaultPoints,
      });
      if (!res.ok) {
        setLocalError(res.error);
        onError(res.error);
        return;
      }
      onSuccess();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={close}
    >
      <div
        className="relative w-full max-w-md rounded-xl bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Đóng"
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <Sparkles className="h-5 w-5 text-primary" />
          Auto-generate câu hỏi
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Random N câu từ ngân hàng (chỉ chọn câu Public, chưa có trong đề).
        </p>

        {localError && (
          <div className="mt-3 rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
            {localError}
          </div>
        )}

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-foreground">
              Bài học
            </span>
            <select
              value={lessonId}
              onChange={(e) => setLessonId(e.target.value)}
              disabled={pending}
              className={modalInputClass}
            >
              <option value="">— Mọi bài —</option>
              {lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.curriculumName} — Bài {l.order}: {l.title}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-foreground">
                Loại
              </span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as QuestionType | "")}
                disabled={pending}
                className={modalInputClass}
              >
                <option value="">— Mọi loại —</option>
                <option value="MULTIPLE_CHOICE">Trắc nghiệm</option>
                <option value="TRUE_FALSE">Đúng/Sai</option>
                <option value="SHORT_ANSWER">Trả lời ngắn</option>
                <option value="ESSAY">Tự luận</option>
                <option value="CODE">Code</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-foreground">
                Độ khó
              </span>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty | "")}
                disabled={pending}
                className={modalInputClass}
              >
                <option value="">— Mọi —</option>
                <option value="EASY">Dễ</option>
                <option value="MEDIUM">TB</option>
                <option value="HARD">Khó</option>
                <option value="EXPERT">Chuyên gia</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-foreground">
              Tags (cách ,)
            </span>
            <input
              type="text"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="loop, function, robot"
              disabled={pending}
              className={modalInputClass}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-foreground">
                Số câu cần lấy *
              </span>
              <input
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) =>
                  setCount(Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)))
                }
                disabled={pending}
                className={modalInputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-foreground">
                Điểm mỗi câu
              </span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={defaultPoints}
                onChange={(e) =>
                  setDefaultPoints(Math.max(0, parseFloat(e.target.value) || 1))
                }
                disabled={pending}
                className={modalInputClass}
              />
            </label>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={pending}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {pending ? "Đang lấy..." : `Lấy ${count} câu`}
          </button>
        </div>
      </div>
    </div>
  );
}

const modalInputClass =
  "w-full rounded-md border border-border px-2 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
