// app/(admin)/admin/tin-nhan/page.tsx — sóng 3 Đợt 1: chuyển màn tin nhắn của site
// admin sang HỆ CHAT MỚI (`Conversation`/`Message`, realtime).
//
// Hệ CŨ (`lib/conversation/service.ts` + model `ConversationMessage`, cùng
// `./_actions.ts` và `./_components/reply-form.tsx`) GIỮ NGUYÊN, KHÔNG xoá — quyết định
// Q3 của `docs/chat-realtime/00-dieu-chinh-cho-repo.md` là "thay thế ở route này", còn
// dữ liệu cũ và đường di trú vẫn phải đọc được. Route này chỉ ngừng DÙNG hệ cũ.
//
// Giao diện dùng chung với site giáo viên (`components/chat/staff/*`): QLCS là MEMBER
// của nhóm lớp thuộc cơ sở mình (PRD §7.2 điều chỉnh 07/08) nên gửi được cả CHAT lẫn
// ANNOUNCEMENT, đúng cùng bộ nút với GV.
//
// CỔNG QUYỀN — GIỮ NGUYÊN `PAGE_GATES["/tin-nhan"]`, cố ý KHÔNG đổi sang `chat:read`:
//   • bảng `PAGE_GATES` là hợp đồng "menu ≡ gate" (`page-gates.test.ts`) và sidebar đọc
//     chính mảng này — đổi ở đây là đổi cả menu;
//   • ⚠️ `chat:read` KHÔNG dùng được làm gate cấp TRANG: dưới RBAC v2 (đang bật trên
//     prod) QLCS giữ nó với scope CENTER, mà `scopeMatches` đòi `target.centerId`
//     (lib/auth/can.ts:18) — gọi không target sẽ trả FALSE và khoá cửa chính QLCS, dù ở
//     máy dev (v1 tĩnh) vẫn xanh. Quyền theo từng hội thoại (gửi/thông báo/gỡ tin) được
//     kiểm CÓ TARGET trong `chat-workspace`, và mỗi Server Action kiểm lại lần nữa.
//   • Vai vào được trang nhưng không thuộc hội thoại nào (vd Sale) chỉ thấy danh sách
//     rỗng: phạm vi đọc là participant-based, không phải role-based (delta E.3).
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { StaffChatWorkspace } from "@/components/chat/staff/chat-workspace";
import { listAssignableParentsForSale } from "@/lib/chat/dm";

export const metadata = { title: "Tin nhắn | Admin" };
export const dynamic = "force-dynamic";

export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; tab?: string; ac?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!(await checkAnyPermission(PAGE_GATES["/tin-nhan"]))) {
    redirect("/dashboard");
  }

  const sp = await searchParams;
  // F5 — sale THUẦN (không kiêm vai nào khác) không có nhóm lớp nào, chỉ có kênh 1-1.
  // Câu mô tả và ô rỗng phải nói đúng thứ họ thấy, và chỉ đường tới chỗ mở kênh.
  const vaiTro = [session.user.role, ...(session.user.roles ?? [])].filter(Boolean);
  const laSaleThuan =
    vaiTro.includes("SALES_CSM") &&
    vaiTro.every((r) => r === "SALES_CSM" || r === "PARENT");
  // Chỉ nạp cho vai MỞ ĐƯỢC kênh mới. GV/QLCS không có quyền mở 1-1 với phụ huynh nên
  // đưa danh sách xuống client cho họ là vừa thừa vừa lộ dữ liệu không cần thiết.
  const phDuocGan = vaiTro.includes("SALES_CSM")
    ? await listAssignableParentsForSale(session.user.id)
    : [];

  return (
    <div>
      <StaffChatWorkspace
        userId={session.user.id}
        basePath="/tin-nhan"
        conversationId={sp.c}
        tab={sp.tab}
        announcementCursor={sp.ac}
        emptyHint={
          laSaleThuan
            ? "Chưa có hội thoại nào. Gõ tên phụ huynh hoặc tên học viên vào ô tìm kiếm bên trái để mở kênh riêng."
            : "Chưa có hội thoại nào. Nhóm lớp được tạo tự động khi lớp chuyển sang trạng thái hoạt động — quản lý cơ sở được thêm vào nhóm của các lớp thuộc cơ sở mình."
        }
        assignableParents={phDuocGan}
      />
    </div>
  );
}
