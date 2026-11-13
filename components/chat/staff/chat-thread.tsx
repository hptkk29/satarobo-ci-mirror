"use client";

// M2 — luồng hội thoại cho NHÂN VIÊN (site admin + site giáo viên).
//
// Ba tầng đã có sẵn, file này chỉ NỐI chúng lại, không viết lại cái nào:
//   • `useChatChannel`  — realtime + reconcile bắt buộc mỗi lần SUBSCRIBED (US-07 AC2);
//   • `chat-store`      — hợp nhất/khử trùng optimistic ↔ broadcast ↔ Server Action;
//   • `components/chat/staff/_actions` — cầu Server Action sang `lib/chat/*`.
//
// Quy ước hiển thị bám đúng tầng đọc:
//   • tin đã gỡ luôn là "Tin nhắn đã được gỡ" — `normalizeIncomingMessage` ép, UI không
//     có đường nào render `body` gốc kể cả khi server lỡ trả về;
//   • tin SYSTEM nằm giữa luồng, không avatar, không đếm unread (US-09 AC4);
//   • ANNOUNCEMENT mới nhất ghim trên cùng (US-09 AC2).
//
// Nút "Thu hồi"/"Gỡ tin" chỉ hiện SAU KHI hydrate (`mounted`): điều kiện của chúng phụ
// thuộc `Date.now()` và `capabilities`, render ở server rồi khác ở client là hydration
// mismatch. Server vẫn chặn độc lập nên ẩn/hiện ở đây thuần tuý là UX.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CornerUpLeft,
  Loader2,
  Megaphone,
  RotateCcw,
  Send,
  Trash2,
  Undo2,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useChatChannel } from "@/components/chat/use-chat-channel";
import {
  CONVERSATION_LOCKED_NOTICE,
  DELETED_MESSAGE_TEXT,
  createOptimisticMessage,
  isOptimistic,
  type ChatMessage,
} from "@/components/chat/chat-store";
// Cửa CHUNG của module chat (dùng chung với bề mặt phụ huynh) — không chép lại.
import {
  fetchMessagesSinceAction,
  getMessagesPageAction,
  markConversationReadAction,
  recallOwnMessageAction,
  sendChatMessageAction,
} from "@/lib/chat/_actions";
import { ChatAttachmentGallery } from "@/components/chat/attachments/attachment-gallery";
import {
  AttachmentPickerButton,
  PendingUploadStrip,
} from "@/components/chat/attachments/attachment-picker";
import { useAttachmentUploads } from "@/components/chat/attachments/use-attachment-uploads";
import {
  useMessageAttachments,
  type MessageAttachmentRow,
} from "@/components/chat/attachments/use-message-attachments";
import type {
  ChatAttachmentPayload,
  ChatAttachmentView,
} from "@/components/chat/attachments/rules";
import {
  ReplyComposerBar,
  ReplyQuote,
  messageDomId,
  replyQuoteOf,
  type ReplyQuoteData,
} from "@/components/chat/reply-quote";
import { AnnouncementComposer } from "./announcement-composer";
import { DeleteMessageDialog } from "./delete-message-dialog";
import type { StaffChatCapabilities, StaffChatMember, StaffChatMessage } from "./types";

/** US-12 AC1 — cửa sổ tự thu hồi, khớp `RECALL_WINDOW_MS` của lib/chat/moderation.ts. */
const RECALL_WINDOW_MS = 15 * 60_000;
/** Trần độ dài, khớp `CHAT_BODY_MAX` của lib/chat/messages.ts. */
const BODY_MAX = 4000;
/** Nhấn sáng tin gốc sau khi cuộn tới từ một trích dẫn (US-09 AC5). */
const REPLY_HIGHLIGHT_MS = 1_800;

const timeFmt = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** `crypto.randomUUID` không có trên context không an toàn (http://<LAN-IP> lúc test máy thật). */
function newUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else if (i === 19) out += hex[8 + ((Math.random() * 4) | 0)];
    else out += hex[(Math.random() * 16) | 0];
  }
  return out;
}

