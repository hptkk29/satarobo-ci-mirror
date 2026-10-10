// M4 — Thành viên nhóm lớp (phía phụ huynh).
//
// ⚠️ Việc ẩn liên hệ (BR-30) đã quyết định Ở TẦNG QUERY: `getConversationMembers` KHÔNG
// tạo ra khoá `contact` khi người xem có vai PARENT. Trang này vì thế KHÔNG lọc lại gì
// và cũng KHÔNG hiển thị field nào ngoài thứ query trả về — thêm một bộ lọc thứ hai ở
// UI là tạo cơ hội cho hai bộ luật lệch nhau.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import {
  getConversationMembers,
  listConversationsForUser,
} from "@/lib/chat/queries";
import { hasAcceptedChatPolicy } from "@/lib/chat/policy";
import { ChatPolicyGate } from "../../_components/policy-gate";
import { formatVnDate } from "@/components/chat/portal/format";
import { OpenDmButton } from "@/components/chat/open-dm-button";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Thành viên nhóm | Sata Robo",
  robots: { index: false },
};

export default async function PortalConversationMembersPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  const userId = session.user.id;
  const { conversationId } = await params;

  // US-16 AC2 — cổng chính sách (lớp thứ hai sau layout của segment).
  if (!(await hasAcceptedChatPolicy(userId))) return <ChatPolicyGate />;

  const conversations = await listConversationsForUser(userId);
  const conversation = conversations.find(
    (c) => c.conversationId === conversationId,
  );
  if (!conversation) notFound();

  const members = await getConversationMembers(conversationId, userId);

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
            Thành viên nhóm
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {conversation.displayName}
          </p>
        </div>
      </div>

      {members.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Nhóm chưa có thành viên nào.
        </p>
      ) : (
        <ul className="space-y-2">
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex min-h-[56px] items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
            >
              <span
                className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold uppercase text-muted-foreground"
                aria-hidden
              >
                {m.displayName.trim().slice(-1)[0] ?? "?"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {m.displayName}
                  {m.userId === userId && (
                    <span className="ml-1 font-normal text-muted-foreground">
                      (bạn)
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {m.roleLabel} · tham gia {formatVnDate(m.joinedAt)}
                </span>
                {/* `contact` chỉ tồn tại khi query quyết định người xem được thấy. */}
                {m.contact && (m.contact.phone || m.contact.email) && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {[m.contact.phone, m.contact.email]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </span>
              {/* US-13 AC1 — chỉ với GIÁO VIÊN của nhóm (`derivedFrom` là tư cách TRONG
                  nhóm, không phải vai hệ thống). Server vẫn kiểm quan hệ dạy học lần nữa. */}
              {m.derivedFrom === "CLASS_TEACHER" && m.userId !== userId && (
                <OpenDmButton
                  peerUserId={m.userId}
                  hrefTemplate="/portal/tin-nhan/:id"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
