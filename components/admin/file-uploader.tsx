"use client";

import { useState, useRef, useCallback } from "react";
import {
  Upload,
  X,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  Archive,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  detectCategory,
  UPLOAD_CONFIG,
  UploadCategory,
  validateFile,
} from "@/lib/storage/upload-config";
import { cn } from "@/lib/utils";

export interface UploadResult {
  url: string;
  key: string;
  filename: string;
  size: number;
  mime: string;
}

interface FileUploaderProps {
  acceptedCategories?: UploadCategory[];
  showPreview?: boolean;
  multiple?: boolean;
  onUploaded?: (result: UploadResult) => void;
  onError?: (error: string) => void;
  className?: string;
}

type UploadState = "idle" | "validating" | "signing" | "uploading" | "done" | "error";

interface UploadProgress {
  id: string;
  file: File;
  state: UploadState;
  progress: number;
  url?: string;
  error?: string;
}

const CATEGORY_ICONS = {
  image: ImageIcon,
  document: FileText,
  video: Video,
  audio: Music,
  archive: Archive,
};

export function FileUploader({
  acceptedCategories,
  showPreview = true,
  multiple = false,
  onUploaded,
  onError,
  className,
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const allowedCategories =
    acceptedCategories ?? (Object.keys(UPLOAD_CONFIG) as UploadCategory[]);

  const acceptAttr = allowedCategories
    .flatMap((cat) => UPLOAD_CONFIG[cat].allowedExtensions)
    .join(",");

  const handleFiles = useCallback(
    async (files: FileList) => {
      const filesToProcess = multiple ? Array.from(files) : [files[0]];

      for (const file of filesToProcess) {
        if (!file) continue;
        const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const category = detectCategory(file.type);
        if (!category) {
          const err = `Loại file không hỗ trợ: ${file.type || "unknown"}`;
          setUploads((prev) => [
            ...prev,
            { id, file, state: "error", progress: 0, error: err },
          ]);
          onError?.(err);
          continue;
        }

        if (!allowedCategories.includes(category)) {
          const err = `Loại file ${category} không được phép tại đây`;
          setUploads((prev) => [
            ...prev,
            { id, file, state: "error", progress: 0, error: err },
          ]);
          onError?.(err);
          continue;
        }

        const validationError = validateFile(category, file.name, file.type, file.size);
        if (validationError) {
          setUploads((prev) => [
            ...prev,
            { id, file, state: "error", progress: 0, error: validationError },
          ]);
          onError?.(validationError);
          continue;
        }

        setUploads((prev) => [...prev, { id, file, state: "signing", progress: 0 }]);

        try {
          const signRes = await fetch("/api/admin/upload-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              category,
              filename: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
            }),
          });

          if (!signRes.ok) {
            const errData = (await signRes.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(errData.error || `Server error: ${signRes.status}`);
          }

          const { uploadUrl, publicUrl, key } = (await signRes.json()) as {
            uploadUrl: string;
            publicUrl: string;
            key: string;
          };

          setUploads((prev) =>
            prev.map((u) => (u.id === id ? { ...u, state: "uploading", progress: 0 } : u)),
          );

          await uploadWithProgress(uploadUrl, file, (pct) => {
            setUploads((prev) =>
              prev.map((u) => (u.id === id ? { ...u, progress: pct } : u)),
            );
          });

          setUploads((prev) =>
            prev.map((u) =>
              u.id === id ? { ...u, state: "done", progress: 100, url: publicUrl } : u,
            ),
          );

          onUploaded?.({
            url: publicUrl,
            key,
            filename: file.name,
            size: file.size,
            mime: file.type,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Upload thất bại";
          setUploads((prev) =>
            prev.map((u) => (u.id === id ? { ...u, state: "error", error: errMsg } : u)),
          );
          onError?.(errMsg);
        }
      }

      if (inputRef.current) inputRef.current.value = "";
    },
    [allowedCategories, multiple, onUploaded, onError],
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      handleFiles(e.target.files);
    }
  };

  const removeUpload = (id: string) => {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
          isDragging
            ? "border-primary bg-primary-soft"
            : "border-border hover:border-border hover:bg-muted",
        )}
      >
        <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm font-medium">
          Kéo thả file vào đây, hoặc{" "}
          <span className="text-primary">click để chọn</span>
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          {allowedCategories.map((cat) => UPLOAD_CONFIG[cat].description).join(" • ")}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={acceptAttr}
          multiple={multiple}
          onChange={handleSelect}
          className="hidden"
        />
      </div>

      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((upload) => {
            const category = detectCategory(upload.file.type) ?? "document";
            const Icon = CATEGORY_ICONS[category];

            return (
              <div
                key={upload.id}
                className="border rounded-lg p-3 flex items-center gap-3 bg-card"
              >
                {showPreview &&
                category === "image" &&
                upload.state === "done" &&
                upload.url ? (
                  <img
                    src={upload.url}
                    alt={upload.file.name}
                    className="w-12 h-12 object-cover rounded"
                  />
                ) : (
                  <Icon className="w-10 h-10 text-muted-foreground shrink-0" />
                )}

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{upload.file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(upload.file.size / 1024 / 1024).toFixed(2)} MB
                    {upload.state === "uploading" && ` · ${upload.progress}%`}
                  </p>
                  {upload.state === "error" && (
                    <p className="text-xs text-state-danger-ink mt-1">{upload.error}</p>
                  )}
                  {upload.state === "done" && upload.url && (
                    <a
                      href={upload.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-state-info-ink truncate block hover:underline"
                    >
                      {upload.url}
                    </a>
                  )}
                </div>

                {(upload.state === "signing" || upload.state === "uploading") && (
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                )}
                {upload.state === "done" && (
                  <span className="text-xs text-state-success-ink font-medium">✓ Xong</span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeUpload(upload.id);
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Fetch API không hỗ trợ progress upload. Dùng XHR để có progress event.
function uploadWithProgress(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        onProgress(pct);
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

    xhr.send(file);
  });
}