export type ChatThreadProps = {
  conversationId: string;
  currentUserId: string;
  title: string;
  /** Nhãn phụ dưới tên hội thoại (vd "Nhóm lớp · 24 thành viên"). */
  subtitle: string;
  initialMessages: StaffChatMessage[];
  /** Ảnh của đúng những tin trên, cũng do RSC tải (US-11). */
  initialAttachments: MessageAttachmentRow[];
  initialHasMore: boolean;
  initialCursor: string | null;
  members: StaffChatMember[];
  capabilities: StaffChatCapabilities;
  /** Thông báo ghim (US-09 AC2) — lấy từ `listAnnouncements` nên không phụ thuộc 30 tin đầu. */
  pinnedAnnouncement: StaffChatMessage | null;
  /**
   * Lý do KHÔNG-PHẢI-KHOÁ làm ô nhập vô hiệu (US-09 AC3) — hiện chỉ có "đã lưu trữ".
   * Việc khoá đi đường riêng qua `initialLocked` + broadcast, vì nó đổi được GIỮA PHIÊN.
   */
  disabledReason: string | null;
  /** US-15 AC3 — trạng thái khoá lúc server render; broadcast `conversation.locked` đè lên. */
  initialLocked: boolean;
  /** Link màn "Xem tất cả thông báo". */
  announcementsHref: string;
  /** Link màn danh sách thành viên (nơi đặt nút "Nhắn riêng" — US-13 AC1). */
  membersHref: string;
  /** Link quay lại danh sách (chỉ hiện ở mobile). */
  backHref: string;
};

