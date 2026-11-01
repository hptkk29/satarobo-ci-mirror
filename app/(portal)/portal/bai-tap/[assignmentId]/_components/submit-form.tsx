"use client";

// BGĐ 31/07 — nộp bài NHIỀU file+ảnh (trước: 1 file). Upload qua widget dùng chung
// (presign /api/portal/upload-url → PUT R2). 2-phase: server vẫn ghi cột đơn = file đầu.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AttachmentUpload,
  type UploadedFile,
} from "@/components/assignments/attachment-upload";
import { submitAssignment } from "../../actions";

export function SubmitForm({
  assignmentId,
  allowText,
  allowFile,
  initialText,
  initialFiles,
  graded,
}: {
  assignmentId: string;
  allowText: boolean;
  allowFile: boolean;
  initialText: string | null;
  initialFiles: UploadedFile[];
  graded: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText ?? "");
  const [files, setFiles] = useState<UploadedFile[]>(initialFiles);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (allowText && !text.trim() && files.length === 0) {
      toast.error("Nhập nội dung hoặc đính kèm file");
      return;
    }
    if (!allowText && files.length === 0) {
      toast.error("Vui lòng đính kèm file bài làm");
      return;
    }
    startTransition(async () => {
      const res = await submitAssignment({
        assignmentId,
        textAnswer: allowText ? text : null,
        files: files.map((f) => ({
          fileUrl: f.url,
          fileName: f.name,
          fileSize: f.size || null,
          mimeType: f.mime || null,
        })),
      });
      if (res.ok) {
        toast.success(
          res.status === "LATE" ? "Đã nộp (trễ hạn)" : "Đã nộp bài",
        );
        router.refresh();
      } else {
        toast.error(res.error ?? "Nộp bài thất bại");
      }
    });
  }

  if (graded) {
    return (
      <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
        Bài đã được chấm — không thể nộp lại.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {allowText && (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="Nhập câu trả lời / mô tả bài làm…"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none"
        />
      )}

      {allowFile && (
        <AttachmentUpload
          value={files}
          onChange={setFiles}
          endpoint="/api/portal/upload-url"
          maxFiles={5}
          disabled={pending}
          label="Đính kèm ảnh / tài liệu bài làm"
        />
      )}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-lg bg-orange-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-60"
      >
        {pending ? "Đang nộp…" : "Nộp bài"}
      </button>
    </div>
  );
}
