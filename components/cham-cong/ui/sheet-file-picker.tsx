"use client";

// components/cham-cong/ui/sheet-file-picker.tsx — ô chọn file Sheet (.xlsx) cho Import và Đối soát.
//
// Vì sao file này tồn tại: hai màn đó đang dùng `<input type="file">` trần, nên file sai đuôi hoặc
// file 40MB chỉ vỡ ở BƯỚC SAU (server đọc lỗi) — người nhập không biết mình chọn nhầm. Ô này chặn
// ngay tại chỗ và luôn `onChange(null)` khi chặn, để nút "Đọc file" không cầm file rác.
//
// Ô nhập là `sr-only`, KHÔNG `hidden`: `hidden`/`display:none` làm input rơi khỏi thứ tự tab và
// một số trình duyệt bỏ qua `focus()` ⇒ bàn phím không chọn được file.
import { useId, useRef, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";

function sizeLabel(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export function SheetFilePicker({
  id,
  file,
  onChange,
  accept = ".xlsx",
  maxMb = 2,
  disabled = false,
  label = "Chọn file Sheet (.xlsx)",
  hint,
  className,
}: {
  id: string;
  file: File | null;
  onChange: (file: File | null) => void;
  accept?: string;
  maxMb?: number;
  disabled?: boolean;
  label?: string;
  hint?: string;
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const base = useId();
  const errorId = `${base}-err`;
  const hintId = `${base}-hint`;

  function pick(next: File | null) {
    // Chọn lại ĐÚNG file vừa bị chặn phải bắn `change` lần nữa ⇒ xoá value của input.
    if (inputRef.current) inputRef.current.value = "";
    if (!next) {
      setError(null);
      onChange(null);
      return;
    }
    if (!next.name.toLowerCase().endsWith(accept.toLowerCase())) {
      setError(`Chỉ nhận file ${accept}`);
      onChange(null);
      return;
    }
    if (next.size > maxMb * 1024 * 1024) {
      setError(`File quá ${maxMb}MB`);
      onChange(null);
      return;
    }
    setError(null);
    onChange(next);
  }

  return (
    <div className={cn("space-y-2", className)}>
      <label
        htmlFor={id}
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-card p-4 text-sm transition-colors hover:bg-muted focus-within:ring-2 focus-within:ring-ring",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          disabled={disabled}
          className="sr-only"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
        <FileSpreadsheet aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          {file ? (
            <>
              <span className="block max-w-[18rem] truncate font-medium text-foreground" title={file.name}>
                {file.name}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{sizeLabel(file.size)}</span>
            </>
          ) : (
            <>
              <span className="block font-medium text-foreground">{label}</span>
              {hint && (
                <span id={hintId} className="mt-0.5 block text-xs text-muted-foreground">
                  {hint}
                </span>
              )}
            </>
          )}
        </span>
        <span className="shrink-0 text-xs font-semibold text-foreground underline underline-offset-2">
          {file ? "Đổi file" : "Chọn file"}
        </span>
        {file && (
          <button
            type="button"
            disabled={disabled}
            // Nút nằm TRONG <label>: chặn lan để cú bấm "Bỏ chọn" không mở luôn hộp chọn file.
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              pick(null);
            }}
            className="shrink-0 rounded-lg border border-border bg-card px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
          >
            Bỏ chọn
          </button>
        )}
      </label>
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-state-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}
