// US-16 AC2 — CỔNG CHÍNH SÁCH của toàn bộ `/portal/tin-nhan/**`.
//
// Vì sao đặt ở layout của segment (file này) chứ không ở `portal/layout.tsx`: cổng chỉ
// được chắn TRƯỚC CỬA CHAT, không chắn cả cổng phụ huynh (học phí, học bạ, lịch học không
// liên quan gì tới chính sách chat). Layout này bọc danh sách hội thoại, luồng tin, danh
// sách thành viên và trang thông báo — không phải nhớ thêm chỗ nào khi có route con mới.
//
// ⚠️ Đây KHÔNG phải "ẩn UI": khi chưa đồng ý, `children` không bao giờ được đưa vào cây
// React ⇒ page RSC bên dưới KHÔNG chạy ⇒ không một truy vấn nội dung nào được thực hiện.
// Dù vậy MỖI page vẫn tự kiểm lại một lần (defense-in-depth): layout là quy ước của
// framework, còn "server không trả nội dung" là bất biến bảo mật — không gửi nó đi nhờ.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasAcceptedChatPolicy } from "@/lib/chat/policy";
import { ChatPolicyGate } from "./_components/policy-gate";

export const dynamic = "force-dynamic";

export default async function PortalMessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  if (await hasAcceptedChatPolicy(session.user.id)) return <>{children}</>;
  return <ChatPolicyGate />;
}
