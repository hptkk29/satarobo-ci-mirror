"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { createSession, updateSession } from "../_actions";

export type SessionFormValue = {
  id: string;
  classId: string;
  date: Date;
  topic: string | null;
  notes: string | null;
  lessonId: string | null;
  lessonNotes: string | null;
  sessionCategoryId: string | null;
};

export interface ClassOption {
  id: string;
  name: string;
  courseId: string;
  courseName: string;
  centerName: string | null;
}

/** Phân loại buổi đang dùng — nguồn ở `SessionCategory`, khai tại /cham-cong/phan-loai-buoi. */
export interface SessionCategoryOption {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface LessonOption {
  id: string;
  order: number;
  title: string;
  curriculumName: string;
  courseId: string;
}

interface Props {
  session?: SessionFormValue;
  classes: ClassOption[];
  lessons?: LessonOption[];
  categories?: SessionCategoryOption[];
  defaultClassId?: string;
  /** QA 20/07 Vấn đề C — URL quay về sau khi lưu/huỷ (giữ bộ lọc trang danh sách). */
  returnTo?: string;
}

function toDateTimeLocal(d: Date | null): string {
  if (!d) return "";
  const date = new Date(d);
  // datetime-local expects "YYYY-MM-DDTHH:mm" in local time
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate()) +
    "T" +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes())
  );
}

export function SessionForm({
  session,
  classes,
  lessons = [],
  categories = [],
  defaultClassId,
  returnTo,
}: Props) {
  const router = useRouter();
  const isEdit = Boolean(session);
  // Chống open-redirect: chỉ nhận đường dẫn nội bộ về trang danh sách buổi học.
  const backUrl = returnTo && returnTo.startsWith("/sessions") ? returnTo : "/sessions";
  const [error, setError] = useState<string | null>(null);
  const [classId, setClassId] = useState<string>(
    session?.classId ?? defaultClassId ?? "",
  );
  const [lessonId, setLessonId] = useState<string>(session?.lessonId ?? "");

  const macDinh = categories.find((c) => c.isDefault) ?? null;

  const selectedCourseId = useMemo(() => {
    const cls = classes.find((c) => c.id === classId);
    return cls?.courseId ?? null;
  }, [classes, classId]);

  const availableLessons = useMemo(() => {
    if (!selectedCourseId) return [];
    return lessons.filter((l) => l.courseId === selectedCourseId);
  }, [lessons, selectedCourseId]);

  function onClassChange(value: string) {
    setClassId(value);
    // If the selected lesson is no longer valid for the new class, clear it.
    const cls = classes.find((c) => c.id === value);
    if (!cls) {
      setLessonId("");
      return;
    }
    const stillValid = lessons.some(
      (l) => l.id === lessonId && l.courseId === cls.courseId,
    );
    if (!stillValid) setLessonId("");
  }

  async function action(formData: FormData) {
    setError(null);
    const res = isEdit
      ? await updateSession(session!.id, formData)
      : await createSession(formData);
    if (res?.error) {
      setError(res.error);
      return;
    }
    // QA 20/07 Vấn đề C/D — toast thành công + quay về đúng bộ lọc trước đó.
    toast.success(isEdit ? "Đã cập nhật buổi học" : "Đã tạo buổi học mới");
    router.push(backUrl);
  }

  return (
    <form action={action} className="max-w-3xl space-y-6">
      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <Section title="Thông tin buổi học">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Lớp <span className="ml-1 text-state-danger-ink">*</span>
          </span>
          <select
            name="classId"
            value={classId}
            onChange={(e) => onClassChange(e.target.value)}
            required
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">— Chọn lớp —</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.courseName}
                {c.centerName && ` · ${c.centerName}`}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Thời gian (ngày + giờ) <span className="ml-1 text-state-danger-ink">*</span>
          </span>
          <input
            type="datetime-local"
            name="date"
            defaultValue={toDateTimeLocal(session?.date ?? null)}
            required
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Chọn ngày + giờ bắt đầu buổi học. Giờ kết thúc tính theo khung giờ của lớp.
          </p>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">Chủ đề buổi học</span>
          <input
            type="text"
            name="topic"
            defaultValue={session?.topic ?? ""}
            placeholder="Vd: Buổi 5 — Điều khiển động cơ servo"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>

        {categories.length > 0 && (
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-foreground">Phân loại buổi</span>
            <select
              name="sessionCategoryId"
              defaultValue={session?.sessionCategoryId ?? ""}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="">
                — Chưa phân loại{macDinh ? ` (tính như ${macDinh.name})` : ""} —
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Quyết định buổi này ăn hệ số công dạy nào (SR.QD.230 PL03 §4 — Workshop và Sự kiện
              120%, lớp Coach 100%). Không chọn thì tính như buổi học chính thức.
            </p>
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Bài học trong giáo trình
          </span>
          <select
            name="lessonId"
            value={lessonId}
            onChange={(e) => setLessonId(e.target.value)}
            disabled={!classId}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-muted"
          >
            <option value="">
              {classId
                ? "— Không gắn (buổi ôn tập, thi, sự kiện) —"
                : "— Chọn lớp trước —"}
            </option>
            {availableLessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.curriculumName} — Bài {l.order}: {l.title}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Gắn bài học từ giáo trình active của khoá. Buổi không gắn vẫn được
            tính vào điểm danh, nhưng không cộng vào "lesson coverage".
          </p>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Ghi chú riêng buổi này (vs template bài học)
          </span>
          <textarea
            name="lessonNotes"
            rows={2}
            defaultValue={session?.lessonNotes ?? ""}
            placeholder="VD: HS làm chậm phần motor — tuần sau ôn lại"
            className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">Ghi chú</span>
          <textarea
            name="notes"
            rows={4}
            defaultValue={session?.notes ?? ""}
            placeholder="Mục tiêu, tài liệu, bài tập về nhà..."
            className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
      </Section>

      <div className="flex gap-3 border-t border-border pt-6">
        <SubmitButton isEdit={isEdit} />
        <button
          type="button"
          onClick={() => router.push(backUrl)}
          className="rounded-xl border-2 border-border bg-card px-6 py-3 font-bold text-foreground hover:bg-muted"
        >
          Huỷ
        </button>
      </div>
    </form>
  );
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl bg-primary px-6 py-3 font-bold text-white shadow-md hover:bg-primary-dark disabled:opacity-60"
    >
      {pending ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo buổi học"}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-foreground">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
