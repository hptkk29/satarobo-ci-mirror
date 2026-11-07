// M1 — Danh sách hội thoại của phụ huynh (US-08).
//
// ĐÃ THAY hệ chat cũ (`lib/conversation/service.ts` + `ConversationMessage`) bằng hệ
// `Conversation/ConversationParticipant/Message` — chốt Q3, `docs/chat-realtime/
// 00-dieu-chinh-cho-repo.md`.
//
// Thiết kế lại theo artifact Tin-nhan.dc.html: DANH SÁCH hội thoại nay nằm ở `layout.tsx` (cột trái của khung 2 cột, đã nằm sau cổng
// chính sách). Trang này chỉ còn là CỘT PHẢI khi chưa chọn hội thoại nào (chỉ hiện từ 900px; dưới 900px khung chỉ hiện danh sách).
import { auth } from "@/lib/auth";
import { hasAcceptedChatPolicy } from "@/lib/chat/policy";
import { ChatPolicyGate } from "./_components/policy-gate";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Tin nhắn | Sata Robo",
  robots: { index: false },
};

export default async function PortalMessagesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <p className="m-6 rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Vui lòng đăng nhập để xem tin nhắn.
      </p>
    );
  }
  // US-16 AC2 — kiểm lại ở đây để bất biến "chưa đồng ý ⇒ server không truy vấn nội dung" không phụ thuộc quy ước render của framework.
  if (!(await hasAcceptedChatPolicy(session.user.id))) return <ChatPolicyGate />;

  return (
    <div className="flex flex-1 items-center justify-center bg-background p-8 text-center text-sm text-[var(--sr-ink-muted)]">
      Chọn một cuộc trò chuyện ở bên trái để xem tin nhắn.
    </div>
  );
}
