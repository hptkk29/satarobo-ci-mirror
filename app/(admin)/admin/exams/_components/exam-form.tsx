"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createExamAndRedirect,
  updateExam,
  deleteExamAndRedirect,
} from "../_actions";

type ExamStatus = "DRAFT" | "PUBLISHED" | "CLOSED" | "ARCHIVED";

interface ClassOption {
  id: string;
  name: string;
  classCode: string | null;
}
interface LessonOption {
  id: string;
  order: number;
  title: string;
  curriculumName: string;
}

type ScoringMode = "HIGHEST" | "LATEST" | "AVERAGE" | "FIRST";

export type ExamFormValue = {
  id: string;
  examCode: string | null;
  title: string;
  description: string | null;
  classId: string | null;
  lessonId: string | null;
  durationMinutes: number;
  totalPoints: number;
  passingScore: number;
  shuffleQuestions: boolean;
  shuffleChoices: boolean;
  maxAttempts: number | null;
  defaultDueDays: number | null;
  scoringMode: ScoringMode | null;
  showResultAfterSubmit: boolean;
  openAt: Date | null;
  closeAt: Date | null;
  status: ExamStatus;
};

const SCORING_MODE_OPTIONS: { value: ScoringMode; label: string }[] = [
  { value: "HIGHEST", label: "Lấy điểm cao nhất" },
  { value: "LATEST", label: "Lấy lần làm gần nhất" },
  { value: "AVERAGE", label: "Trung bình các lần" },
  { value: "FIRST", label: "Lấy lần làm đầu tiên" },
];

const STATUS_OPTIONS: { value: ExamStatus; label: string }[] = [
  { value: "DRAFT", label: "Đang soạn" },
  { value: "PUBLISHED", label: "Đã publish" },
  { value: "CLOSED", label: "Đóng" },
  { value: "ARCHIVED", label: "Lưu trữ" },
];

