"use server";

// "TÔI NHẬP SAI MÃ TRÊN MÁY" — hai Server Action của SALE trên hộp phiếu thẻ POS (Việc 3 · 09/10/2026).
// Thiết kế: docs/pos-hai-nut-khai-may.md §5.3.7–5.3.8.
//
//   · `timUngVienSaiMaAction` — bấm nút ⇒ máy chủ tìm ỨNG VIÊN (sale KHÔNG gõ tự do): chỉ đọc, không khoá;
//   · `guiSaiMaAction`        — chọn một giao dịch ⇒ khoá + cổng + GIỮ; đúng điều kiện thì tự ghi nhận (đi CHUNG đường tiền với
//     khớp tự động), còn lại chờ kế toán duyệt.
//
// Quyền: `payments:pos-check` + đơn trong phạm vi người bấm (`scopedDb` + `passesScope`); KHÔNG hỏi cờ `billing.flexV1Enabled`
// (T8: cờ tắt giữa chừng, khoản đã quẹt vẫn phải xử lý được). KHÔNG đẻ quyền mới. Không viết điều kiện quyền/so cơ sở tại chỗ
// (no-inline-authz): cổng là `congSaiMa` — wrapper MỘT cấp cùng tệp, có `checkPermission` trực tiếp (luật lint
// `authz/require-can-in-write-action` nhận ra), cùng khuôn `congXemPhieuPos` của `_actions.ts`.
//
// ⚠️ KHÔNG viết phép ghi tiền ở đây — tiền chỉ ở `lib/payments/pos/sai-ma-ghi.ts` qua `xuLyKetQuaPos` (lưới `[HN3-W1]`).
// ⚠️ File "use server" chỉ export async function.
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { passesScope, scopedDb } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { guiSaiMa } from "@/lib/payments/pos/sai-ma-ghi";
import { QUYEN_THU_THE_POS, quyenTaiCoSoCuaDon } from "@/lib/payments/pos/quyen-co-so";
import { timUngVienSaiMa, type KetQuaTimSaiMa } from "@/lib/payments/pos/sai-ma-doc";
import { guiSaiMaSchema, timSaiMaSchema } from "@/lib/validators/phieu-pos";

/**
 * Cổng chung của hai action: quyền `payments:pos-check` + đơn trong phạm vi. Câu chữ KHÔNG phân biệt "không có đơn" với "không
 * thuộc cơ sở bạn".
 */
async function congSaiMa(orderId: string) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Chưa đăng nhập" };
  if (!(await checkPermission("payments:pos-check"))) {
    return { ok: false as const, error: "Không có quyền" };
  }
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const order = await sdb.order.findUnique({
    where: { id: orderId },
    select: { id: true, centerId: true, orgUnitId: true },
  });
  // Người đa vai (sale@CS1 + kế toán@CS2): xem lib/payments/pos/quyen-co-so.ts (chỉ v2).
  if (!order || !passesScope("Order", order, actor) || !quyenTaiCoSoCuaDon(actor, QUYEN_THU_THE_POS, order.centerId)) {
    return { ok: false as const, error: "Không tìm thấy đơn hàng" };
  }
  const { actorId, actorName } = getAuditActor(session);
  return { ok: true as const, order, sdb, actor: { id: actorId ?? "", name: actorName } };
}

/** Bước "tìm": danh sách ứng viên + xem trước bậc xử lý. Chỉ đọc. */
export async function timUngVienSaiMaAction(input: unknown): Promise<KetQuaTimSaiMa> {
  const parsed = timSaiMaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const cong = await congSaiMa(parsed.data.orderId);
  if (!cong.ok) return { ok: false, error: cong.error };

  // Cổng IDOR: phiếu POS phải thuộc CHÍNH đơn đã qua cổng phạm vi (`timUngVienSaiMa` lọc `paymentBill: { orderId }` qua `scopedDb`).
  return timUngVienSaiMa({
    sdb: cong.sdb,
    orderId: cong.order.id,
    intentId: parsed.data.intentId,
    now: new Date(),
  });
}

export type KetQuaGuiSaiMaAction =
  | { ok: true; kieu: "TU_GHI_NHAN" | "CHO_KE_TOAN"; trangThai: string; thongDiep: string }
  | { ok: false; error: string };

/**
 * Bước "gửi": sale chọn đúng MỘT giao dịch. Chỉ nhận ID giao dịch — mã đúng, số tiền, cơ sở đều do lib đọc dưới khoá; không có
 * trường nào để client nhét "mã xác nhận".
 */
export async function guiSaiMaAction(input: unknown): Promise<KetQuaGuiSaiMaAction> {
  const parsed = guiSaiMaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const cong = await congSaiMa(parsed.data.orderId);
  if (!cong.ok) return { ok: false, error: cong.error };

  const kq = await guiSaiMa({
    orderId: cong.order.id,
    intentId: parsed.data.intentId,
    bankTransactionId: parsed.data.bankTransactionId,
    actor: cong.actor,
    now: new Date(),
  });
  // Làm mới TRƯỚC khi xét `ok` (như `duyetSaiMaAction`): `guiSaiMa` có thể trả `ok: false` SAU khi đã giữ giao dịch (pha tiền ném — phiếu đã
  // CAN_XU_LY, yêu cầu DANG_GHI); bộ nhớ đệm của trang đơn mà còn cũ thì hộp phiếu vẫn mời quẹt lại [HN3-RV-07].
  revalidatePath(`/orders/${cong.order.id}`);
  if (!kq.ok) return { ok: false, error: kq.error };
  return { ok: true, kieu: kq.kieu, trangThai: kq.trangThai, thongDiep: kq.thongDiep };
}
