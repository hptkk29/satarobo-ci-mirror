"use client";

import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  useRef,
  useState,
} from "react";
import { Edit3, Eye, ImageIcon, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
  /** Hidden input name for form submission */
  name?: string;
  rows?: number;
  placeholder?: string;
}

type UploadResponse = {
  success?: boolean;
  url?: string;
  publicUrl?: string;
  error?: string;
};

const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function MarkdownEditor({
  value,
  onChange,
  onUploadingChange,
  name,
  rows = 18,
  placeholder = "# Tiêu đề chính\n\nNội dung Markdown...",
}: MarkdownEditorProps) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  function setUploading(next: boolean) {
    setIsUploading(next);
    onUploadingChange?.(next);
  }

  function insertAtCursor(markdown: string, range?: { start: number; end: number }) {
    const textarea = textareaRef.current;
    const start = range?.start ?? textarea?.selectionStart ?? valueRef.current.length;
    const end = range?.end ?? textarea?.selectionEnd ?? start;
    const before = valueRef.current.slice(0, start);
    const after = valueRef.current.slice(end);
    const insertText = `\n\n${markdown}\n\n`;
    const nextValue = before + insertText + after;

    onChange(nextValue);
    valueRef.current = nextValue;

    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const position = start + insertText.length;
      textareaRef.current.selectionStart = position;
      textareaRef.current.selectionEnd = position;
      textareaRef.current.focus();
    });
  }

  function getImagesFromClipboard(event: ClipboardEvent<HTMLTextAreaElement>): File[] {
    return Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f != null);
  }

  function validateImage(file: File): string | null {
    if (!ALLOWED_TYPES.has(file.type)) return "Chỉ hỗ trợ ảnh JPG, PNG, WebP hoặc GIF.";
    if (file.size > MAX_SIZE_BYTES) return "Ảnh quá lớn. Tối đa 5MB.";
    return null;
  }

  async function uploadNewsImage(file: File): Promise<string> {
    const validationError = validateImage(file);
    if (validationError) throw new Error(validationError);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/admin/news/upload-image", {
      method: "POST",
      body: formData,
    });
    const data = (await res.json().catch(() => ({}))) as UploadResponse;
    const url = data.url ?? data.publicUrl;

    if (!res.ok || !url) {
      throw new Error(data.error ?? "Không thể upload ảnh. Vui lòng thử lại.");
    }

    return url;
  }

  /** Upload NHIỀU ảnh tuần tự rồi chèn 1 block markdown tại con trỏ. Ảnh lỗi được
   *  bỏ qua (báo toast riêng) nhưng vẫn chèn các ảnh thành công (BUG-R7-007). */
  async function uploadAndInsertMany(
    files: File[],
    range?: { start: number; end: number },
  ) {
    if (isUploading) return;
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;

    try {
      setUploading(true);
      const urls: string[] = [];
      for (const file of images) {
        try {
          urls.push(await uploadNewsImage(file));
        } catch (err) {
          const message =
            err instanceof Error ? err.message : `Không thể upload "${file.name}".`;
          toast.error(message);
        }
      }
      if (urls.length > 0) {
        const md = urls.map((url) => `![Ảnh tin tức](${url})`).join("\n\n");
        insertAtCursor(md, range);
        toast.success(`Đã chèn ${urls.length} ảnh vào nội dung`);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = getImagesFromClipboard(event);
    if (files.length === 0) return;

    event.preventDefault();
    const textarea = event.currentTarget;
    void uploadAndInsertMany(files, {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    });
  }

  function handleDrop(event: DragEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.dataTransfer.files).filter((item) =>
      item.type.startsWith("image/"),
    );
    if (files.length === 0) return;

    event.preventDefault();
    const textarea = event.currentTarget;
    void uploadAndInsertMany(files, {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    });
  }

  function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    void uploadAndInsertMany(files);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center border-b border-border bg-muted">
        <button
          type="button"
          onClick={() => setTab("edit")}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold transition ${ tab === "edit" ? "bg-card text-primary border-b-2 border-primary -mb-px" : "text-muted-foreground hover:text-foreground" }`}
        >
          <Edit3 className="h-4 w-4" />
          Edit
        </button>
        <button
          type="button"
          onClick={() => setTab("preview")}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold transition ${ tab === "preview" ? "bg-card text-primary border-b-2 border-primary -mb-px" : "text-muted-foreground hover:text-foreground" }`}
        >
          <Eye className="h-4 w-4" />
          Preview
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="ml-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImageIcon className="h-4 w-4" />
          )}
          {isUploading ? "Đang tải ảnh..." : "Chèn ảnh"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <span className="ml-auto px-4 py-2 text-xs text-muted-foreground">
          Có thể nhập Markdown, paste/kéo-thả hoặc bấm Chèn ảnh (chọn nhiều ảnh cùng lúc).
        </span>
      </div>

      <div className="p-4">
        {tab === "edit" ? (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onDragOver={(event) => event.preventDefault()}
            rows={rows}
            placeholder={placeholder}
            className="w-full resize-y rounded-lg border border-border bg-card p-3 font-mono text-sm leading-relaxed outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        ) : (
          <div className="prose prose-sm min-h-[20rem] max-w-none rounded-lg border border-border bg-muted p-4 prose-img:mx-auto prose-img:my-4 prose-img:h-auto prose-img:max-w-full prose-img:rounded-xl">
            {value.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
            ) : (
              <p className="italic text-muted-foreground">
                Preview sẽ hiện ở đây - viết Markdown ở tab Edit.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Hidden input for traditional form submission fallback */}
      {name && <input type="hidden" name={name} value={value} />}
    </div>
  );
}
