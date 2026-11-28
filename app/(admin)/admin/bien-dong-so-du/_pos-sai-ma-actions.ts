"use server";

// DUYỆT / TỪ CHỐI yêu cầu "sale nhập sai mã trên máy" — hai Server Action của KẾ TOÁN ở `/admin/bien-dong-so-du` (Việc 3 ·
// 09/10/2026). Thiết kế: docs/pos-hai-nut-khai-may.md §5.3.7–5.3.8.
//
// Quyền: `payments:manage` (V58) — là TẬP CON của "được gắn tay" ở mọi trạng thái cờ (`congGanVaoDon` khi cờ tắt chỉ cho
// `payments:manage`) nên không nới ai; và là nghĩa của chữ "kế toán" trên màn (dùng `payments:record` thì đồng nghiệp sale — cũng
// giữ quyền đó — duyệt được yêu cầu của sale). KHÔNG đẻ quyền mới ⇒ không cần `seed-prod-roles.yml`. Thêm: đơn trong phạm vi
// (`scopedDb` + `passesScope`) và người quyết ≠ người gửi (ở lib; DB còn CHECK làm lưới cuối).
//
// ⚠️ KHÔNG viết phép ghi tiền ở đây (lưới `[HN3-W1]`). Duyệt KHÔNG đi qua `ganTienTheoCon`: đường gắn tay không phát
// `phieu-gop.da-chia` ⇒ khoản được duyệt sẽ không chuyển đổi lead, không báo sale, không biên nhận (TỰ QUYẾT V55). Đường gắn tay của
// kế toán vẫn nguyên ở bảng giao dịch phía trên — không gỡ gì.
// ⚠️ File "use server" chỉ export async function.
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { passesScope, scopedDb } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { duyetSaiMa, tuChoiSaiMa } from "@/lib/payments/pos/sai-ma-ghi";
import { QUYEN_KE_TOAN_SAI_MA, quyenTaiCoSoCuaDon } from "@/lib/payments/pos/quyen-co-so";
import { duyetSaiMaSchema, tuChoiSaiMaSchema } from "@/lib/validators/phieu-pos";

/** Cổng chung: quyền `payments:manage` + đơn của yêu cầu nằm trong phạm vi người bấm. */
async function congKeToanSaiMa(orderId: string) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Chưa đăng nhập" };
  if (!(await checkPermission("payments:manage"))) {
    return { ok: false as const, error: "Không có quyền" };
  }
  const actor = await resolveActor(session.user.id);
  const order = await scopedDb(actor).order.findUnique({
    where: { id: orderId },
    select: { id: true, centerId: true, orgUnitId: true },
  });
  // Người đa vai (kế toán@CS1 + sale@CS2 duyệt yêu cầu của CS2): xem lib/payments/pos/quyen-co-so.ts (chỉ v2).
  if (!order || !passesScope("Order", order, actor) || !quyenTaiCoSoCuaDon(actor, QUYEN_KE_TOAN_SAI_MA, order.centerId)) {
    return { ok: false as const, error: "Không tìm thấy đơn hàng" };
  }
  const { actorId, actorName } = getAuditActor(session);
  return { ok: true as const, order, actor: { id: actorId ?? "", name: actorName } };
}

function lamMoi(orderId: string) {
  revalidatePath("/admin/bien-dong-so-du");
  revalidatePath("/bien-dong-so-du");
  revalidatePath(`/orders/${orderId}`);
}

export type KetQuaQuyetSaiMaAction = { ok: true; trangThai: string; thongDiep: string } | { ok: false; error: string };

/** Duyệt — MỘT bấm, không hộp xác nhận (đặc tả). Kẹt ở "đang ghi" ≥ 2 phút thì chính nút này là "thử lại". */
export async function duyetSaiMaAction(input: unknown): Promise<KetQuaQuyetSaiMaAction> {
  const parsed = duyetSaiMaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const cong = await congKeToanSaiMa(parsed.data.orderId);
  if (!cong.ok) return { ok: false, error: cong.error };

  const kq = await duyetSaiMa({
    orderId: cong.order.id,
    yeuCauId: parsed.data.yeuCauId,
    actor: cong.actor,
    now: new Date(),
  });
  lamMoi(cong.order.id);
  if (!kq.ok) return { ok: false, error: kq.error };
  return { ok: true, trangThai: kq.trangThai, thongDiep: kq.thongDiep };
}

/** Từ chối — lý do BẮT BUỘC (≥ 5 ký tự, kiểm ở zod, ở lib và ở CHECK của DB). */
export async function tuChoiSaiMaAction(input: unknown): Promise<KetQuaQuyetSaiMaAction> {
  const parsed = tuChoiSaiMaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const cong = await congKeToanSaiMa(parsed.data.orderId);
  if (!cong.ok) return { ok: false, error: cong.error };

  const kq = await tuChoiSaiMa({
    orderId: cong.order.id,
    yeuCauId: parsed.data.yeuCauId,
    lyDo: parsed.data.lyDo,
    actor: cong.actor,
    now: new Date(),
  });
  lamMoi(cong.order.id);
  if (!kq.ok) return { ok: false, error: kq.error };
  return { ok: true, trangThai: kq.trangThai, thongDiep: kq.thongDiep };
}