function toDateTimeInput(d: Date | null): string {
  if (!d) return "";
  // Format YYYY-MM-DDTHH:mm
  const date = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ExamForm({
  exam,
  classes,
  lessons,
}: {
  exam?: ExamFormValue;
  classes: ClassOption[];
  lessons: LessonOption[];
}) {
  const router = useRouter();
  const isEdit = Boolean(exam);

  const [examCode, setExamCode] = useState(exam?.examCode ?? "");
  const [title, setTitle] = useState(exam?.title ?? "");
  const [description, setDescription] = useState(exam?.description ?? "");
  const [classId, setClassId] = useState(exam?.classId ?? "");
  const [lessonId, setLessonId] = useState(exam?.lessonId ?? "");
  const [durationMinutes, setDurationMinutes] = useState(
    exam?.durationMinutes ?? 60,
  );
  const [totalPoints, setTotalPoints] = useState(exam?.totalPoints ?? 10);
  const [passingScore, setPassingScore] = useState(exam?.passingScore ?? 5);
  const [shuffleQuestions, setShuffleQuestions] = useState(
    exam?.shuffleQuestions ?? false,
  );
  const [shuffleChoices, setShuffleChoices] = useState(
    exam?.shuffleChoices ?? false,
  );
  const [maxAttempts, setMaxAttempts] = useState(
    exam?.maxAttempts != null ? String(exam.maxAttempts) : "",
  );
  const [defaultDueDays, setDefaultDueDays] = useState(
    exam?.defaultDueDays != null ? String(exam.defaultDueDays) : "",
  );
  const [scoringMode, setScoringMode] = useState<ScoringMode | "">(
    exam?.scoringMode ?? "",
  );
  const [showResultAfterSubmit, setShowResultAfterSubmit] = useState(
    exam?.showResultAfterSubmit ?? true,
  );
  const [openAt, setOpenAt] = useState(toDateTimeInput(exam?.openAt ?? null));
  const [closeAt, setCloseAt] = useState(toDateTimeInput(exam?.closeAt ?? null));
  const [status, setStatus] = useState<ExamStatus>(exam?.status ?? "DRAFT");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      examCode: examCode.trim() || null,
      title,
      description: description.trim() || null,
      classId: classId || null,
      lessonId: lessonId || null,
      durationMinutes,
      totalPoints,
      passingScore,
      shuffleQuestions,
      shuffleChoices,
      maxAttempts: maxAttempts === "" ? null : Number(maxAttempts),
      defaultDueDays: defaultDueDays === "" ? null : Number(defaultDueDays),
      scoringMode: scoringMode === "" ? null : scoringMode,
      showResultAfterSubmit,
      openAt: openAt ? new Date(openAt) : null,
      closeAt: closeAt ? new Date(closeAt) : null,
      status,
    };
    startTransition(async () => {
      const res = isEdit
        ? await updateExam(exam!.id, payload)
        : await createExamAndRedirect(payload);
      if (res && !res.ok) setError(res.error);
      else if (isEdit) router.refresh();
    });
  }

  function handleDelete() {
    if (!exam) return;
    if (!confirm(`Xoá đề "${exam.title}"? Không thể hoàn tác.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteExamAndRedirect(exam.id);
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-5">
      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Thông tin đề thi
        </h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Mã đề">
            <input
              type="text"
              value={examCode}
              onChange={(e) => setExamCode(e.target.value)}
              placeholder="E-2026-001"
              disabled={pending}
              className={inputClass}
            />
          </Field>
          <Field label="Trạng thái" required>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ExamStatus)}
              disabled={pending}
              required
              className={inputClass}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Thời lượng (phút)" required>
            <input
              type="number"
              min={5}
              value={durationMinutes}
              onChange={(e) =>
                setDurationMinutes(Math.max(5, parseInt(e.target.value, 10) || 60))
              }
              disabled={pending}
              required
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Tiêu đề" required>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Kiểm tra giữa kỳ 1 — Lập trình Robot"
            required
            disabled={pending}
            className={inputClass}
          />
        </Field>

        <Field label="Mô tả">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Nội dung kiểm tra, phạm vi, ghi chú..."
            disabled={pending}
            className={`${inputClass} resize-y`}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Lớp học (tuỳ chọn)">
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              disabled={pending}
              className={inputClass}
            >
              <option value="">— Không gắn —</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.classCode ? `${c.classCode} · ` : ""}
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
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
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Cấu hình thang điểm
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Tổng điểm" required>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={totalPoints}
              onChange={(e) =>
                setTotalPoints(Math.max(0.1, parseFloat(e.target.value) || 10))
              }
              disabled={pending}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Điểm đạt" required>
            <input
              type="number"
              min={0}
              step={0.1}
              value={passingScore}
              onChange={(e) =>
                setPassingScore(Math.max(0, parseFloat(e.target.value) || 0))
              }
              disabled={pending}
              required
              className={inputClass}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={shuffleQuestions}
              onChange={(e) => setShuffleQuestions(e.target.checked)}
              disabled={pending}
              className="h-4 w-4 rounded border-border"
            />
            <span className="font-medium text-foreground">Trộn thứ tự câu hỏi</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={shuffleChoices}
              onChange={(e) => setShuffleChoices(e.target.checked)}
              disabled={pending}
              className="h-4 w-4 rounded border-border"
            />
            <span className="font-medium text-foreground">
              Trộn lựa chọn (MC/TF)
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Cấu hình làm bài (R7-13)
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Số lần làm tối đa">
            <input
              type="number"
              min={1}
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(e.target.value)}
              placeholder="Không giới hạn"
              disabled={pending}
              className={inputClass}
            />
          </Field>
          <Field label="Hạn nộp mặc định (ngày)">
            <input
              type="number"
              min={0}
              value={defaultDueDays}
              onChange={(e) => setDefaultDueDays(e.target.value)}
              placeholder="Không đặt"
              disabled={pending}
              className={inputClass}
            />
          </Field>
          <Field label="Cách tính điểm khi làm nhiều lần">
            <select
              value={scoringMode}
              onChange={(e) => setScoringMode(e.target.value as ScoringMode | "")}
              disabled={pending}
              className={inputClass}
            >
              <option value="">— Mặc định —</option>
              {SCORING_MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showResultAfterSubmit}
            onChange={(e) => setShowResultAfterSubmit(e.target.checked)}
            disabled={pending}
            className="h-4 w-4 rounded border-border"
          />
          <span className="font-medium text-foreground">
            Hiển thị kết quả ngay sau khi nộp bài
          </span>
        </label>
      </section>

      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Thời gian mở đề (tuỳ chọn)
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Mở từ">
            <input
              type="datetime-local"
              value={openAt}
              onChange={(e) => setOpenAt(e.target.value)}
              disabled={pending}
              className={inputClass}
            />
          </Field>
          <Field label="Đóng đến">
            <input
              type="datetime-local"
              value={closeAt}
              onChange={(e) => setCloseAt(e.target.value)}
              disabled={pending}
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      <div className="flex flex-wrap gap-3 border-t border-border pt-5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-primary px-6 py-3 font-bold text-white shadow-md hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo & mở Builder"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/exams")}
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
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-foreground">
        {label}
        {required && <span className="ml-1 text-state-danger-ink">*</span>}
      </span>
      {children}
    </label>
  );
}
