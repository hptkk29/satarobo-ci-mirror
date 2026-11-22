// app/(teacher)/teacher/tin-nhan/page.tsx — sóng 3 Đợt 1: lối vào chat TRÊN SITE GIÁO VIÊN.
//
// Trước trang này, GV muốn nhắn phụ huynh phải rời site GV sang site admin — khoảng
// trống lớn nhất của hệ chat mới. Nay nhóm lớp + 1-1 của GV nằm ngay trong site GV,
// dùng CHUNG một bộ component với `/tin-nhan` bên admin (`components/chat/staff/*`) để
// hai bề mặt không trôi lệch tính năng như hệ cũ.
//
// CỔNG QUYỀN — cố ý KHÔNG thêm `checkPermission("chat:read")` ở đây:
//   1. layout `app/(teacher)/teacher/layout.tsx` đã chặn: chưa login → /login, không có
//      role TEACHER → về khu của họ, user bị vô hiệu hoá → /dang-xuat;
//   2. quyền ĐỌC chat là PARTICIPANT-BASED, không phải role-based (delta E.3): danh
//      sách chỉ trả hội thoại mà chính người này còn là thành viên hiệu lực, nên gate
//      theo vai không thêm được lớp bảo vệ nào;
//   3. ⚠️ QUAN TRỌNG — `checkPermission("chat:read")` KHÔNG TRUYỀN TARGET sẽ trả FALSE
//      dưới RBAC v2 (đang bật trên prod): GV giữ `chat:read` với scope ASSIGNED, mà
//      `scopeMatches` cần `target.classId` (lib/auth/can.ts:29). Ở máy dev (v1 tĩnh) nó
//      lại trả TRUE ⇒ đúng dạng bug "chạy máy tôi thì được", chặn sạch GV trên prod.
//      Quyền có target được kiểm ĐÚNG CHỖ: trong `chat-workspace` cho từng hội thoại.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { StaffChatWorkspace } from "@/components/chat/staff/chat-workspace";
import { PageHeader } from "../_components/ui/page-header";

export const metadata = { title: "Tin nhắn | Giáo viên Sata Robo" };
export const dynamic = "force-dynamic";

export default async function TeacherMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; tab?: string; ac?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const sp = await searchParams;

  return (
    <div>
      <PageHeader
        title="Tin nhắn"
        subtitle="Nhóm lớp bạn dạy và các cuộc trao đổi riêng với phụ huynh."
      />
      <StaffChatWorkspace
        userId={session.user.id}
        basePath="/teacher/tin-nhan"
        conversationId={sp.c}
        tab={sp.tab}
        announcementCursor={sp.ac}
        emptyHint="Chưa có hội thoại nào. Nhóm lớp được tạo tự động khi lớp bạn dạy chuyển sang trạng thái hoạt động."
      />
    </div>
  );
}
