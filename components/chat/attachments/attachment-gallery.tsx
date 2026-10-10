"use client";

// components/chat/attachments/attachment-gallery.tsx — US-11 AC2 + AC4: ảnh trong luồng.
//
//   AC4  thumbnail trong luồng, bấm mở lớn
//   AC2  render bằng signed URL hạn 5 phút, TỰ XIN URL MỚI khi hết hạn
//
// Bước 3 của F-FILE chạy ở CLIENT theo đúng thiết kế: URL đọc sống 5 phút, nhúng sẵn từ
// server thì tới lúc người dùng cuộn đến nơi nó đã chết, và một trang HTML cache lại đâu
// đó sẽ mang theo URL còn hiệu lực. Vì vậy component tự đổi `MessageAttachment.id` lấy URL
// và tự gia hạn — đây KHÔNG phải "useEffect fetch dữ liệu ban đầu" (dữ liệu ban đầu của
// luồng chat do RSC tải).
//
// ⚠️ KHÔNG `next/image`: host của URL đã ký là kho ảnh riêng (đang được tách bucket) và
// URL đổi mỗi 5 phút — đưa vào `remotePatterns` là hardcode host, còn optimizer thì cache
// đúng thứ không được phép cache. `<img>` trần là lựa chọn đúng ở đây (ngoại lệ "admin
// preview thumbnails" của .claude/rules/client-site.md).

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageOff, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatAttachmentView } from "./rules";

/** Xin URL mới khi đã tiêu 80% hạn — còn 20% làm đệm cho mạng chậm (như vé realtime). */
const RENEW_RATIO = 0.8;
/** Sàn chống vòng lặp nóng nếu server trả `expiresIn` bé bất thường. */
const MIN_RENEW_MS = 15_000;
/** Không đọc được `expiresIn` → coi như 5 phút (hợp đồng AC2). */
const FALLBACK_TTL_SECONDS = 300;

type UrlState =
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "error"; message: string };

/**
 * Đổi `attachmentId` lấy signed GET URL, tự gia hạn trước khi hết hạn.
 * Ảnh còn `localUrl` (người gửi vừa chọn) thì KHÔNG chạm mạng.
 */
function useAttachmentUrl(attachment: ChatAttachmentView): {
  state: UrlState;
  reload: () => void;
} {
  const [state, setState] = useState<UrlState>(() =>
    attachment.localUrl ? { kind: "ready", url: attachment.localUrl } : { kind: "loading" },
  );
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const { id, localUrl } = attachment;

  useEffect(() => {
    if (localUrl) {
      setState({ kind: "ready", url: localUrl });
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const abort = new AbortController();

    const load = async () => {
      try {
        const res = await fetch(`/api/chat/attachment-url?id=${encodeURIComponent(id)}`, {
          signal: abort.signal,
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; data?: { url?: string; expiresIn?: number }; error?: { message?: string } }
          | null;
        if (cancelled) return;
        if (!res.ok || !json?.ok || !json.data?.url) {
          setState({
            kind: "error",
            message: json?.error?.message ?? "Không tải được ảnh.",
          });
          return;
        }
        setState({ kind: "ready", url: json.data.url });
        const ttl = Number(json.data.expiresIn) > 0 ? Number(json.data.expiresIn) : FALLBACK_TTL_SECONDS;
        timer = setTimeout(() => void load(), Math.max(ttl * 1000 * RENEW_RATIO, MIN_RENEW_MS));
      } catch {
        if (cancelled) return;
        setState({ kind: "error", message: "Không tải được ảnh — kiểm tra kết nối." });
      }
    };

    setState({ kind: "loading" });
    void load();

    return () => {
      cancelled = true;
      abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [id, localUrl, nonce]);

  return { state, reload };
}

function AttachmentThumb({
  attachment,
  onOpen,
}: {
  attachment: ChatAttachmentView;
  onOpen: (url: string) => void;
}) {
  const { state, reload } = useAttachmentUrl(attachment);
  /** URL hết hạn khi tab bị đóng băng → `<img>` báo lỗi; xin lại đúng MỘT lần rồi thôi. */
  const retriedRef = useRef(false);

  if (state.kind === "loading") {
    return (
      <div className="grid size-24 place-items-center rounded-lg border border-border bg-muted/50 sm:size-28">
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <button
        type="button"
        onClick={reload}
        title={state.message}
        className="grid size-24 place-items-center gap-1 rounded-lg border border-dashed border-border bg-muted/50 p-1 text-[10px] text-muted-foreground hover:bg-muted sm:size-28"
      >
        <ImageOff className="size-4" aria-hidden />
        <span className="line-clamp-2 text-center">Không tải được — bấm để thử lại</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(state.url)}
      className="group relative size-24 overflow-hidden rounded-lg border border-border bg-muted sm:size-28"
      aria-label={`Mở ảnh ${attachment.fileName}`}
    >
      <img
        src={state.url}
        alt={attachment.fileName}
        loading="lazy"
        decoding="async"
        onError={() => {
          if (retriedRef.current) return;
          retriedRef.current = true;
          reload();
        }}
        className="size-full object-cover transition-transform group-hover:scale-105"
      />
    </button>
  );
}

/** Xem lớn — overlay đơn giản, đóng bằng Esc / bấm nền / nút X. */
function Lightbox({ url, fileName, onClose }: { url: string; fileName: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Khoá cuộn nền: trên mobile, cuộn nền sau ảnh phóng to là lỗi UX kinh điển.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Ảnh ${fileName}`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Đóng ảnh"
        className="absolute right-3 top-3 grid size-11 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
      >
        <X className="size-5" aria-hidden />
      </button>
      <img
        src={url}
        alt={fileName}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-lg object-contain"
      />
    </div>
  );
}

/** Lưới ảnh của MỘT tin nhắn. Không có ảnh ⇒ không render gì (kể cả khoảng trắng). */
export function ChatAttachmentGallery({
  attachments,
  className,
}: {
  attachments: readonly ChatAttachmentView[];
  className?: string;
}) {
  const [opened, setOpened] = useState<{ url: string; fileName: string } | null>(null);
  if (attachments.length === 0) return null;

  return (
    <>
      <div className={cn("flex flex-wrap gap-1.5", className)}>
        {attachments.map((a) => (
          <AttachmentThumb
            key={a.id}
            attachment={a}
            onOpen={(url) => setOpened({ url, fileName: a.fileName })}
          />
        ))}
      </div>
      {opened && (
        <Lightbox url={opened.url} fileName={opened.fileName} onClose={() => setOpened(null)} />
      )}
    </>
  );
}
