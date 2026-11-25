"use server";

// Server Action "Thu trước" (cọc) trên trang đơn — xem `lib/orders/thu-truoc.ts`.
// Quyền `payments:record` (việc thường ngày của sale / quản lý / kế toán cơ sở — cùng quyền với phát phiếu gộp), phạm vi cơ sở
// qua `scopedDb` (id đơn của cơ sở khác trả "không tìm thấy" — câu chữ cố ý không phân biệt).
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { passesScope, scopedDb } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { thuTruocChoDon } from "@/lib/orders/thu-truoc-ghi";

export async function thuTruocAction(input: { orderId: string; soTien: number; hanConLai?: string | null }) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Chưa đăng nhập" };
  if (!(await checkPermission("payments:record"))) return { ok: false as const, error: "Không có quyền" };

  const actor = await resolveActor(session.user.id);
  const order = await scopedDb(actor).order.findUnique({
    where: { id: String(input.orderId ?? "") },
    select: { id: true, centerId: true, orgUnitId: true },
  });
  if (!order || !passesScope("Order", order, actor)) return { ok: false as const, error: "Không tìm thấy đơn hàng" };

  const { actorId, actorName } = getAuditActor(session);
  const kq = await thuTruocChoDon({ orderId: order.id, soTien: input.soTien, hanConLai: input.hanConLai, actor: { id: actorId, name: actorName } });
  if (!kq.ok) return { ok: false as const, error: kq.error };

  revalidatePath(`/orders/${order.id}`);
  return { ok: true as const, soTien: kq.soTien, conLai: kq.conLai };
}
