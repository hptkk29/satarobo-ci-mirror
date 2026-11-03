"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CurriculumStatus } from "@prisma/client";
import {
  createCurriculumAndRedirect,
  updateCurriculum,
  deleteCurriculumAndRedirect,
} from "../_actions";

interface CourseOption {
  id: string;
  name: string;
}

// T5.3 — chỉ còn 2 trạng thái: Nháp / Đang dùng (enum DB đã rút gọn tương ứng).
const STATUS_LABEL: Record<CurriculumStatus, string> = {
  DRAFT: "Nháp",
  ACTIVE: "Đang dùng",
};

export type CurriculumFormValue = {
  id: string;
  courseId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  status: CurriculumStatus;
};

export function CurriculumForm({
  curriculum,
  courses,
}: {
  curriculum?: CurriculumFormValue;
  courses: CourseOption[];
}) {
  const router = useRouter();
  const isEdit = Boolean(curriculum);
  const [courseId, setCourseId] = useState(curriculum?.courseId ?? "");
  const [name, setName] = useState(curriculum?.name ?? "");
  const [description, setDescription] = useState(curriculum?.description ?? "");
  const [isActive, setIsActive] = useState(curriculum?.isActive ?? true);
  const [status, setStatus] = useState<CurriculumStatus>(curriculum?.status ?? "ACTIVE");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // T5.2 — KHÔNG gửi `version`: server giữ bản hiện tại (sửa) / tự tăng (tạo mới).
    const payload = {
      courseId,
      name,
      description: description.trim() || null,
      isActive,
      status,
    };
    startTransition(async () => {
      const res = isEdit
        ? await updateCurriculum(curriculum!.id, payload)
        : await createCurriculumAndRedirect(payload);
      if (res && !res.ok) setError(res.error);
      else if (isEdit) router.refresh();
    });
  }

  function handleDelete() {
    if (!curriculum) return;
    if (
      !confirm(
        `Xoá giáo trình "${curriculum.name}"? Hành động này không thể hoàn tác.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteCurriculumAndRedirect(curriculum.id);
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-border bg-card p-6"
    >
      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      {/* T5.2 — ô "Version" đã bỏ: hệ thống tự đánh bản (ẩn) cho từng khoá. */}
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-foreground">
          Khoá học <span className="text-state-danger-ink">*</span>
        </span>
        <select
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          required
          disabled={pending}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        >
          <option value="">— Chọn khoá học —</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-foreground">
          Tên giáo trình <span className="text-state-danger-ink">*</span>
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="VD: Lập trình Robot K1 v1.0"
          required
          disabled={pending}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-foreground">
          Mô tả
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Mô tả ngắn về giáo trình, mục tiêu tổng thể, đối tượng..."
          rows={3}
          disabled={pending}
          className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </label>

      <label className="block sm:max-w-xs">
        <span className="mb-1 block text-sm font-semibold text-foreground">
          Trạng thái giáo trình
        </span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as CurriculumStatus)}
          disabled={pending}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        >
          {(Object.keys(STATUS_LABEL) as CurriculumStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          disabled={pending}
          className="h-4 w-4 rounded border-border"
        />
        <span className="font-medium text-foreground">
          Đang sử dụng (lớp mới sẽ dùng giáo trình này)
        </span>
      </label>

      <div className="flex flex-wrap gap-3 border-t border-border pt-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-primary px-6 py-2.5 font-bold text-white shadow-md hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo giáo trình"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/curriculums")}
          disabled={pending}
          className="rounded-xl border-2 border-border bg-card px-6 py-2.5 font-bold text-foreground hover:bg-muted"
        >
          Huỷ
        </button>
        {isEdit && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="ml-auto rounded-xl border-2 border-state-danger-soft bg-card px-6 py-2.5 font-bold text-state-danger-ink hover:bg-state-danger-soft"
          >
            Xoá
          </button>
        )}
      </div>
    </form>
  );
}
