"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DocumentUploader, type UploadedFile } from "@/components/admin/DocumentUploader";
import { StringArrayEditor } from "@/app/(admin)/admin/kits/_components/string-array-editor";
import {
  createDocumentAndRedirect,
  deleteDocumentAndRedirect,
  updateDocument,
} from "../_actions";

interface LessonOption {
  id: string;
  order: number;
  title: string;
  curriculumName: string;
}

export type DocumentFormValue = {
  id: string;
  documentCode: string | null;
  title: string;
  description: string | null;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string | null;
  lessonId: string | null;
  isPublic: boolean;
  tags: string[];
  notes: string | null;
};

export function DocumentForm({
  document,
  lessons,
}: {
  document?: DocumentFormValue;
  lessons: LessonOption[];
}) {
  const router = useRouter();
  const isEdit = Boolean(document);

  const [file, setFile] = useState<UploadedFile | null>(
    document
      ? {
          url: document.fileUrl,
          fileName: document.fileName,
          fileSize: document.fileSize,
          mimeType: document.mimeType ?? "",
        }
      : null,
  );
  const [documentCode, setDocumentCode] = useState(document?.documentCode ?? "");
  const [title, setTitle] = useState(document?.title ?? "");
  const [description, setDescription] = useState(document?.description ?? "");
  const [lessonId, setLessonId] = useState(document?.lessonId ?? "");
  const [isPublic, setIsPublic] = useState(document?.isPublic ?? false);
  const [tags, setTags] = useState<string[]>(document?.tags ?? []);
  const [notes, setNotes] = useState(document?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Auto-fill title from file name once on new uploads (only when title is empty).
  // QA 20/07 — nhớ giá trị auto-fill: khi user focus mà tiêu đề VẪN là tên file
  // tự điền thì bôi đen toàn bộ, gõ là THAY THẾ (trước đây gõ bị nối chuỗi
  // "qa-test-documentQA Test...").
  const [autoTitle, setAutoTitle] = useState<string | null>(null);
  useEffect(() => {
    if (!title && file?.fileName) {
      const base = file.fileName.replace(/\.[^.]+$/, "");
      setTitle(base);
      setAutoTitle(base);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.fileName]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Cần upload file trước khi lưu");
      return;
    }
    const payload = {
      documentCode: documentCode.trim() || null,
      title,
      description: description.trim() || null,
      fileUrl: file.url,
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType || null,
      lessonId: lessonId || null,
      isPublic,
      tags,
      notes: notes.trim() || null,
    };
    startTransition(async () => {
      const res = isEdit
        ? await updateDocument(document!.id, payload)
        : await createDocumentAndRedirect(payload);
      if (res && !res.ok) setError(res.error);
      else if (isEdit) router.refresh();
    });
  }

  function handleDelete() {
    if (!document) return;
    if (
      !confirm(
        `Xoá tài liệu "${document.title}"? File trên R2 vẫn còn (cleanup defer).`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteDocumentAndRedirect(document.id);
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
          File
        </h2>
        <DocumentUploader
          value={file}
          onChange={setFile}
          disabled={pending}
          helperText="Hỗ trợ PDF, Word, Excel, PowerPoint, Image, Video (≤500MB), Audio (≤50MB)."
        />
      </section>

      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Thông tin tài liệu
        </h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm font-semibold text-foreground">
              Tiêu đề <span className="text-state-danger-ink">*</span>
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={(e) => {
                if (autoTitle && title === autoTitle) e.currentTarget.select();
              }}
              required
              disabled={pending}
              placeholder="VD: Slide bài 1 — Giới thiệu Robot"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-foreground">
              Mã tài liệu
            </span>
            <input
              type="text"
              value={documentCode}
              onChange={(e) => setDocumentCode(e.target.value)}
              disabled={pending}
              placeholder="DOC-001"
              className={inputClass}
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Mô tả
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            disabled={pending}
            placeholder="Mô tả ngắn, nội dung tóm tắt, đối tượng..."
            className={`${inputClass} resize-y`}
          />
        </label>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-foreground">
              Bài học (tuỳ chọn)
            </span>
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
          </label>
          <label className="flex items-center gap-2 self-end pb-2">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              disabled={pending}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm font-medium text-foreground">
              Public (HS/PH xem được)
            </span>
          </label>
        </div>

        <div>
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Tags
          </span>
          <StringArrayEditor
            value={tags}
            onChange={setTags}
            placeholder="VD: robotics, lesson-1, homework"
          />
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Ghi chú nội bộ
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            disabled={pending}
            placeholder="Note cho GV/admin (không hiển thị HS/PH)"
            className={`${inputClass} resize-y`}
          />
        </label>
      </section>

      <div className="flex flex-wrap gap-3 border-t border-border pt-5">
        <button
          type="submit"
          disabled={pending || !file}
          className="rounded-xl bg-primary px-6 py-3 font-bold text-white shadow-md hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo tài liệu"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/documents")}
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
