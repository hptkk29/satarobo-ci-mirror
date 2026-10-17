// US-09 AC2 — "Xem tất cả thông báo": lọc `kind=ANNOUNCEMENT` của một hội thoại.
//
// RSC + phân trang cursor qua `?cursor=` (cùng cursor `(createdAt, id)` với luồng
// chính, KHÔNG offset). Mỗi thông báo vẫn được bọc `AnnouncementReadMarker` — mốc đã
// đọc ghi khi thông báo VÀO VIEWPORT (US-10 AC3), kể cả ở màn này.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Megaphone } from "lucide-react";
import { auth } from "@/lib/auth";
import { listConversationsForUser } from "@/lib/chat/queries";
import { listAnnouncements } from "@/lib/chat/announcements";
import { hasAcceptedChatPolicy } from "@/lib/chat/policy";
import { ChatPolicyGate } from "../../_components/policy-gate";
import { AnnouncementReadMarker } from "@/components/chat/portal/announcement-read-marker";
import { formatChatTimestamp } from "@/components/chat/portal/format";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Thông báo nhóm lớp | Sata Robo",
  robots: { index: false },
};

export default async function PortalConversationAnnouncementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  const userId = session.user.id;
  const { conversationId } = await params;
  const { cursor } = await searchParams;

  // US-16 AC2 — cổng chính sách (lớp thứ hai sau layout của segment). Quan trọng ở ĐÚNG
  // trang này: thông báo là thứ PH thấy đầu tiên, và mở nó cũng GHI mốc "đã đọc".
  if (!(await hasAcceptedChatPolicy(userId))) return <ChatPolicyGate />;

  const conversations = await listConversationsForUser(userId);
  const conversation = conversations.find(
    (c) => c.conversationId === conversationId,
  );
  if (!conversation) notFound();

  const page = await listAnnouncements(conversationId, userId, {
    cursor: cursor ?? null,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <Link
          href={`/portal/tin-nhan/${conversationId}`}
          aria-label="Quay lại hội thoại"
          className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1 py-1">
          <h1 className="truncate text-lg font-bold text-foreground">
            Tất cả thông báo
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {conversation.displayName}
          </p>
        </div>
      </div>

      {page.announcements.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Nhóm lớp chưa có thông báo nào.
        </p>
      ) : (
        <ul className="space-y-2">
          {page.announcements.map((a) => (
            <li key={a.id}>
              <AnnouncementReadMarker messageId={a.id}>
                <div className="rounded-xl border border-border bg-card p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
                    <Megaphone className="size-3.5" /> Thông báo
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
                    {a.body}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formatChatTimestamp(a.createdAt)}
                  </p>
                </div>
              </AnnouncementReadMarker>
            </li>
          ))}
        </ul>
      )}

      {page.hasMore && page.nextCursor && (
        <Link
          href={`/portal/tin-nhan/${conversationId}/thong-bao?cursor=${encodeURIComponent(page.nextCursor)}`}
          scroll={false}
          className="flex min-h-[44px] items-center justify-center rounded-xl border border-border bg-card text-sm font-semibold text-foreground transition-colors hover:bg-muted"
        >
          Xem thông báo cũ hơn
        </Link>
      )}
    </div>
  );
}
