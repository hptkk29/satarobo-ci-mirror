"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createTemplateAndRedirect,
  updateTemplate,
  deleteTemplateAndRedirect,
} from "../_actions";

type Kind = "CLASSWORK" | "HOMEWORK";

interface CurriculumOption {
  id: string;
  name: string;
  version: number;
}
interface LessonOption {
  id: string;
  order: number;
  title: string;
  curriculumId: string;
  curriculumName: string;
}

export type TemplateFormValue = {
  id: string;
  title: string;
  description: string;
  instructions: string | null;
  kind: Kind;
  curriculumId: string | null;
  lessonId: string | null;
  totalPoints: number;
  allowText: boolean;
  allowFile: boolean;
};

const inputClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

export function TemplateForm({
  template,
  curricula,
  lessons,
}: {
  template?: TemplateFormValue;
  curricula: CurriculumOption[];
  lessons: LessonOption[];
}) {
  const router = useRouter();
  const isEdit = Boolean(template);

  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [instructions, setInstructions] = useState(template?.instructions ?? "");
  const [kind, setKind] = useState<Kind>(template?.kind ?? "HOMEWORK");
  const [curriculumId, setCurriculumId] = useState(template?.curriculumId ?? "");
  const [lessonId, setLessonId] = useState(template?.lessonId ?? "");
  const [totalPoints, setTotalPoints] = useState(template?.totalPoints ?? 10);
  const [allowText, setAllowText] = useState(template?.allowText ?? true);
  const [allowFile, setAllowFile] = useState(template?.allowFile ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Lọc bài học theo khung CT đã chọn (giống picker câu hỏi lọc theo curriculum).
  const visibleLessons = curriculumId
    ? lessons.filter((l) => l.curriculumId === curriculumId)
    : lessons;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      title,
      description,
      instructions: instructions.trim() || null,
      kind,
      curriculumId: curriculumId || null,
      lessonId: lessonId || null,
      totalPoints,
      allowText,
      allowFile,
    };
    startTransition(async () => {
      const res = isEdit
        ? await updateTemplate(template!.id, payload)
        : await createTemplateAndRedirect(payload);
      if (res && !res.ok) setError(res.error);
      else if (isEdit) router.refresh();
    });
  }

  function handleDelete() {
    if (!template) return;
    if (
      !confirm(
        `Xoá mẫu "${template.title}"? Các bài giao đã sinh từ mẫu này vẫn giữ nguyên nhưng mất liên kết truy vết.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteTemplateAndRedirect(template.id);
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <section className="space-y-4 rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Thông tin mẫu bài tập
        </h2>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Tiêu đề <span className="text-state-danger-ink">*</span>
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            disabled={pending}
            placeholder="VD: Mẫu bài tập Sata 4 — Vòng lặp"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Loại bài
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            disabled={pending}
            className={inputClass}
          >
            <option value="HOMEWORK">Bài tập về nhà</option>
            <option value="CLASSWORK">Bài trên lớp</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Mô tả <span className="text-state-danger-ink">*</span>
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            required
            disabled={pending}
            placeholder="Mô tả ngắn về yêu cầu bài tập"
            className={`${inputClass} resize-y`}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Hướng dẫn chi tiết
          </span>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={4}
            disabled={pending}
            placeholder="Các bước, ví dụ, tiêu chí chấm điểm..."
            className={`${inputClass} resize-y`}
          />
        </label>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-foreground">
              Khung chương trình
            </span>
            <select
              value={curriculumId}
              onChange={(e) => {
                setCurriculumId(e.target.value);
                setLessonId(""); // đổi khung CT → reset bài học cho khớp
              }}
              disabled={pending}
              className={inputClass}
            >
              <option value="">— Không gắn —</option>
              {curricula.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (v{c.version})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-foreground">
              Buổi học (tuỳ chọn)
            </span>
            <select
              value={lessonId}
              onChange={(e) => setLessonId(e.target.value)}
              disabled={pending}
              className={inputClass}
            >
              <option value="">— Không gắn —</option>
              {visibleLessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.curriculumName} — Bài {l.order}: {l.title}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block max-w-xs">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Tổng điểm <span className="text-state-danger-ink">*</span>
          </span>
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={totalPoints}
            onChange={(e) =>
              setTotalPoints(Math.max(0.1, parseFloat(e.target.value) || 10))
            }
            required
            disabled={pending}
            className={inputClass}
          />
        </label>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowText}
              onChange={(e) => setAllowText(e.target.checked)}
              disabled={pending}
              className="h-4 w-4 rounded border-border"
            />
            <span className="font-medium text-foreground">Cho phép trả lời text</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowFile}
              onChange={(e) => setAllowFile(e.target.checked)}
              disabled={pending}
              className="h-4 w-4 rounded border-border"
            />
            <span className="font-medium text-foreground">Cho phép nộp file</span>
          </label>
        </div>
      </section>

      <div className="flex flex-wrap gap-3 border-t border-border pt-5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-primary px-6 py-3 font-bold text-white shadow-md hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Đang lưu..." : isEdit ? "Lưu thay đổi" : "Tạo mẫu"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/assignments/templates")}
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
            Xoá mẫu
          </button>
        )}
      </div>
    </form>
  );
}
