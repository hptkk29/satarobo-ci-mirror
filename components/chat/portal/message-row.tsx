"use client";

// Một dòng trong luồng chat của phụ huynh (M2).
//   - SYSTEM  → giữa luồng, không avatar, không tên (US-09 AC4);
//   - ANNOUNCEMENT → khung nhấn mạnh, bọc `AnnouncementReadMarker` (US-10 AC3);
//   - CHAT    → bong bóng trái/phải, kèm trích dẫn tin được trả lời (US-09 AC5) và
//               lưới ảnh (US-11 AC4).
// Tin đã gỡ hiện text thay thế do `chat-store` chuẩn hoá — component này KHÔNG tự
// quyết định hiển thị body gốc trong bất kỳ nhánh nào.

import { AlertCircle, CornerUpLeft, Loader2, Megaphone, Undo2 } from "lucide-react";
import type { ChatMessage } from "@/components/chat/chat-store";
import { cn } from "@/lib/utils";
import { ChatAttachmentGallery } from "@/components/chat/attachments/attachment-gallery";
import type { ChatAttachmentView } from "@/components/chat/attachments/rules";
import { ReplyQuote, messageDomId, type ReplyQuoteData } from "@/components/chat/reply-quote";
import { formatChatTimestamp } from "./format";
import { AnnouncementReadMarker } from "./announcement-read-marker";

/**
 * US-12 AC1 — cửa sổ tự thu hồi. Khai lại (không import `RECALL_WINDOW_MS` từ
 * `lib/chat/moderation.ts`) vì file đó import Prisma. **Server vẫn là chốt chặn**:
 * nút biến mất chỉ là phép lịch sự, quá 15' server từ chối kể cả khi client gọi.
 */
const RECALL_WINDOW_MS = 15 * 60_000;

export function canRecall(
  message: Pick<ChatMessage, "kind" | "deleted" | "createdAt" | "id">,
  isMine: boolean,
  nowMs: number,
): boolean {
  // `nowMs = 0` = component chưa mount xong (client chưa đặt đồng hồ) — chưa vẽ nút,
  // nếu không mọi tin cũ đều "còn trong 15 phút" vì hiệu số ra số âm.
  if (nowMs <= 0) return false;
  if (!isMine || message.deleted || message.kind !== "CHAT") return false;
  if (message.id.startsWith("tmp:")) return false; // chưa có id server
  return nowMs - message.createdAt.getTime() <= RECALL_WINDOW_MS;
}

export function MessageRow({
  message,
  isMine,
  senderName,
  nowMs,
  recallPending,
  attachments,
  replyQuote,
  highlighted,
  canSend,
  onRecall,
  onRetry,
  onReply,
  onJumpToReply,
}: {
  message: ChatMessage;
  isMine: boolean;
  senderName: string | null;
  nowMs: number;
  recallPending: boolean;
  /** Ảnh của tin này (US-11) — mảng rỗng khi tin không có ảnh. */
  attachments: readonly ChatAttachmentView[];
  /** Trích dẫn tin được trả lời (US-09 AC5) — `null` khi tin này không trả lời ai. */
  replyQuote: ReplyQuoteData | null;
  /** Vừa được cuộn tới từ một trích dẫn — nhấn sáng ngắn để mắt bắt được. */
  highlighted: boolean;
  /** Hội thoại còn gửi được (ARCHIVED/LOCKED thì không hiện nút trả lời). */
  canSend: boolean;
  onRecall: (messageId: string) => void;
  onRetry: (clientMsgId: string) => void;
  onReply: (messageId: string) => void;
  onJumpToReply: (messageId: string) => void;
}) {
  if (message.kind === "SYSTEM") {
    return (
      <div id={messageDomId(message.id)} className="my-1 flex justify-center">
        <p className="max-w-[85%] rounded-full bg-muted px-3 py-1 text-center text-[11px] text-muted-foreground">
          {message.body}
        </p>
      </div>
    );
  }

  if (message.kind === "ANNOUNCEMENT") {
    return (
      <AnnouncementReadMarker messageId={message.id}>
        <div
          id={messageDomId(message.id)}
          className={cn(
            "rounded-xl border border-primary/30 bg-primary/5 p-3",
            highlighted && "ring-2 ring-primary",
          )}
        >
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
            <Megaphone className="size-3.5" /> Thông báo
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
            {message.body}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {senderName ? `${senderName} · ` : ""}
            {formatChatTimestamp(message.createdAt)}
          </p>
        </div>
      </AnnouncementReadMarker>
    );
  }

  const sending = message.send?.status === "sending";
  const failed = message.send?.status === "failed";
  // Tin CHỈ CÓ ẢNH (US-11): không vẽ bong bóng rỗng — ảnh tự đứng một mình.
  const hasBubble = message.deleted || message.body.length > 0 || replyQuote !== null;
  const canReply = canSend && !message.deleted && !message.id.startsWith("tmp:");

  return (
    <div
      id={messageDomId(message.id)}
      className={cn(
        "flex flex-col scroll-mt-4 rounded-lg transition-colors",
        isMine ? "items-end" : "items-start",
        highlighted && "bg-primary/10 ring-2 ring-primary/40",
      )}
    >
      {!isMine && senderName && (
        <span className="mb-0.5 max-w-full truncate px-1 text-[11px] font-semibold text-muted-foreground">
          {senderName}
        </span>
      )}

      {hasBubble && (
        <div
          className={cn(
            "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
            message.deleted
              ? "border border-dashed border-border bg-transparent italic text-muted-foreground"
              : isMine
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground",
            failed && "opacity-70 ring-1 ring-destructive",
          )}
        >
          {replyQuote && !message.deleted && (
            <ReplyQuote quote={replyQuote} onJump={onJumpToReply} />
          )}
          {message.body}
        </div>
      )}

      {!message.deleted && attachments.length > 0 && (
        <ChatAttachmentGallery attachments={attachments} className={cn("mt-1", isMine && "justify-end")} />
      )}

      <div className="mt-0.5 flex items-center gap-2 px-1 text-[10px] text-muted-foreground">
        <span>{formatChatTimestamp(message.createdAt)}</span>

        {sending && (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" /> Đang gửi…
          </span>
        )}

        {failed && (
          <button
            type="button"
            onClick={() => message.clientMsgId && onRetry(message.clientMsgId)}
            className="inline-flex min-h-[24px] items-center gap-1 rounded px-1 font-semibold text-destructive hover:underline"
          >
            <AlertCircle className="size-3" /> Gửi lại
          </button>
        )}

        {canReply && (
          <button
            type="button"
            onClick={() => onReply(message.id)}
            className="inline-flex min-h-[24px] items-center gap-1 rounded px-1 hover:underline"
          >
            <CornerUpLeft className="size-3" /> Trả lời
          </button>
        )}

        {canRecall(message, isMine, nowMs) && (
          <button
            type="button"
            disabled={recallPending}
            onClick={() => onRecall(message.id)}
            className="inline-flex min-h-[24px] items-center gap-1 rounded px-1 hover:underline disabled:opacity-50"
          >
            <Undo2 className="size-3" /> Thu hồi
          </button>
        )}
      </div>
    </div>
  );
}
