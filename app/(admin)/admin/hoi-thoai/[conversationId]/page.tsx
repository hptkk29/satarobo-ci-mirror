// app/(admin)/admin/hoi-thoai/[conversationId]/page.tsx — US-15 AC1/AC2/AC3.
//
// ⚠️ TRANG NÀY KHÔNG TẢI NỘI DUNG. Nó chỉ dựng HỒ SƠ hội thoại (tên lớp, cơ sở, trạng
// thái, số thành viên, số tin) rồi giao cho Client Component. Nội dung tin chỉ về máy
// người xem qua Server Action `adminLookupConversationAction`, vốn đòi `reason` và ghi
// AuditLog TRƯỚC khi đọc (F-AUDIT).
//
// Vì sao ĐÓ là điểm mấu chốt: nếu RSC này tải sẵn 50 tin rồi để client "ẩn cho tới khi
// nhập lý do" thì nội dung ĐÃ nằm trong HTML — mở DevTools là đọc được, không cần lý do,
// không có dòng audit nào. Đúng cái AC1 gọi là "vòng qua modal".
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { loadAdminConversationMeta } from "@/lib/chat/admin";
import { AdminConversationViewer } from "../_components/conversation-viewer";

export const metadata = { title: "Hồ sơ hội thoại | Admin" };
export const dynamic = "force-dynamic";

export default async function AdminConversationDetailPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!(await checkPermission("chat:admin"))) redirect("/dashboard?error=unauthorized");

  const { conversationId } = await params;
  const meta = await loadAdminConversationMeta(conversationId);
  if (!meta) notFound();

  return (
    <div className="space-y-5">
      <Link
        href="/hoi-thoai"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Về danh sách hội thoại
      </Link>

      <AdminConversationViewer
        conversationId={meta.conversationId}
        displayName={meta.className ?? meta.title ?? "Hội thoại"}
        type={meta.type}
        initialStatus={meta.status}
        centerName={meta.centerName}
        participantCount={meta.participantCount}
        messageCount={meta.messageCount}
        lastMessageAt={meta.lastMessageAt}
      />
    </div>
  );
}
