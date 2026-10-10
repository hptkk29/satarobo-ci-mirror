"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UploadCloud } from "lucide-react";
import {
  createScormPackage,
  confirmUpload,
  processScormNow,
} from "@/app/(admin)/admin/scorm/_actions";

/** Upload zip qua presigned PUT với progress (XHR). Reject khi lỗi mạng/HTTP. */
function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/zip");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload thất bại (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error("Lỗi mạng khi upload"));
    xhr.send(file);
  });
}

/**
 * R2-LMS-3 — Upload giáo án SCORM INLINE ngay trong editor buổi giáo trình (không cần
 * rời sang /admin/scorm). Tái dùng pipeline createScormPackage → PUT presigned →
 * confirmUpload → processScormNow (giống ScormManager). Giải nén xong tự PHÁT HÀNH +
 * ĐẶT ĐANG DÙNG + thay giáo án cũ của buổi. Gate ngoài: training:manage + flag SCORM.
 */
export function LessonScormUpload({ lessonId }: { lessonId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  async function handleUpload() {
    // T5.1 — bỏ ô "tên gói": server tự đặt tên theo buổi/tệp (createScormPackage).
    if (!file) return toast.error("Chọn tệp .zip");

    setUploading(true);
    setProgress(0);
    try {
      const created = await createScormPackage({
        lessonId,
        fileName: file.name,
        mimeType: file.type || "application/zip",
        sizeBytes: file.size,
      });
      if (!created.ok) {
        toast.error(created.error);
        return;
      }
      await putWithProgress(created.data!.uploadUrl, file, setProgress);
      const confirmed = await confirmUpload(created.data!.id);
      if (!confirmed.ok) {
        toast.error(confirmed.error);
        return;
      }
      // Giải nén ngay → tự phát hành + thay giáo án cũ của buổi (cron là fallback).
      await processScormNow(created.data!.id);
      toast.success("Đã đẩy giáo án — đang xử lý & thay bản cũ (nếu có)");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lỗi upload");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-dashed border-border bg-card p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          disabled={uploading}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="min-w-0 flex-1 text-xs text-muted-foreground file:mr-2 file:rounded file:border-0 file:bg-primary-soft file:px-2 file:py-1 file:text-xs file:font-medium file:text-primary"
        />
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
        >
          <UploadCloud className="h-3.5 w-3.5" /> {uploading ? "Đang tải…" : "Tải gói SCORM"}
        </button>
      </div>
      {uploading && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
