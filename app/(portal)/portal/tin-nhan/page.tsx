// M1 — Danh sách hội thoại của phụ huynh (US-08).
//
// ĐÃ THAY hệ chat cũ (`lib/conversation/service.ts` + `ConversationMessage`) bằng hệ
// `Conversation/ConversationParticipant/Message` — chốt Q3, `docs/chat-realtime/
// 00-dieu-chinh-cho-repo.md`. Hệ cũ GIỮ NGUYÊN trong repo, chỉ không còn dùng ở route này.
//
// RSC thuần: `listConversationsForUser` đã lo phạm vi (participant còn hiệu lực),
// thứ tự (lastMessageAt DESC, NULL cuối) và dòng preview (tin đã gỡ → "Tin nhắn đã
// được gỡ"). Trang này KHÔNG lọc lại gì — chỉ tách khối ARCHIVED xuống dưới (AC4).

import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { auth } from "@/lib/auth";
import {
  listConversationsForUser,
  type ConversationListItem,
} from "@/lib/chat/queries";
import { hasAcceptedChatPolicy } from "@/lib/chat/policy";
import { listSalesForParent } from "@/lib/chat/dm";
import { OpenDmButton } from "@/components/chat/open-dm-button";
import { formatConversationTime } from "@/components/chat/portal/format";
import { ChatListRefresher } from "@/components/chat/chat-list-refresher";
import { ChatPolicyGate } from "./_components/policy-gate";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Tin nhắn | Sata Robo",
  robots: { index: false },
};

function ConversationRow({
  item,
  now,
}: {
  item: ConversationListItem;
  now: Date;
}) {
  const preview = item.lastMessage;
  return (
    <li>
      <Link
        href={`/portal/tin-nhan/${item.conversationId}`}
        // AC5 — vùng chạm ≥44px trên mobile 360px; `min-w-0` + `truncate` để tên lớp
        // dài không đẩy badge ra ngoài khung.
        className="flex min-h-[64px] items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 transition-colors hover:bg-muted"
      >
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-full",
            item.isArchived
              ? "bg-muted text-muted-foreground"
              : "bg-primary/10 text-primary",
          )}
          aria-hidden
        >
          <MessagesSquare className="size-5" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm text-foreground",
                item.unreadCount > 0 ? "font-bold" : "font-semibold",
              )}
            >
              {item.displayName}
            </span>
            {item.lastMessageAt && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatConversationTime(item.lastMessageAt, now)}
              </span>
            )}
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-xs",
                preview?.deleted
                  ? "italic text-muted-foreground"
                  : "text-muted-foreground",
              )}
            >
              {preview ? preview.text : "Chưa có tin nhắn nào"}
            </span>
            {item.unreadCount > 0 && (
              <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                {item.unreadCount > 9 ? "9+" : item.unreadCount}
              </span>
            )}
          </span>
          {item.statusLabel && (
            <span className="mt-1 inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {item.statusLabel}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

export default async function PortalMessagesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Vui lòng đăng nhập để xem tin nhắn.
      </p>
    );
  }

  // US-16 AC2 — cổng chính sách. `layout.tsx` của segment đã chặn trước (children không
  // vào cây React nên page này không chạy); kiểm lại ở đây để bất biến "chưa đồng ý ⇒
  // server không truy vấn nội dung" không phụ thuộc vào quy ước render của framework.
  // Tốn 0 truy vấn thừa: `hasAcceptedChatPolicy` là `cache()` theo request.
  if (!(await hasAcceptedChatPolicy(session.user.id)))
    return <ChatPolicyGate />;

  const conversations = await listConversationsForUser(session.user.id);
  // F5 — tư vấn viên đang phụ trách phụ huynh này. Trả về DANH SÁCH: một PH nhiều con,
  // mỗi ghi danh có `saleId` riêng ⇒ hai sale khác nhau là chuyện bình thường.
  const sales = await listSalesForParent(session.user.id);
  // AC4 — ARCHIVED xuống dưới; trong mỗi khối giữ NGUYÊN thứ tự của query.
  const active = conversations.filter((c) => !c.isArchived);
  const archived = conversations.filter((c) => c.isArchived);
  const now = new Date();

  return (
    <div className="space-y-5">
      {/* Tin mới ở nhóm bất kỳ ⇒ chạy lại RSC này (trang `force-dynamic`) ⇒ nhóm đó lên
          đầu, đổi preview + giờ + badge. Không render gì ra màn hình. */}
      <ChatListRefresher userId={session.user.id} />

      <div>
        <h1 className="text-xl font-bold text-foreground">Tin nhắn</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Nhóm lớp của con — trao đổi trực tiếp với giáo viên và trung tâm.
        </p>
      </div>

      {/* F5 — lối vào kênh riêng với tư vấn viên. Đặt ở ĐÂY chứ không phải dashboard
          `/portal`: `openDmAction` là Server Action DUY NHẤT không đi qua `chatPolicyBlock`,
          mà trang này nằm sau cổng chính sách (kiểm ở layout VÀ ngay đầu page) — đặt chỗ
          khác là tạo được hội thoại TRƯỚC khi phụ huynh bấm đồng ý. */}
      {sales.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">
            Tư vấn viên phụ trách
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Hỏi về học phí, lịch học thử, chuyển lớp — nhắn riêng, không hiện
            trong nhóm lớp.
          </p>
          <ul className="mt-3 space-y-2">
            {sales.map((s) => (
              <li
                key={s.saleUserId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {s.saleName ?? "Tư vấn viên"}
                  </p>
                  {s.childNames.length > 0 && (
                    <p className="truncate text-xs text-muted-foreground">
                      Phụ trách: {s.childNames.join(" · ")}
                    </p>
                  )}
                </div>
                <OpenDmButton
                  peerUserId={s.saleUserId}
                  kind="SALE_PARENT"
                  hrefTemplate="/portal/tin-nhan/:id"
                  label="Nhắn riêng"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {conversations.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Chưa có hội thoại nào. Nhóm lớp sẽ xuất hiện ở đây khi lớp của con bắt
          đầu hoạt động.
        </p>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <ul className="space-y-2">
              {active.map((c) => (
                <ConversationRow key={c.conversationId} item={c} now={now} />
              ))}
            </ul>
          )}

          {archived.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Đã lưu trữ
              </h2>
              <ul className="space-y-2">
                {archived.map((c) => (
                  <ConversationRow key={c.conversationId} item={c} now={now} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
