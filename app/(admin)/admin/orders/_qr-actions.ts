"use server";

// _qr-actions.ts — bridge server actions cho UI "Xuất QR theo từng đợt".
//
// File RIÊNG, không đụng orders/_actions.ts (agent khác giữ). Logic thật nằm ở
// ./_qr-core.ts — ở đây CHỈ có: auth() → checkPermission("orders:manage") →
// resolveActor() → gọi core. Core nhận `actor` tường minh nên KHÔNG được export từ
// file "use server" này (mọi export của "use server" là HTTP endpoint; client forge
// actor = leo quyền). Cách ly cơ sở do scopedDb trong core lo (phiếu cơ sở khác →
// "không tìm thấy", không lộ là nó tồn tại).
//
// ⚠️ 20/08 — GÁC THỨ HAI: `orders:view-pii`. Nội dung CK in trên QR nay chứa SĐT phụ
// huynh, nên phát QR = phát SĐT. Cờ `canViewPii` truyền xuống core PHẢI tính TẠI ĐÂY
// bằng `checkPermission` (dữ liệu server), TUYỆT ĐỐI không nhận từ đối số của action —
// mọi tham số của "use server" đều là input client, client tự khai `canViewPii: true`
// là xong chuyện.

import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { getAuditActor } from "@/lib/audit/log";
import {
  issueQrForRequestCore,
  regenerateQrCore,
  type QrIssueResult,
  type QrPiiOption,
} from "./_qr-core";

async function withGate(
  run: (
    actor: Awaited<ReturnType<typeof resolveActor>>,
    auditActor: { id: string | null; name: string },
    opts: QrPiiOption,
  ) => Promise<QrIssueResult>,
): Promise<QrIssueResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  // ⚠️ `payments:record`, KHÔNG phải `orders:manage` [02/10/2026]. Cách ly cơ sở vẫn do
  // `scopedDb` trong core lo, nên đổi cổng này KHÔNG mở rò giữa các cơ sở.
  //
  // ── VÌ SAO ĐỔI: SALE CHƯA BAO GIỜ XUẤT ĐƯỢC QR ──────────────────────────────────────
  // Đo 02/10 trên `prisma/seed-roles.ts`:
  //     CENTER_SALES_CSM   → payments:record · orders:view · orders:create · orders:view-pii
  //     CENTER_ACCOUNTANT  → payments:record
  //     (cả hai KHÔNG có `orders:manage`; chỉ HO_ACCOUNTANT + CENTER_MANAGER có)
  // ⇒ cổng cũ từ chối đúng hai vai đứng trước mặt khách. Chủ dự án báo 02/10 bằng hai đơn
  // thật trên test (`ORD-261002-000001` đã duyệt, `ORD-261002-000002` không cần duyệt):
  // cả hai không có nút QR nào.
  //
  // Mâu thuẫn thẳng với luật đã ghi trong CLAUDE.md — *"đơn đang chờ duyệt thì sale KHÔNG
  // xuất được QR cho khách"* — câu đó chỉ có nghĩa nếu lúc KHÔNG chờ duyệt thì sale CÓ.
  //
  // Và đường QR đời MỚI (phiếu gộp) đã chọn đúng quyền này từ 24/09: `taoPhieuGopAction`
  // đi qua `congDuongB(orderId, "payments:record")`, có lưới `[QTD-W1]` ghim. Đường cũ
  // đơn giản là không được sửa theo. Lỗi có từ `d5294f837` (03/08/2026).
  //
  // KHÔNG ai mất quyền: HO_ACCOUNTANT và CENTER_MANAGER đều có `payments:record` GLOBAL.
  // Thêm vào: CENTER_SALES_CSM và CENTER_ACCOUNTANT — đúng hai vai đứng quầy thu tiền.
  if (!(await checkPermission("payments:record"))) {
    return { ok: false, error: "Không có quyền xuất QR thanh toán" };
  }
  const actor = await resolveActor(session.user.id);
  const { actorId, actorName } = getAuditActor(session);
  // `orders:view-pii` cũng GLOBAL trong seed-roles → hỏi không kèm target, ĐÚNG bằng
  // cách trang chi tiết đơn ([id]/page.tsx) hỏi. Hai bên phải dùng cùng một đường
  // (`checkPermission`) thì mới chắc ra cùng một câu trả lời.
  const canViewPii = await checkPermission("orders:view-pii");
  return run(actor, { id: actorId, name: actorName }, { canViewPii });
}

/** Xuất QR cho 1 phiếu thu. Còn QR ACTIVE chưa hết hạn → trả lại chính phiên đó. */
export async function issueQrForRequest(input: {
  paymentRequestId: string;
}): Promise<QrIssueResult> {
  return withGate((actor, auditActor, opts) =>
    issueQrForRequestCore(actor, auditActor, { paymentRequestId: input.paymentRequestId }, opts),
  );
}

/**
 * Tạo lại QR: hết hạn mọi phiên cũ, mở phiên mới TRÊN CÙNG phiếu thu.
 * `matchKey` của phiếu KHÔNG đổi → tiền của QR cũ vẫn rơi đúng đợt.
 */
export async function regenerateQr(input: {
  paymentRequestId: string;
}): Promise<QrIssueResult> {
  return withGate((actor, auditActor, opts) =>
    regenerateQrCore(actor, auditActor, { paymentRequestId: input.paymentRequestId }, opts),
  );
}
