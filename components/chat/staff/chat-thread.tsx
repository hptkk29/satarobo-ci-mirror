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
  Lock,
  Megaphone,
  RotateCcw,
  Send,
  Trash2,
  Undo2,
  Users,
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
import { AddMemberButton } from "./add-members-sheet";
import { AnnouncementComposer } from "./announcement-composer";
import {
  ConversationTile,
  PersonAvatar,
  clockLabel,
  dayLabel,
  vnDayKey,
} from "./chat-ui";
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

  /** Gắn mốc ngày + gom tin liên tiếp cùng người gửi (≤5 phút) để không lặp tên/avatar. */
  const rows = useMemo(() => {
    const out: {
      m: ChatMessage;
      dayHeader: string | null;
      firstOfRun: boolean;
      lastOfRun: boolean;
    }[] = [];
    let prev: ChatMessage | null = null;
    for (const m of messages) {
      const newDay = !prev || vnDayKey(prev.createdAt) !== vnDayKey(m.createdAt);
      const sameRun =
        !!prev &&
        !newDay &&
        prev.kind !== "SYSTEM" &&
        m.kind !== "SYSTEM" &&
        prev.senderId === m.senderId &&
        m.createdAt.getTime() - prev.createdAt.getTime() < 5 * 60_000;
      out.push({
        m,
        dayHeader: newDay ? dayLabel(m.createdAt, now) : null,
        firstOfRun: !sameRun,
        lastOfRun: true,
      });
      if (sameRun) out[out.length - 2]!.lastOfRun = false;
      prev = m;
    }
    return out;
  }, [messages, now]);

  const memberCount = members.length;

  return (
    <div className="flex h-full min-h-[60vh] flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* Đầu luồng */}
      <header className="flex items-center gap-2 border-b border-border bg-card px-2.5 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
        <Link
          href={backHref}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"
          aria-label="Quay lại danh sách hội thoại"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <ConversationTile
          type={props.subtitle === "Nhóm lớp" ? "CLASS_GROUP" : "DM"}
          archived={Boolean(props.disabledReason)}
          className="hidden sm:inline-flex"
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold leading-5 text-foreground sm:text-base">{props.title}</h2>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{props.subtitle}</span>
            <span aria-hidden>·</span>
            <Link
              href={props.membersHref}
              className="-mx-1 inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 hover:bg-muted hover:text-foreground"
            >
              <Users className="size-3.5" aria-hidden />
              {memberCount} thành viên
            </Link>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {capabilities.canManageMembers && (
            <AddMemberButton conversationId={conversationId} conversationTitle={props.title} compact />
          )}
          {capabilities.canAnnounce && (
            <AnnouncementComposer
              conversationId={conversationId}
              disabled={Boolean(disabledReason)}
              onSent={(m) => mergeLocal(m)}
              compact
            />
          )}
        </div>
      </header>

      {/* Thông báo ghim */}
      {pinned && (
        <div className="flex items-start gap-2.5 border-b border-border bg-state-warning-soft px-3 py-2 sm:px-4">
          <Megaphone className="mt-0.5 size-4 shrink-0 text-state-warning-ink" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 whitespace-pre-wrap text-sm text-foreground">{pinned.body}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span>{timeFmt.format(pinned.createdAt)}</span>
              <Link href={announcementsHref} className="font-medium text-state-warning-ink underline underline-offset-2">
                Xem tất cả thông báo
              </Link>
            </p>
          </div>
        </div>
      )}

      {status === "error" && (
        <p className="flex items-center gap-1.5 bg-state-warning-soft px-3 py-1.5 text-xs text-state-warning-ink sm:px-4">
          <WifiOff className="size-3.5" aria-hidden />
          {error ?? "Mất kết nối tới máy chủ tin nhắn — đang thử lại"}
        </p>
      )}

      {/* Luồng tin */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-muted/40 px-3 py-3 sm:px-5">
        <div className="mx-auto flex max-w-3xl flex-col">
          {hasMore && (
            <div className="mb-2 text-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={loadOlder}
                disabled={loadingOlder}
                className="h-8 rounded-full bg-card text-xs"
              >
                {loadingOlder && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                Tải tin cũ hơn
              </Button>
            </div>
          )}

          {messages.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Chưa có tin nhắn nào trong hội thoại này.
            </p>
          )}

          {rows.map(({ m, dayHeader, firstOfRun, lastOfRun }) => (
            <div key={m.id}>
              {dayHeader && (
                <p className="sticky top-0 z-[1] my-3 flex justify-center">
                  <span className="rounded-full border border-border bg-card px-3 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm">
                    {dayHeader}
                  </span>
                </p>
              )}
              <MessageRow
                message={m}
                currentUserId={currentUserId}
                senderId={m.senderId}
                senderName={m.senderId ? (memberById.get(m.senderId)?.displayName ?? "Thành viên") : null}
                senderRole={m.senderId ? (memberById.get(m.senderId)?.roleLabel ?? null) : null}
                firstOfRun={firstOfRun}
                lastOfRun={lastOfRun}
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
            </div>
          ))}
        </div>
      </div>

      {/* Ô nhập */}
      <div className="border-t border-border bg-card px-2.5 py-2.5 sm:px-4 sm:py-3">
        {sendDisabled ? (
          <p className="flex items-center justify-center gap-2 rounded-lg bg-muted px-3 py-2.5 text-center text-xs text-muted-foreground">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            {disabledReason ?? "Bạn không có quyền gửi tin trong hội thoại này."}
          </p>
        ) : (
          <div className="mx-auto max-w-3xl space-y-1.5">
            {replyToId && (
              <ReplyComposerBar quote={quoteOf(replyToId)} onCancel={() => setReplyToId(null)} />
            )}
            <PendingUploadStrip uploads={uploader.uploads} onCancel={uploader.cancel} />
            <div className="flex items-end gap-1 rounded-2xl border border-border bg-background p-1.5 transition-colors focus-within:border-primary/60">
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
                rows={1}
                maxLength={BODY_MAX}
                className="max-h-40 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
                aria-label="Nội dung tin nhắn"
              />
              <Button
                type="button"
                onClick={submitDraft}
                disabled={
                  uploader.busy || (draft.trim().length === 0 && uploader.readyCount === 0)
                }
                className="size-10 shrink-0 rounded-xl p-0 sm:h-10 sm:w-auto sm:px-4"
                aria-label="Gửi tin nhắn"
              >
                <Send className="size-4" aria-hidden />
                <span className="hidden sm:inline">Gửi</span>
              </Button>
            </div>
            <p className="hidden px-1 text-[11px] text-muted-foreground sm:block">
              {uploader.busy
                ? "Đang tải ảnh lên — chờ xong rồi gửi."
                : "Enter để gửi · Shift + Enter để xuống dòng"}
            </p>
            {uploader.busy && (
              <p className="px-1 text-[11px] text-muted-foreground sm:hidden">
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
  senderId,
  senderName,
  senderRole,
  firstOfRun,
  lastOfRun,
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
  senderId: string | null;
  senderName: string | null;
  senderRole: string | null;
  /** Tin đầu của một cụm cùng người gửi — mới hiện tên + avatar. */
  firstOfRun: boolean;
  /** Tin cuối của cụm — mới hiện giờ + hành động. */
  lastOfRun: boolean;
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
      <p
        id={messageDomId(message.id)}
        className="mx-auto my-2 max-w-[90%] rounded-full bg-card/80 px-3 py-1 text-center text-xs text-muted-foreground"
      >
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
  const hasActions =
    hasFailed || (canReply && !pending && !message.deleted) || canRecall || canDelete;

  return (
    <div
      id={messageDomId(message.id)}
      className={cn(
        "group flex scroll-mt-12 gap-2 rounded-lg transition-colors",
        mine ? "flex-row-reverse" : "flex-row",
        firstOfRun ? "mt-3" : "mt-0.5",
        highlighted && "bg-primary/10 ring-2 ring-primary/40",
      )}
    >
      {/* Cột avatar: luôn chiếm chỗ để bong bóng cùng cụm thẳng hàng. */}
      {!mine && (
        <div className="w-8 shrink-0 pt-0.5">
          {firstOfRun && senderId && <PersonAvatar name={senderName ?? "Thành viên"} id={senderId} />}
        </div>
      )}

      <div className={cn("flex min-w-0 max-w-[82%] flex-col sm:max-w-[72%]", mine ? "items-end" : "items-start")}>
        {!mine && firstOfRun && (
          <p className="mb-0.5 flex min-w-0 max-w-full items-baseline gap-1.5 px-1">
            <span className="truncate text-xs font-semibold text-foreground">{senderName}</span>
            {senderRole && <span className="truncate text-[11px] text-muted-foreground">{senderRole}</span>}
          </p>
        )}

        {hasBubble && (
          <div
            className={cn(
              "whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed",
              message.deleted
                ? "bg-muted italic text-muted-foreground"
                : isAnnouncement
                  ? "bg-state-warning-soft text-foreground ring-1 ring-state-warning/40"
                  : mine
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-card text-foreground",
              mine ? "rounded-br-md" : "rounded-bl-md",
              pending && "opacity-70",
            )}
          >
            {isAnnouncement && !message.deleted && (
              <span className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-state-warning-ink">
                <Megaphone className="size-3" aria-hidden />
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

        {lastOfRun && (
          <div className="mt-0.5 flex min-h-6 items-center gap-1 px-1 text-[11px] text-muted-foreground">
            <span>{clockLabel(message.createdAt)}</span>
            {pending && !hasFailed && <span>· Đang gửi…</span>}
            {hasFailed && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-state-danger-ink hover:bg-state-danger-soft"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Chưa gửi được — gửi lại
              </button>
            )}
            {hasActions && (
              <span className="inline-flex items-center opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                {canReply && !pending && !message.deleted && (
                  <ActionIcon label="Trả lời" onClick={onReply}>
                    <CornerUpLeft className="size-3.5" aria-hidden />
                  </ActionIcon>
                )}
                {canRecall && (
                  <ActionIcon label="Thu hồi" onClick={onRecall}>
                    <Undo2 className="size-3.5" aria-hidden />
                  </ActionIcon>
                )}
                {canDelete && (
                  <ActionIcon label="Gỡ tin" onClick={onDelete} danger>
                    <Trash2 className="size-3.5" aria-hidden />
                  </ActionIcon>
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Nút hành động trên một tin — chỉ biểu tượng, nhãn nằm ở `aria-label` + tooltip gốc. */
function ActionIcon({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-card md:size-7",
        danger ? "hover:text-state-danger-ink" : "hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
