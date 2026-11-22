import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";

// /leads/[id]/convert — ĐÃ BỎ MÀN CHỐT LEAD RIÊNG [chủ dự án chốt 27/10/2026]. Chỉ còn MỘT màn chuyển đổi: `/orders/[id]/chuyen-doi` (xếp học viên của ĐƠN vào lớp).
//
// Route giữ lại làm LỐI CHUYỂN HƯỚNG (bookmark, link cũ, thông báo cũ trong DB) — không có giao diện riêng:
//   · lead đã có đơn còn sống   ⇒ màn chuyển đổi của đơn mới nhất;
//   · lead chưa có đơn          ⇒ tạo đơn gắn lead (`/orders/new?leadId=…`) — chuyển đổi chỉ làm được sau khi có đơn + tiền về.
// Hai chức năng của màn cũ đã dời: ĐỒNG Ý HÌNH ẢNH → ô tick ở màn chuyển đổi đơn; HỌC BỔNG 100% → nút "Cấp học bổng 100%" trên trang đơn (chỉ Quản trị tối cao).
// ⚠️ `actions.ts` cùng thư mục (`submitConvertV2`) KHÔNG còn màn nào gọi; giữ để `bulk-convert` và các bộ test tài chính cũ chưa phải đổi theo.
export const dynamic = "force-dynamic";

export default async function ChuyenHuongChotLead({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;

  if (!(await checkPermission("enrollments:create"))) redirect(`/leads/${id}`);

  const actor = await resolveActor(session.user.id);
  const don = await scopedDb(actor).order.findFirst({
    where: { leadId: id, deletedAt: null, status: { notIn: ["CANCELLED", "REFUNDED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  redirect(don ? `/orders/${don.id}/chuyen-doi` : `/orders/new?leadId=${encodeURIComponent(id)}`);
}
