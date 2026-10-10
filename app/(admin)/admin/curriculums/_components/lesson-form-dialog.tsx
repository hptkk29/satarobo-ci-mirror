"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { StringArrayEditor } from "@/app/(admin)/admin/kits/_components/string-array-editor";
import { createLesson, updateLesson } from "../_actions";

export type LessonFormValue = {
  id: string;
  curriculumId: string;
  order: number;
  title: string;
  description: string | null;
  content: string | null;
  duration: number;
  objectives: string[];
  materials: string[];
  notes: string | null;
  teacherGuide: string | null;
  expectedOutput: string | null;
  homeworkDefault: string | null;
  assessmentCriteria: string | null;
};

interface Props {
  curriculumId: string;
  lesson?: LessonFormValue;
  defaultOrder?: number;
  /** Bỏ qua khi `inline`. */
  trigger?: (open: () => void) => React.ReactNode;
  /**
   * 29/09/2026 — màn giáo trình mới: form NHÚNG trong ngăn chỉnh buổi (không lớp phủ, luôn mở).
   * Cùng form, cùng `updateLesson`/`createLesson` — chỉ khác cách hiện.
   */
  inline?: boolean;
}

export function LessonFormDialog({
  curriculumId,
  lesson,
  defaultOrder,
  trigger,
  inline = false,
}: Props) {
  const router = useRouter();
  const isEdit = Boolean(lesson);
  const [isOpen, setIsOpen] = useState(false);
  const [order, setOrder] = useState<number>(
    lesson?.order ?? defaultOrder ?? 1,
  );
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [duration, setDuration] = useState<number>(lesson?.duration ?? 90);
  const [description, setDescription] = useState(lesson?.description ?? "");
  const [content, setContent] = useState(lesson?.content ?? "");
  const [objectives, setObjectives] = useState<string[]>(lesson?.objectives ?? []);
  const [materials, setMaterials] = useState<string[]>(lesson?.materials ?? []);
  const [notes, setNotes] = useState(lesson?.notes ?? "");
  const [teacherGuide, setTeacherGuide] = useState(lesson?.teacherGuide ?? "");
  const [expectedOutput, setExpectedOutput] = useState(lesson?.expectedOutput ?? "");
  const [homeworkDefault, setHomeworkDefault] = useState(lesson?.homeworkDefault ?? "");
  const [assessmentCriteria, setAssessmentCriteria] = useState(lesson?.assessmentCriteria ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [daLuu, setDaLuu] = useState(false);

  const close = () => {
    if (pending) return;
    setIsOpen(false);
    setError(null);
  };

  const open = () => {
    setIsOpen(true);
    setError(null);
    // For "add" mode, reset to fresh defaults each time
    if (!isEdit) {
      setOrder(defaultOrder ?? 1);
      setTitle("");
      setDuration(90);
      setDescription("");
      setContent("");
      setObjectives([]);
      setMaterials([]);
      setNotes("");
      setTeacherGuide("");
      setExpectedOutput("");
      setHomeworkDefault("");
      setAssessmentCriteria("");
    }
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      curriculumId,
      title,
      order,
      duration,
      description: description.trim() || null,
      content: content.trim() || null,
      objectives,
      materials,
      notes: notes.trim() || null,
      teacherGuide: teacherGuide.trim() || null,
      expectedOutput: expectedOutput.trim() || null,
      homeworkDefault: homeworkDefault.trim() || null,
      assessmentCriteria: assessmentCriteria.trim() || null,
    };
    startTransition(async () => {
      const res = isEdit
        ? await updateLesson(lesson!.id, payload)
        : await createLesson(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (inline) setDaLuu(true);
      else setIsOpen(false);
      router.refresh();
    });
  }

  const than = (
    <>
            <h2
              id="lesson-form-title"
              className="text-lg font-bold text-foreground"
            >
              {isEdit ? `Sửa bài ${lesson!.order}` : "Thêm bài học"}
            </h2>

            {error && (
              <div className="mt-3 rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[100px_1fr_120px]">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Bài số *
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={order}
                    onChange={(e) =>
                      setOrder(Math.max(1, parseInt(e.target.value, 10) || 1))
                    }
                    required
                    disabled={pending}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Tiêu đề *
                  </span>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="VD: Giới thiệu Robot và môi trường"
                    required
                    disabled={pending}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Thời lượng (phút)
                  </span>
                  <input
                    type="number"
                    min={15}
                    step={5}
                    value={duration}
                    onChange={(e) =>
                      setDuration(Math.max(15, parseInt(e.target.value, 10) || 90))
                    }
                    disabled={pending}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Mô tả ngắn
                </span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Mô tả ngắn về buổi học (có thể hiển thị cho HS/PH)"
                  rows={2}
                  disabled={pending}
                  className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Nội dung chính
                </span>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Nội dung chi tiết (markdown OK)"
                  rows={5}
                  disabled={pending}
                  className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 font-mono"
                />
              </label>

              <div>
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Mục tiêu học tập
                </span>
                <StringArrayEditor
                  value={objectives}
                  onChange={setObjectives}
                  placeholder="VD: Hiểu cấu tạo cơ bản của robot..."
                />
              </div>

              <div>
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Thiết bị cần chuẩn bị
                </span>
                <StringArrayEditor
                  value={materials}
                  onChange={setMaterials}
                  placeholder="VD: 5 bộ kit Alpha, cảm biến siêu âm, pin sạc…"
                />
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Hướng dẫn giảng dạy (cho GV)
                </span>
                <textarea
                  value={teacherGuide}
                  onChange={(e) => setTeacherGuide(e.target.value)}
                  placeholder="Các bước lên lớp, lưu ý sư phạm, phân bổ thời gian…"
                  rows={4}
                  disabled={pending}
                  className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Kết quả mong đợi
                  </span>
                  <textarea
                    value={expectedOutput}
                    onChange={(e) => setExpectedOutput(e.target.value)}
                    placeholder="Sản phẩm/kỹ năng HS đạt được sau bài"
                    rows={3}
                    disabled={pending}
                    className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Tiêu chí đánh giá
                  </span>
                  <textarea
                    value={assessmentCriteria}
                    onChange={(e) => setAssessmentCriteria(e.target.value)}
                    placeholder="Cách chấm/đánh giá mức đạt của HS"
                    rows={3}
                    disabled={pending}
                    className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Bài tập mặc định
                </span>
                <textarea
                  value={homeworkDefault}
                  onChange={(e) => setHomeworkDefault(e.target.value)}
                  placeholder="Bài tập về nhà gợi ý cho bài này"
                  rows={2}
                  disabled={pending}
                  className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Ghi chú nội bộ (cho GV)
                </span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="VD: Chuẩn bị 5 bộ kit Alpha, kiểm tra pin trước buổi học"
                  rows={2}
                  disabled={pending}
                  className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                {!inline && (
                  <button
                    type="button"
                    onClick={close}
                    disabled={pending}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    Huỷ
                  </button>
                )}
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo bài"}
                </button>
              </div>
            </form>
    </>
  );

  if (inline) {
    return (
      <div className="relative" onChange={() => daLuu && setDaLuu(false)}>
        {than}
        {daLuu && !pending && (
          <p className="mt-2 text-right text-xs font-medium text-state-success-ink" role="status">
            Đã lưu nội dung buổi.
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      {trigger?.(open)}

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="lesson-form-title"
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-8"
          onClick={close}
        >
          <div
            className="relative w-full max-w-2xl rounded-xl bg-card p-6 shadow-xl"
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

            {than}
          </div>
        </div>
      )}
    </>
  );
}
