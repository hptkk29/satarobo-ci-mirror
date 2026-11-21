"use client";

// BGĐ 31/07 — widget upload NHIỀU file+ảnh dùng chung cho bài tập:
// GV đính kèm khi soạn đề/giao bài (endpoint admin) · HV nộp bài (endpoint portal).
// Presign → PUT thẳng R2 (không qua server). shadcn thuần — dùng được cả admin/teacher/portal.
import { useRef, useState } from "react";
import { Upload, Loader2, FileText, ImageIcon, X } from "lucide-react";
import { toast } from "sonner";
import { detectCategory, validateFile } from "@/lib/storage/upload-config";

export type UploadedFile = {
  url: string;
  name: string;
  size: number;
  mime: string;
};

export function AttachmentUpload({
  value,
  onChange,
  endpoint = "/api/admin/upload-url",
  maxFiles = 5,
  disabled = false,
  label = "Đính kèm ảnh / tài liệu",
}: {
  value: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  /** "/api/admin/upload-url" (GV/admin) hoặc "/api/portal/upload-url" (PH). */
  endpoint?: string;
  maxFiles?: number;
  disabled?: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function uploadOne(f: File): Promise<UploadedFile | null> {
    const category = detectCategory(f.type);
    if (!category || (category !== "image" && category !== "document")) {
      toast.error(`${f.name}: chỉ nhận ảnh hoặc tài liệu (PDF/Word…)`);
      return null;
    }
    const err = validateFile(category, f.name, f.type, f.size);
    if (err) {
      toast.error(`${f.name}: ${err}`);
      return null;
    }
    const signRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, filename: f.name, mimeType: f.type, sizeBytes: f.size }),
    });
    if (!signRes.ok) {
      const d = (await signRes.json().catch(() => ({}))) as { error?: string };
      toast.error(`${f.name}: ${d.error || "Không tạo được link tải lên"}`);
      return null;
    }
    const { uploadUrl, publicUrl } = (await signRes.json()) as {
      uploadUrl: string;
      publicUrl: string;
    };
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": f.type },
      body: f,
    });
    if (!put.ok) {
      toast.error(`${f.name}: tải lên thất bại`);
      return null;
    }
    return { url: publicUrl, name: f.name, size: f.size, mime: f.type };
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (picked.length === 0) return;
    const room = maxFiles - value.length;
    if (room <= 0) {
      toast.error(`Tối đa ${maxFiles} tệp`);
      return;
    }
    setUploading(true);
    try {
      const done: UploadedFile[] = [];
      for (const f of picked.slice(0, room)) {
        const up = await uploadOne(f);
        if (up) done.push(up);
      }
      if (picked.length > room) toast.error(`Chỉ nhận thêm ${room} tệp (tối đa ${maxFiles})`);
      if (done.length > 0) onChange([...value, ...done]);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="space-y-1.5">
          {value.map((f, i) => (
            <li
              key={`${f.url}-${i}`}
              className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-2 text-sm dark:border-border dark:bg-muted/40"
            >
              {f.mime.startsWith("image/") ? (
                <ImageIcon className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
              ) : (
                <FileText className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
              )}
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate hover:underline"
              >
                {f.name}
              </a>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                  className="shrink-0 text-neutral-400 hover:text-red-500"
                  aria-label={`Xoá ${f.name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!disabled && value.length < maxFiles && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 p-3 text-sm text-neutral-500 hover:border-orange-400 hover:bg-orange-50 disabled:opacity-60 dark:border-border dark:hover:bg-muted/40"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? "Đang tải lên…" : `${label} (${value.length}/${maxFiles})`}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
        onChange={onPick}
        className="hidden"
      />
    </div>
  );
}
