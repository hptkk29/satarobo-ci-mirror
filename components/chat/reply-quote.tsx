"use client";

// components/chat/reply-quote.tsx — US-09 AC5: trả lời MỘT CẤP.
//
// Ba mảnh của AC5, dùng chung cho bề mặt phụ huynh và bề mặt nhân viên:
//   • `ReplyComposerBar` — thanh xem trước tin đang trả lời, nằm trên ô nhập, có nút huỷ;
//   • `ReplyQuote`       — trích dẫn tin gốc hiển thị TRONG bong bóng tin trả lời;
//   • `replyQuoteOf`     — dựng nội dung trích dẫn từ luồng tin đang có.
//
// "Một cấp" là luật của DB (`Message.replyToId`, không lồng nhau) — trích dẫn ở đây KHÔNG
// vẽ lại trích dẫn của tin gốc, dù tin gốc cũng là một tin trả lời.

import { CornerUpLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Bấm vào trích dẫn thì cuộn tới tin gốc — id DOM của một dòng tin. */
export function messageDomId(messageId: string): string {
  return `chat-msg-${messageId}`;
}

export type ReplyQuoteData = {
  messageId: string;
  /** Tên người viết tin gốc; `null` khi không tra được (tin hệ thống / thành viên đã rời). */
  authorName: string | null;
  /** Trích ngắn nội dung tin gốc — đã thay bằng text "đã gỡ" nếu tin gốc bị gỡ. */
  text: string;
  /** Tin gốc đã bị gỡ (US-12) — trích dẫn vẫn hiện, nhưng không hiện nội dung cũ. */
  deleted: boolean;
  /** Tin gốc chưa nằm trong khung đang tải (người dùng chưa cuộn lên tới) ⇒ không cuộn được. */
  missing: boolean;
};

const QUOTE_MAX_CHARS = 120;

/**
 * Dựng dữ liệu trích dẫn từ luồng tin đang có trong bộ nhớ.
 *
 * Tin gốc chưa được tải (nằm ở trang cũ hơn) ⇒ `missing = true`: trích dẫn vẫn hiện để
 * người đọc biết đây là câu trả lời, chỉ không bấm cuộn tới được. Cố tải bù ở đây sẽ đẻ ra
 * một đường fetch thứ hai chạy song song với phân trang — không đáng cho một dòng trích dẫn.
 */
export function replyQuoteOf(
  replyToId: string,
  /** Tra tin theo id — caller dựng Map một lần, đừng quét mảng cho từng dòng. */
  findMessage: (
    id: string,
  ) => { body: string; deleted: boolean; senderId: string | null } | undefined,
  nameOf: (userId: string | null) => string | null,
  deletedText: string,
): ReplyQuoteData {
  const origin = findMessage(replyToId);
  if (!origin) {
    return {
      messageId: replyToId,
      authorName: null,
      text: "Tin nhắn gốc chưa được tải",
      deleted: false,
      missing: true,
    };
  }
  return {
    messageId: replyToId,
    authorName: nameOf(origin.senderId),
    text: origin.deleted ? deletedText : truncate(origin.body),
    deleted: origin.deleted,
    missing: false,
  };
}

function truncate(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length === 0) return "[Ảnh]";
  return oneLine.length > QUOTE_MAX_CHARS ? `${oneLine.slice(0, QUOTE_MAX_CHARS)}…` : oneLine;
}

/**
 * Trích dẫn trong bong bóng. Màu bám `currentColor` để dùng được trên CẢ bong bóng của
 * mình (nền primary) lẫn của người khác (nền muted) mà không cần hai bộ class.
 */
export function ReplyQuote({
  quote,
  onJump,
  className,
}: {
  quote: ReplyQuoteData;
  /** Bấm để cuộn tới tin gốc — không truyền (hoặc `missing`) thì trích dẫn không bấm được. */
  onJump?: (messageId: string) => void;
  className?: string;
}) {
  const clickable = Boolean(onJump) && !quote.missing;
  const content = (
    <>
      <span className="block text-[10px] font-semibold opacity-80">
        {quote.authorName ?? "Tin nhắn"}
      </span>
      <span className={cn("block truncate text-[11px] opacity-90", quote.deleted && "italic")}>
        {quote.text}
      </span>
    </>
  );

  const boxClass = cn(
    "mb-1 block w-full max-w-full rounded-md border-l-2 border-current/50 bg-current/10 px-2 py-1 text-left",
    clickable && "cursor-pointer hover:bg-current/20",
    className,
  );

  if (!clickable) {
    return <span className={boxClass}>{content}</span>;
  }
  return (
    <button type="button" onClick={() => onJump?.(quote.messageId)} className={boxClass}>
      {content}
    </button>
  );
}

/** Thanh "đang trả lời …" phía trên ô nhập, có nút huỷ (AC5). */
export function ReplyComposerBar({
  quote,
  onCancel,
  className,
}: {
  quote: ReplyQuoteData;
  onCancel: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border border-border bg-muted/60 px-2 py-1.5",
        className,
      )}
    >
      <CornerUpLeft className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-foreground">
          Đang trả lời {quote.authorName ?? "một tin nhắn"}
        </p>
        <p
          className={cn(
            "truncate text-[11px] text-muted-foreground",
            quote.deleted && "italic",
          )}
        >
          {quote.text}
        </p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Huỷ trả lời"
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
