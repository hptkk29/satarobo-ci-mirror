"use client";

// Ô nhập tin của phụ huynh (M2).
//   - Hội thoại ARCHIVED/LOCKED → vô hiệu kèm ĐÚNG lý do (US-09 AC3);
//   - Quá 4000 ký tự → chặn tại client, server vẫn chặn độc lập (US-06 AC5);
//   - US-11 AC4 → nút chọn ảnh + dải xem trước có tiến trình và huỷ được;
//   - US-09 AC5 → thanh "đang trả lời …" phía trên ô nhập, có nút huỷ.
// Component KHÔNG giữ trạng thái gửi: bấm gửi là nội dung rời ô nhập và sống tiếp
// trong bong bóng optimistic (có "đang gửi"/"gửi lại") — nội dung không bao giờ bốc hơi.
//
// Ảnh thì NGƯỢC LẠI: chúng phải upload xong mới rời ô nhập được (`takeReady` chỉ lấy ảnh
// `ready`). Bấm Gửi khi còn ảnh đang chạy = mất ảnh, nên nút Gửi khoá trong lúc đó.

import { useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  AttachmentPickerButton,
  PendingUploadStrip,
} from "@/components/chat/attachments/attachment-picker";
import { useAttachmentUploads } from "@/components/chat/attachments/use-attachment-uploads";
import type { ChatAttachmentPayload } from "@/components/chat/attachments/rules";
import { ReplyComposerBar, type ReplyQuoteData } from "@/components/chat/reply-quote";

/** Trùng `CHAT_BODY_MAX` (`lib/chat/messages.ts`) — khai lại vì file đó import Prisma. */
const BODY_MAX = 4000;

export function MessageComposer({
  conversationId,
  disabled = false,
  disabledReason,
  replyQuote,
  onCancelReply,
  onSend,
}: {
  conversationId: string;
  disabled?: boolean;
  disabledReason?: string | null;
  /** Tin đang được trả lời (US-09 AC5) — `null` khi không trả lời ai. */
  replyQuote?: ReplyQuoteData | null;
  onCancelReply?: () => void;
  /** `previewUrls` khớp 1-1 theo thứ tự với `attachments` — để bong bóng hiện ảnh ngay. */
  onSend: (body: string, attachments: ChatAttachmentPayload[], previewUrls: string[]) => void;
}) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const tooLong = trimmed.length > BODY_MAX;

  const { uploads, addFiles, cancel, busy, readyCount, takeReady } = useAttachmentUploads({
    conversationId,
    onError: (message) => toast.error(message),
  });

  const canSubmit = !disabled && !tooLong && !busy && (trimmed.length > 0 || readyCount > 0);

  function submit() {
    if (!canSubmit) return;
    const { payloads, previewUrls } = takeReady();
    // Tin rỗng hoàn toàn không được gửi; tin CHỈ CÓ ẢNH thì được (quyết định US-11).
    if (trimmed.length === 0 && payloads.length === 0) return;
    onSend(trimmed, payloads, previewUrls);
    setValue("");
  }

  if (disabled) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-muted/40 px-3 py-3 text-center text-xs text-muted-foreground">
        {disabledReason ?? "Hội thoại này chỉ còn đọc."}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {replyQuote && onCancelReply && (
        <ReplyComposerBar quote={replyQuote} onCancel={onCancelReply} />
      )}

      <PendingUploadStrip uploads={uploads} onCancel={cancel} />

      <div className="flex items-end gap-1">
        <AttachmentPickerButton onPick={addFiles} />
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={1}
          placeholder="Nhập tin nhắn…"
          aria-label="Nội dung tin nhắn"
          className="max-h-32 min-h-[44px] flex-1 resize-y"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          // ≥44px cho vùng chạm mobile 375px.
          // aria-label: mobile ẩn chữ "Gửi" (hidden sm:inline) → nút icon-only phải
          // có tên truy cập (a11y + selector getByRole của smoke chạy được cả 2 viewport).
          aria-label="Gửi"
          className="h-11 shrink-0 px-4"
        >
          <Send className="size-4" />
          <span className="ml-1.5 hidden sm:inline">Gửi</span>
        </Button>
      </div>

      {busy && (
        <p className="text-[11px] text-muted-foreground">Đang tải ảnh lên — chờ xong rồi gửi.</p>
      )}
      {tooLong && (
        <p className="text-[11px] font-semibold text-destructive">
          Tin nhắn tối đa {BODY_MAX} ký tự (đang {trimmed.length}).
        </p>
      )}
    </div>
  );
}
