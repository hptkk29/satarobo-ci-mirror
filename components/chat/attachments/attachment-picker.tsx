"use client";

// components/chat/attachments/attachment-picker.tsx — US-11 AC4 phần "ô nhập":
// nút chọn ảnh + dải xem trước có TIẾN TRÌNH và nút HUỶ cho từng ảnh.
//
// Dùng chung cho ô nhập của phụ huynh và của nhân viên — một bản, để hai bề mặt không
// trôi lệch (đúng lý do `components/chat/staff/*` được dựng dùng chung cho admin + GV).

import { useRef } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHAT_IMAGE_ACCEPT, formatFileSize } from "./rules";
import type { ChatPendingUpload } from "./use-attachment-uploads";

export function AttachmentPickerButton({
  disabled = false,
  onPick,
  className,
}: {
  disabled?: boolean;
  onPick: (files: File[]) => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={CHAT_IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Xoá value NGAY: chọn lại đúng file vừa huỷ sẽ không bắn `change` nếu value
          // còn giữ tên cũ — người dùng bấm mà "không có gì xảy ra".
          e.target.value = "";
          if (files.length > 0) onPick(files);
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        aria-label="Đính kèm ảnh"
        title="Đính kèm ảnh (JPG, PNG, WEBP — tối đa 5 ảnh)"
        className={cn(
          // ≥44px cho vùng chạm mobile 375px.
          "grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
      >
        <ImagePlus className="size-5" aria-hidden />
      </button>
    </>
  );
}

/** Dải ảnh đang chờ gửi. Không có ảnh ⇒ không chiếm chỗ. */
export function PendingUploadStrip({
  uploads,
  onCancel,
  className,
}: {
  uploads: readonly ChatPendingUpload[];
  onCancel: (localId: string) => void;
  className?: string;
}) {
  if (uploads.length === 0) return null;

  return (
    <ul className={cn("flex flex-wrap gap-2", className)}>
      {uploads.map((u) => {
        const failed = u.status === "error";
        const done = u.status === "ready";
        return (
          <li
            key={u.localId}
            className={cn(
              "relative size-16 overflow-hidden rounded-lg border bg-muted",
              failed ? "border-destructive" : "border-border",
            )}
          >
            <img
              src={u.previewUrl}
              alt={u.fileName}
              className={cn("size-full object-cover", !done && "opacity-60")}
            />

            {!done && !failed && (
              <span className="absolute inset-0 grid place-items-center bg-black/25 text-[10px] font-semibold text-white">
                {u.status === "preparing" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  `${u.progress}%`
                )}
              </span>
            )}

            {!done && !failed && (
              <span className="absolute inset-x-0 bottom-0 h-1 bg-black/30">
                <span
                  className="block h-full bg-primary transition-[width] duration-200"
                  style={{ width: `${u.progress}%` }}
                />
              </span>
            )}

            {failed && (
              <span
                title={u.errorMessage}
                className="absolute inset-0 grid place-items-center bg-destructive/70 p-1 text-center text-[9px] font-semibold leading-tight text-white"
              >
                Lỗi
              </span>
            )}

            <button
              type="button"
              onClick={() => onCancel(u.localId)}
              aria-label={`Huỷ ảnh ${u.fileName}`}
              title={`${u.fileName}${u.sizeBytes ? ` · ${formatFileSize(u.sizeBytes)}` : ""}`}
              className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
            >
              <X className="size-3" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
