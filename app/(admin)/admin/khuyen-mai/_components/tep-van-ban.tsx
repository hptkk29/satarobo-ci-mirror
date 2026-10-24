"use client";

// Đính kèm tệp văn bản gốc (PDF bản ký, ảnh chụp, Word) — không bắt buộc (chủ dự án chốt
// 26/09/2026: ban hành được ngay, đính tệp sau khi có bản ký).
//
// Đi đúng đường tải lên chung của admin (`/api/admin/upload-url` → PUT thẳng lên R2), giữ lại
// `key` để sau này dọn/ký lại được. Không dùng `DocumentUploader` có sẵn vì nó chỉ trả URL (mất
// key) và hỏi xác nhận bằng hộp thoại trình duyệt khi gỡ tệp.
import { useRef, useState } from "react";
import { FileText, Loader2, Upload, X } from "lucide-react";

export type TepDaTai = { key: string; ten: string; url: string };

const NHAN = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx";

function loaiTep(mime: string): "document" | "image" | null {
  if (mime === "application/pdf" || mime.includes("word")) return "document";
  if (["image/jpeg", "image/png", "image/webp"].includes(mime)) return "image";
  return null;
}

export function TepVanBan({
  value,
  onChange,
  disabled,
}: {
  value: TepDaTai | null;
  onChange: (t: TepDaTai | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dangTai, setDangTai] = useState<number | null>(null);
  const [loi, setLoi] = useState<string | null>(null);

  async function tai(file: File) {
    setLoi(null);
    const category = loaiTep(file.type);
    if (!category) {
      setLoi("Chỉ nhận PDF, Word hoặc ảnh chụp (JPG, PNG, WEBP).");
      return;
    }
    try {
      setDangTai(0);
      const res = await fetch("/api/admin/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, filename: file.name, mimeType: file.type, sizeBytes: file.size }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        uploadUrl?: string;
        publicUrl?: string;
        key?: string;
        error?: string;
      };
      if (!res.ok || !data.uploadUrl || !data.publicUrl || !data.key) {
        throw new Error(data.error ?? "Không lấy được đường tải lên.");
      }
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) setDangTai(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener("load", () =>
          xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Tải lên lỗi (HTTP ${xhr.status}).`)),
        );
        xhr.addEventListener("error", () => reject(new Error("Mất kết nối khi tải lên — thử lại.")));
        xhr.open("PUT", data.uploadUrl!);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.send(file);
      });
      onChange({ key: data.key, ten: file.name, url: data.publicUrl });
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Tải lên lỗi — thử lại.");
    } finally {
      setDangTai(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
        <FileText className="h-5 w-5 shrink-0 text-primary-ink" aria-hidden />
        <a
          href={value.url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:underline"
        >
          {value.ten}
        </a>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label="Bỏ tệp đính kèm"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* `hidden`, KHÔNG `sr-only` (lỗi test.satarobo.vn 26/09): `sr-only` là position:absolute,
          mà khung admin không có tổ tiên `relative` nào trong <main> ⇒ ô này thoát khỏi vùng cuộn,
          đứng ở cuối form và kéo dài CẢ TRANG — cuộn hai lần (đo: trang dài thêm 289px ở 1280,
          797px ở 375). Nút bên dưới là điều khiển thật (ô có tabIndex -1), nên ẩn hẳn không mất gì;
          cùng mẫu với `components/admin/file-uploader.tsx`. */}
      <input
        ref={inputRef}
        type="file"
        accept={NHAN}
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void tai(f);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || dangTai !== null}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-4 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-60"
      >
        {dangTai !== null ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Đang tải lên… {dangTai}%
          </>
        ) : (
          <>
            <Upload className="h-4 w-4" aria-hidden />
            Chọn tệp văn bản gốc (PDF, Word hoặc ảnh chụp, tối đa 20MB)
          </>
        )}
      </button>
      {loi && (
        <p role="alert" className="mt-1.5 text-sm text-state-danger-ink">
          {loi}
        </p>
      )}
    </div>
  );
}
