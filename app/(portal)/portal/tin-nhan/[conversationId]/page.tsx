// M2 — Luồng hội thoại (nhóm lớp) phía phụ huynh: US-09 + US-10 AC3.
//
// RSC tải: trạng thái hội thoại + 30 tin mới nhất + thành viên + thông báo mới nhất,
// rồi giao cho Client Component `ChatThread` (realtime + optimistic). Không có
// `useEffect` fetch nào ở tầng client cho dữ liệu ban đầu.
//
// Cổng chặn: `listConversationsForUser` chỉ trả hội thoại mà người dùng còn là thành
// viên hiệu lực ⇒ không tìm thấy = `notFound()`. Không phân biệt "không tồn tại" với
// "không phải thành viên" — đúng quy ước của tầng query (không xác nhận hộ id có thật).

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Megaphone, Users } from "lucide-react";
import { auth } from "@/lib/auth";
import {
  getConversationMembers,
  getMessagesPage,
  listConversationsForUser,
} from "@/lib/chat/queries";
import { listAnnouncements } from "@/lib/chat/announcements";
import { listChatAttachments } from "@/lib/chat/messages";
import { hasAcceptedChatPolicy } from "@/lib/chat/policy";
import { ChatPolicyGate } from "../_components/policy-gate";
import { ChatThread } from "@/components/chat/portal/chat-thread";
import { AnnouncementReadMarker } from "@/components/chat/portal/announcement-read-marker";
import { formatChatTimestamp } from "@/components/chat/portal/format";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Tin nhắn | Sata Robo",
  robots: { index: false },
};

/**
 * US-09 AC3 — ô nhập vô hiệu kèm ĐÚNG lý do, không gộp thành một câu chung chung.
 *
 * ⚠️ LOCKED cố ý KHÔNG nằm ở đây (US-15 AC3): Admin khoá/mở được GIỮA PHIÊN, nên trạng
 * thái đó đi đường riêng (`initialLocked` + broadcast `conversation.locked`) để ô nhập
 * đổi ngay mà không phải tải lại trang.
 */
function sendGate(
  status: string,
  type?: string,
): { canSend: boolean; reason: string | null } {
  if (status === "ARCHIVED") {
    // F5 — lý do đóng KHÁC nhau theo loại hội thoại, đừng nói câu sai sự thật với phụ
    // huynh: kênh tư vấn đóng vì hết phân công chăm sóc, chẳng liên quan gì tới lớp.
    // Giữ đúng ý của `DM_ARCHIVED_SYSTEM_TEXT` (lib/chat/dm.ts) để tin SYSTEM trong luồng
    // và câu dưới ô nhập nói cùng một chuyện.
    return {
      canSend: false,
      reason:
        type === "DM_SALE_PARENT"
          ? "Tư vấn viên này không còn phụ trách — hội thoại chỉ còn đọc."
          : type === "DM_TEACHER_PARENT"
            ? "Quan hệ dạy học đã kết thúc — hội thoại chỉ còn đọc."
            : "Lớp đã kết thúc — hội thoại chỉ còn đọc, không gửi tin được.",
    };
  }
  return { canSend: true, reason: null };
}

export default async function PortalConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  const userId = session.user.id;
  const { conversationId } = await params;

  // US-16 AC2 — cổng chính sách, kiểm TRƯỚC mọi truy vấn nội dung (layout đã chặn; đây là
  // lớp thứ hai để bất biến "chưa đồng ý ⇒ không đọc" không nằm nhờ ở quy ước framework).
  if (!(await hasAcceptedChatPolicy(userId))) return <ChatPolicyGate />;

  const conversations = await listConversationsForUser(userId);
  const conversation = conversations.find(
    (c) => c.conversationId === conversationId,
  );
  if (!conversation) notFound();

  const [page, members, announcements] = await Promise.all([
    getMessagesPage(conversationId, userId),
    getConversationMembers(conversationId, userId),
    listAnnouncements(conversationId, userId, { limit: 1 }),
  ]);

  // US-11 — ảnh của đúng 30 tin vừa tải. Chạy SAU vì cần danh sách id; tách khỏi tầng đọc
  // chung (`getMessagesPage`) để mọi đường đọc khác không phải gánh thêm một join cho thứ
  // mà tuyệt đại đa số tin không có.
  const initialAttachments = await listChatAttachments(
    conversationId,
    userId,
    page.messages.map((m) => m.id),
  );

  const pinned = announcements.announcements[0] ?? null;
  const gate = sendGate(conversation.status, conversation.type);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <Link
          href="/portal/tin-nhan"
          aria-label="Quay lại danh sách tin nhắn"
          className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1 py-1">
          <h1 className="truncate text-lg font-bold text-foreground">
            {conversation.displayName}
          </h1>
          <p className="text-xs text-muted-foreground">
            {members.length} thành viên
            {conversation.statusLabel ? ` · ${conversation.statusLabel}` : ""}
          </p>
        </div>
        <Link
          href={`/portal/tin-nhan/${conversationId}/thanh-vien`}
          aria-label="Thành viên nhóm"
          className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Users className="size-5" />
        </Link>
      </div>

      {pinned && (
        // Ghim thông báo MỚI NHẤT trên cùng (US-09 AC2). Mốc "đã đọc" ghi khi khối này
        // vào viewport (US-10 AC3) — không phải khi mở trang.
        <AnnouncementReadMarker messageId={pinned.id}>
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
                <Megaphone className="size-3.5" /> Thông báo mới nhất
              </p>
              <Link
                href={`/portal/tin-nhan/${conversationId}/thong-bao`}
                className="inline-flex min-h-[32px] shrink-0 items-center text-[11px] font-semibold text-primary hover:underline"
              >
                Xem tất cả thông báo
              </Link>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
              {pinned.body}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {formatChatTimestamp(pinned.createdAt)}
            </p>
          </div>
        </AnnouncementReadMarker>
      )}

      <ChatThread
        conversationId={conversationId}
        currentUserId={userId}
        members={members.map((m) => ({
          userId: m.userId,
          displayName: m.displayName,
          roleLabel: m.roleLabel,
        }))}
        initialMessages={page.messages}
        initialAttachments={initialAttachments}
        initialCursor={page.nextCursor}
        initialHasMore={page.hasMore}
        canSend={gate.canSend}
        disabledReason={gate.reason}
        initialLocked={conversation.status === "LOCKED"}
      />
    </div>
  );
}
