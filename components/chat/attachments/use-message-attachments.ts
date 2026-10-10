"use client";

// components/chat/attachments/use-message-attachments.ts — bảng "tin nào có ảnh nào".
//
// VÌ SAO ẢNH KHÔNG NẰM TRONG `chat-store`: `ChatMessage` là hình dạng chung của tầng đọc
// (`lib/chat/queries.ts`) và tầng realtime; tuyệt đại đa số tin không có ảnh, còn tin cũ
// tải khi cuộn lên thì tầng đọc không trả ảnh kèm. Gắn ảnh vào từng tin sẽ đẻ ra hai
// nguồn sự thật lệch nhau tuỳ tin đó đến bằng đường nào. Ở đây giữ MỘT bảng riêng, mọi
// đường (RSC, gửi xong, realtime, tải trang cũ, bù tin sau mất mạng) đều đổ vào nó.
//
// Dữ liệu BAN ĐẦU do RSC nạp (`initialAttachments` + `initialResolvedIds`); hook chỉ hỏi
// server cho những tin xuất hiện SAU đó — không phải "useEffect fetch dữ liệu ban đầu".

import { useCallback, useEffect, useRef, useState } from "react";
import { listChatAttachmentsAction } from "@/lib/chat/_actions";
import type { ChatAttachmentView } from "./rules";

/** Gom các tin đến gần nhau thành MỘT lượt hỏi (tin realtime thường tới thành chùm). */
const BATCH_DELAY_MS = 250;
/** Trần một lượt hỏi — khớp `CHAT_ATTACHMENT_LOOKUP_MAX` phía server. */
const BATCH_MAX = 60;
/** Hỏng liên tiếp quá số này thì thôi thử lại (tránh gõ server khi nó đang ốm). */
const MAX_CONSECUTIVE_FAILURES = 3;

const EMPTY: ChatAttachmentView[] = [];

export type MessageAttachmentRow = {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

function group(rows: readonly MessageAttachmentRow[]): Record<string, ChatAttachmentView[]> {
  const out: Record<string, ChatAttachmentView[]> = {};
  for (const r of rows) {
    (out[r.messageId] ??= []).push({
      id: r.id,
      fileName: r.fileName,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
    });
  }
  return out;
}

export function useMessageAttachments({
  conversationId,
  messages,
  initialAttachments,
  initialResolvedIds,
}: {
  conversationId: string;
  /** Luồng tin hiện tại (từ `useChatChannel`). */
  messages: readonly { id: string; kind: string }[];
  /** Ảnh của 30 tin đầu, do RSC tải. */
  initialAttachments: readonly MessageAttachmentRow[];
  /** Id của những tin RSC ĐÃ tra rồi — kể cả tin không có ảnh (đừng hỏi lại). */
  initialResolvedIds: readonly string[];
}): {
  attachmentsOf: (messageId: string) => ChatAttachmentView[];
  /** Ghi thẳng ảnh của một tin (dùng ngay sau khi gửi xong — không cần hỏi lại server). */
  setLocalAttachments: (messageId: string, list: ChatAttachmentView[]) => void;
} {
  const [byMessage, setByMessage] = useState<Record<string, ChatAttachmentView[]>>(() =>
    group(initialAttachments),
  );

  /** Tin đã biết kết quả (có ảnh hay không) — không hỏi lại. */
  const resolvedRef = useRef<Set<string>>(new Set(initialResolvedIds));
  const queueRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failuresRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const flush = useCallback(async () => {
    timerRef.current = null;
    const ids = queueRef.current.splice(0, BATCH_MAX);
    if (ids.length === 0) return;
    try {
      const res = await listChatAttachmentsAction(conversationId, ids);
      if (!mountedRef.current) return;
      if (!res.ok) throw new Error(res.error.message);
      failuresRef.current = 0;
      const grouped = group(res.data);
      if (Object.keys(grouped).length > 0) {
        setByMessage((prev) => ({ ...prev, ...grouped }));
      }
    } catch {
      if (!mountedRef.current) return;
      failuresRef.current += 1;
      // Cho lượt sau thử lại: ảnh im lặng không hiện là lỗi khó phát hiện hơn nhiều
      // so với một lượt hỏi thừa. Nhưng hỏng liên tiếp thì dừng hẳn.
      if (failuresRef.current < MAX_CONSECUTIVE_FAILURES) {
        for (const id of ids) resolvedRef.current.delete(id);
      }
    }
  }, [conversationId]);

  useEffect(() => {
    const pending: string[] = [];
    for (const m of messages) {
      // SYSTEM không bao giờ có ảnh; `tmp:` là bản optimistic (ảnh đã có sẵn cục bộ).
      if (m.kind === "SYSTEM" || m.id.startsWith("tmp:")) continue;
      if (resolvedRef.current.has(m.id)) continue;
      resolvedRef.current.add(m.id);
      pending.push(m.id);
    }
    if (pending.length === 0) return;

    queueRef.current.push(...pending);
    if (timerRef.current === null) {
      timerRef.current = setTimeout(() => void flush(), BATCH_DELAY_MS);
    }
  }, [messages, flush]);

  const attachmentsOf = useCallback(
    (messageId: string) => byMessage[messageId] ?? EMPTY,
    [byMessage],
  );

  const setLocalAttachments = useCallback((messageId: string, list: ChatAttachmentView[]) => {
    resolvedRef.current.add(messageId);
    setByMessage((prev) => ({ ...prev, [messageId]: list }));
  }, []);

  return { attachmentsOf, setLocalAttachments };
}