export function ChatThread(props: ChatThreadProps) {
  const {
    conversationId,
    currentUserId,
    members,
    capabilities,
    announcementsHref,
    backHref,
  } = props;

  const [mounted, setMounted] = useState(false);
  const [draft, setDraft] = useState("");
  /** clientMsgId → nội dung, cho những tin gửi hỏng (nút "Gửi lại" giữ nguyên chữ đã gõ). */
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [olderCursor, setOlderCursor] = useState<string | null>(props.initialCursor);
  const [hasMore, setHasMore] = useState(props.initialHasMore);
  const [loadingOlder, startLoadOlder] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; preview: string } | null>(null);
  /** US-09 AC5 — tin đang được trả lời. */
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Ảnh + trích dẫn đi kèm một lượt gửi, theo `clientMsgId`. Không nhét vào state `failed`
   * (nó chỉ giữ chữ) vì nút "Gửi lại" phải gửi lại NGUYÊN VẸN cả ảnh lẫn tin được trả lời.
   */
  const attemptRef = useRef(
    new Map<
      string,
      { attachments: ChatAttachmentPayload[]; previewUrls: string[]; replyToId: string | null }
    >(),
  );

  useEffect(() => setMounted(true), []);
  useEffect(
    () => () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    },
    [],
  );

  const fetchSince = useCallback(
    async (lastSeenMessageId: string | null) => {
      const res = await fetchMessagesSinceAction(conversationId, lastSeenMessageId);
      // Ném ra để `useChatChannel` hiện dải "mất kết nối" và thử lại ở lần SUBSCRIBED sau.
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    [conversationId],
  );

  const markRead = useCallback(
    async (lastReadMessageId: string) => {
      await markConversationReadAction(conversationId, lastReadMessageId);
    },
    [conversationId],
  );

  const router = useRouter();
  const { messages, lockedByAdmin, status, error, mergeLocal } = useChatChannel({
    conversationId,
    currentUserId,
    fetchSince,
    markRead,
    initialMessages: props.initialMessages,
    // US-10 AC3 — thông báo do người KHÁC gửi (GV thứ hai, QLCS) phải hiện ngay ở đây
    // nữa; khung ghim `pinnedAnnouncement` là prop từ RSC nên phải dựng lại trang.
    onAnnouncement: () => router.refresh(),
  });

  // US-15 AC3 — Admin khoá/mở khoá trong lúc màn hình đang mở: broadcast đè lên trạng
  // thái server đã render. "Đã lưu trữ" THẮNG khoá: mở khoá không làm lớp đã kết thúc
  // gửi tin lại được (server cũng trả CONVERSATION_ARCHIVED trước khi tới nhánh khoá).
  const locked = lockedByAdmin ?? props.initialLocked;
  const disabledReason = props.disabledReason ?? (locked ? CONVERSATION_LOCKED_NOTICE : null);

  const { attachmentsOf, setLocalAttachments } = useMessageAttachments({
    conversationId,
    messages,
    initialAttachments: props.initialAttachments,
    initialResolvedIds: useMemo(
      () => props.initialMessages.map((m) => m.id),
      [props.initialMessages],
    ),
  });

  const uploader = useAttachmentUploads({
    conversationId,
    onError: (message) => toast.error(message),
  });

  const memberById = useMemo(() => {
    const map = new Map<string, StaffChatMember>();
    for (const m of members) map.set(m.userId, m);
    return map;
  }, [members]);

  const messageById = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  const quoteOf = useCallback(
    (targetId: string): ReplyQuoteData =>
      replyQuoteOf(
        targetId,
        (id) => messageById.get(id),
        (userId) => {
          if (!userId) return null;
          if (userId === currentUserId) return "Bạn";
          return memberById.get(userId)?.displayName ?? "Thành viên";
        },
        DELETED_MESSAGE_TEXT,
      ),
    [messageById, memberById, currentUserId],
  );

  const jumpToMessage = useCallback((messageId: string) => {
    const el = document.getElementById(messageDomId(messageId));
    if (!el) {
      toast.info("Tin gốc chưa được tải — bấm \"Tải tin cũ hơn\" rồi thử lại.");
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlightId(messageId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightId(null), REPLY_HIGHLIGHT_MS);
  }, []);

  /** Ghim ANNOUNCEMENT mới nhất: bản từ server (RSC) hoặc bản vừa tới trong luồng. */
  const pinned = useMemo(() => {
    let best: { id: string; body: string; createdAt: Date } | null = props.pinnedAnnouncement
      ? {
          id: props.pinnedAnnouncement.id,
          body: props.pinnedAnnouncement.body,
          createdAt: props.pinnedAnnouncement.createdAt,
        }
      : null;
    for (const m of messages) {
      if (m.kind !== "ANNOUNCEMENT" || m.deleted) continue;
      if (!best || m.createdAt.getTime() > best.createdAt.getTime()) {
        best = { id: m.id, body: m.body, createdAt: m.createdAt };
      }
    }
    return best;
  }, [messages, props.pinnedAnnouncement]);

  // Cuộn xuống đáy khi có tin mới (chỉ khi người dùng đang ở gần đáy — không giật màn
  // hình của người đang đọc lại lịch sử).
  const lastCountRef = useRef(messages.length);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = messages.length > lastCountRef.current;
    lastCountRef.current = messages.length;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240;
    if (grew && nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversationId]);

  const sendDisabled = Boolean(disabledReason) || !capabilities.canSend;

  const doSend = useCallback(
    async (clientMsgId: string, body: string) => {
      const attempt = attemptRef.current.get(clientMsgId);
      const res = await sendChatMessageAction({
        conversationId,
        body,
        clientMsgId,
        ...(attempt?.replyToId ? { replyToId: attempt.replyToId } : {}),
        ...(attempt && attempt.attachments.length > 0
          ? { attachments: attempt.attachments }
          : {}),
      });
      if (res.ok) {
        if (res.data.attachments.length > 0) {
          // Giữ object URL cục bộ theo đúng thứ tự ⇒ người gửi thấy lại ảnh của mình ngay,
          // không phải chờ một vòng ký URL.
          setLocalAttachments(
            res.data.id,
            res.data.attachments.map((a, i) => ({
              id: a.id,
              fileName: a.fileName,
              mimeType: a.mimeType,
              sizeBytes: a.sizeBytes,
              ...(attempt?.previewUrls[i] ? { localUrl: attempt.previewUrls[i] } : {}),
            })),
          );
        }
        attemptRef.current.delete(clientMsgId);
        mergeLocal(res.data);
        setFailed((prev) => {
          if (!(clientMsgId in prev)) return prev;
          const next = { ...prev };
          delete next[clientMsgId];
          return next;
        });
        return;
      }
      setFailed((prev) => ({ ...prev, [clientMsgId]: body }));
      toast.error(res.error.message);
    },
    [conversationId, mergeLocal, setLocalAttachments],
  );

  function submitDraft() {
    if (sendDisabled || uploader.busy) return;
    const body = draft.trim();
    const { payloads, previewUrls } = uploader.takeReady();
    // Tin rỗng hoàn toàn không gửi; tin CHỈ CÓ ẢNH thì được (quyết định US-11).
    if (!body && payloads.length === 0) return;

    const clientMsgId = newUuid();
    attemptRef.current.set(clientMsgId, { attachments: payloads, previewUrls, replyToId });
    const optimistic = createOptimisticMessage({
      conversationId,
      clientMsgId,
      senderId: currentUserId,
      body,
      replyToId,
    });
    if (payloads.length > 0) {
      setLocalAttachments(
        optimistic.id,
        payloads.map((a, i) => ({
          id: `local:${clientMsgId}:${i}`,
          fileName: a.fileName,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          ...(previewUrls[i] ? { localUrl: previewUrls[i] } : {}),
        })),
      );
    }
    mergeLocal(optimistic);
    setDraft("");
    setReplyToId(null);
    void doSend(clientMsgId, body);
  }

  function retry(clientMsgId: string) {
    const body = failed[clientMsgId];
    // Tin CHỈ CÓ ẢNH có `body` rỗng — không được coi là "không có gì để gửi lại".
    if (body === undefined) return;
    setFailed((prev) => {
      const next = { ...prev };
      delete next[clientMsgId];
      return next;
    });
    void doSend(clientMsgId, body);
  }

  function loadOlder() {
    if (!olderCursor) return;
    startLoadOlder(async () => {
      const res = await getMessagesPageAction(conversationId, olderCursor);
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      mergeLocal(res.data.messages);
      setOlderCursor(res.data.nextCursor);
      setHasMore(res.data.hasMore);
    });
  }

  /** Đánh dấu đã gỡ ngay trên máy người thao tác — broadcast lo cho những người còn lại. */
  const markDeletedLocally = useCallback(
    (messageId: string) => {
      const target = messages.find((m) => m.id === messageId);
      if (!target) return;
      mergeLocal({
        id: target.id,
        conversationId: target.conversationId,
        kind: target.kind,
        senderId: target.senderId,
        body: "",
        deleted: true,
        deletedAt: new Date(),
        replyToId: target.replyToId,
        clientMsgId: target.clientMsgId,
        createdAt: target.createdAt,
      });
    },
    [messages, mergeLocal],
  );

  function recall(messageId: string) {
    void (async () => {
      const res = await recallOwnMessageAction({ messageId });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      markDeletedLocally(messageId);
      toast.success("Đã thu hồi tin nhắn.");
    })();
  }

  const now = mounted ? Date.now() : 0;

  return (
    <div className="flex h-full min-h-[60vh] flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* Đầu luồng */}
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={backHref}
            className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"
            aria-label="Quay lại danh sách hội thoại"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground sm:text-base">
              {props.title}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {props.subtitle}
              {" · "}
              <Link href={props.membersHref} className="underline hover:text-foreground">
                {members.length} thành viên
              </Link>
            </p>
          </div>
        </div>
        {capabilities.canAnnounce && (
          <AnnouncementComposer
            conversationId={conversationId}
            disabled={Boolean(disabledReason)}
            onSent={(m) => mergeLocal(m)}
          />
        )}
      </div>

      {/* Thông báo ghim */}
      {pinned && (
        <div className="border-b border-orange-200 bg-orange-50 px-3 py-2 dark:border-orange-900/50 dark:bg-orange-950/30 sm:px-4">
          <div className="flex items-start gap-2">
            <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-3 whitespace-pre-wrap text-sm text-foreground">{pinned.body}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{timeFmt.format(pinned.createdAt)}</span>
                <Link href={announcementsHref} className="font-medium text-orange-700 underline dark:text-orange-300">
                  Xem tất cả thông báo
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {status === "error" && (
        <p className="flex items-center gap-1.5 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200 sm:px-4">
          <WifiOff className="h-3.5 w-3.5" aria-hidden />
          {error ?? "Mất kết nối tới máy chủ tin nhắn — đang thử lại"}
        </p>
      )}

      {/* Luồng tin */}
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3 sm:px-4">
        {hasMore && (
          <div className="text-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={loadOlder}
              disabled={loadingOlder}
              className="text-xs"
            >
              {loadingOlder && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Tải tin cũ hơn
            </Button>
          </div>
        )}

        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Chưa có tin nhắn nào trong hội thoại này.
          </p>
        )}

        {messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            currentUserId={currentUserId}
            senderName={m.senderId ? (memberById.get(m.senderId)?.displayName ?? "Thành viên") : null}
            senderRole={m.senderId ? (memberById.get(m.senderId)?.roleLabel ?? null) : null}
            mounted={mounted}
            now={now}
            canModerate={capabilities.canModerate}
            canReply={!sendDisabled}
            hasFailed={m.clientMsgId !== null && m.clientMsgId in failed}
            attachments={attachmentsOf(m.id)}
            replyQuote={m.replyToId ? quoteOf(m.replyToId) : null}
            highlighted={highlightId === m.id}
            onRetry={() => m.clientMsgId && retry(m.clientMsgId)}
            onRecall={() => recall(m.id)}
            onReply={() => setReplyToId(m.id)}
            onJumpToReply={jumpToMessage}
            onDelete={() => setDeleteTarget({ id: m.id, preview: m.body })}
          />
        ))}
      </div>

      {/* Ô nhập */}
      <div className="border-t border-border px-3 py-2.5 sm:px-4">
        {sendDisabled ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
            {disabledReason ?? "Bạn không có quyền gửi tin trong hội thoại này."}
          </p>
        ) : (
          <div className="space-y-1.5">
            {replyToId && (
              <ReplyComposerBar quote={quoteOf(replyToId)} onCancel={() => setReplyToId(null)} />
            )}
            <PendingUploadStrip uploads={uploader.uploads} onCancel={uploader.cancel} />
            <div className="flex items-end gap-1">
              <AttachmentPickerButton onPick={uploader.addFiles} />
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitDraft();
                  }
                }}
                placeholder="Nhập tin nhắn…"
                rows={2}
                maxLength={BODY_MAX}
                className="max-h-40 min-h-[44px] flex-1 resize-none"
                aria-label="Nội dung tin nhắn"
              />
              <Button
                type="button"
                onClick={submitDraft}
                disabled={
                  uploader.busy || (draft.trim().length === 0 && uploader.readyCount === 0)
                }
                className="h-11 w-11 shrink-0 p-0 sm:h-10 sm:w-auto sm:px-4"
                aria-label="Gửi tin nhắn"
              >
                <Send className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Gửi</span>
              </Button>
            </div>
            {uploader.busy && (
              <p className="text-[11px] text-muted-foreground">
                Đang tải ảnh lên — chờ xong rồi gửi.
              </p>
            )}
          </div>
        )}
      </div>

      <DeleteMessageDialog
        messageId={deleteTarget?.id ?? null}
        preview={deleteTarget?.preview ?? ""}
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        onDeleted={(id) => {
          markDeletedLocally(id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

function MessageRow({
  message,
  currentUserId,
  senderName,
  senderRole,
  mounted,
  now,
  canModerate,
  canReply,
  hasFailed,
  attachments,
  replyQuote,
  highlighted,
  onRetry,
  onRecall,
  onReply,
  onJumpToReply,
  onDelete,
}: {
  message: ChatMessage;
  currentUserId: string;
  senderName: string | null;
  senderRole: string | null;
  mounted: boolean;
  now: number;
  canModerate: boolean;
  /** Hội thoại còn gửi được ⇒ mới có nút "Trả lời". */
  canReply: boolean;
  /** Lượt gửi này đã hỏng — dùng cờ chứ không dùng nội dung: tin CHỈ CÓ ẢNH có body rỗng. */
  hasFailed: boolean;
  attachments: readonly ChatAttachmentView[];
  replyQuote: ReplyQuoteData | null;
  highlighted: boolean;
  onRetry: () => void;
  onRecall: () => void;
  onReply: () => void;
  onJumpToReply: (messageId: string) => void;
  onDelete: () => void;
}) {
  // US-09 AC4 — tin SYSTEM: giữa luồng, không avatar, không hành động.
  if (message.kind === "SYSTEM") {
    return (
      <p id={messageDomId(message.id)} className="py-1 text-center text-xs text-muted-foreground">
        {message.body}
      </p>
    );
  }

  const mine = message.senderId === currentUserId;
  const pending = isOptimistic(message);
  const isAnnouncement = message.kind === "ANNOUNCEMENT";
  const canRecall =
    mounted && mine && !pending && !message.deleted && now - message.createdAt.getTime() <= RECALL_WINDOW_MS;
  const canDelete = mounted && canModerate && !mine && !pending && !message.deleted;
  // Tin CHỈ CÓ ẢNH (US-11): không vẽ bong bóng rỗng.
  const hasBubble = message.deleted || message.body.length > 0 || replyQuote !== null || isAnnouncement;

  return (
    <div
      id={messageDomId(message.id)}
      className={cn(
        "flex scroll-mt-4 flex-col rounded-lg transition-colors",
        mine ? "items-end" : "items-start",
        highlighted && "bg-primary/10 ring-2 ring-primary/40",
      )}
    >
      {!mine && (
        <span className="mb-0.5 px-1 text-[11px] text-muted-foreground">
          {senderName}
          {senderRole ? ` · ${senderRole}` : ""}
        </span>
      )}
      {hasBubble && (
        <div
          className={cn(
            "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm sm:max-w-[75%]",
            message.deleted
              ? "bg-muted italic text-muted-foreground"
              : isAnnouncement
                ? "bg-orange-100 text-orange-950 dark:bg-orange-950/50 dark:text-orange-50"
                : mine
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground",
          )}
        >
          {isAnnouncement && !message.deleted && (
            <span className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide">
              <Megaphone className="h-3 w-3" aria-hidden />
              Thông báo
            </span>
          )}
          {replyQuote && !message.deleted && (
            <ReplyQuote quote={replyQuote} onJump={onJumpToReply} />
          )}
          {message.body}
        </div>
      )}

      {!message.deleted && attachments.length > 0 && (
        <ChatAttachmentGallery
          attachments={attachments}
          className={cn("mt-1", mine && "justify-end")}
        />
      )}

      <div className="mt-0.5 flex items-center gap-2 px-1 text-[10px] text-muted-foreground">
        <span>{timeFmt.format(message.createdAt)}</span>
        {pending && !hasFailed && <span>Đang gửi…</span>}
        {hasFailed && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-0.5 font-medium text-destructive underline"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            Chưa gửi được — gửi lại
          </button>
        )}
        {canReply && !pending && !message.deleted && (
          <button
            type="button"
            onClick={onReply}
            className="inline-flex items-center gap-0.5 underline hover:text-foreground"
          >
            <CornerUpLeft className="h-3 w-3" aria-hidden />
            Trả lời
          </button>
        )}
        {canRecall && (
          <button
            type="button"
            onClick={onRecall}
            className="inline-flex items-center gap-0.5 underline hover:text-foreground"
          >
            <Undo2 className="h-3 w-3" aria-hidden />
            Thu hồi
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-0.5 underline hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" aria-hidden />
            Gỡ tin
          </button>
        )}
      </div>
    </div>
  );
}
