import "server-only";
import type { Prisma } from "@prisma/client";

// ⚠️ HAI SỔ, hai tệp, KHÔNG phải trùng lặp — xem khối chú thích đầu `lib/leads/set-status.ts`:
//  · `recordLeadStatusLedger` (bí danh của `recordLeadStatusChange` trong `lib/leads/set-status`)
//    — sổ ĐẾM phễu, thứ báo cáo chuyển đổi đọc;
//  · `recordLeadStatusChange` (`@/lib/lead/status-trail-write`) — vết NGƯỜI ĐỌC, thứ hiện ở
//    mục "Lịch sử thay đổi" của trang chi tiết lead.
import { recordLeadStatusChange as recordLeadStatusLedger } from "@/lib/leads/set-status";
import { recordLeadStatusChange } from "@/lib/lead/status-trail-write";

type Tx = Prisma.TransactionClient;

/** Ai gây ra lượt đổi bậc. `id: null` = hệ thống (tiền tự về, không ai bấm). */
export type ActorDayPheu = { id: string | null; name?: string | null; centerId?: string | null };

/**
 * TIỀN VÀO ⇒ lead CHỜ QUYẾT ĐỊNH lên ĐÃ ĐĂNG KÝ. Một chỗ DUY NHẤT cho mọi đường tiền.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * VÌ SAO NÓ Ở ĐÂY CHỨ KHÔNG Ở `lib/finance/payment.ts` [tách ra I-1 · 22/09/2026]
 *
 * Hàm này sống trong `payment.ts` từ S3, cạnh `ensureOrderPaymentRecorded`. Khi đường tiền
 * TỰ ĐỘNG (`lib/payments/payos-ingest.ts`) cần gọi nó, lưới **`[GGW-04]`** đỏ ngay:
 *
 *     expect(src, "không được import sổ marker của đường xác nhận đơn")
 *       .not.toMatch(/from "@\/lib\/finance\/payment"/)
 *
 * Lưới ấy **đúng và phải giữ nguyên**. Nó canh một bug tiền thật: đường webhook mà dùng
 * marker của `ensureOrderPaymentRecorded` thì `lib/orders/installments.ts` sẽ XOÁ MỀM tiền
 * ngân hàng ở lần ai đó bấm "Lưu kế hoạch" kế tiếp. Cấm cả module là belt-and-braces có chủ
 * đích — nới nó ra để lọt một import "vô hại" là gỡ đúng cái chốt đang giữ.
 *
 * Nên lời giải là **đừng với tay vào module ấy**: cổng phễu không phải chuyện của sổ marker
 * tiền, nó là chuyện của lead. Tách ra đây thì cả ba đường tiền cùng gọi một hàm, và lưới
 * `[GGW-04]` giữ nguyên răng.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * BA ĐƯỜNG GỌI, và vì sao phải đủ cả ba
 *
 *  1. `ensureOrderPaymentRecorded` — xác nhận đơn / đóng theo đợt (`lib/finance/payment.ts`);
 *  2. `recordPayment`              — kế toán ghi TAY (cùng tệp);
 *  3. `allocateToOrder`            — **tiền TỰ VỀ qua ngân hàng** + đối soát tay ở
 *                                    `/admin/bien-dong-so-du` (`lib/payments/payos-ingest.ts`).
 *
 * Đường (3) thiếu cổng này cho tới 22/09/2026, và nó là đường mà **mọi giao dịch thật đi
 * qua** kể từ 20/08 — ngày nội dung CK bỏ mã đơn, khiến webhook SePay không còn tra ra đơn
 * theo mã và nhánh có (1) không bao giờ chạy. Đo ở
 * `docs/thanh-toan-linh-hoat/i-ai-doc-so-nao.md`.
 *
 * ⚠️ **KHÔNG chặn việc chốt lead, đừng mô tả nó như vậy.** Cả `convertLead` lẫn
 * `convertLeadV2` khoá theo `convertedAt IS NULL`, **không** theo trạng thái. Thứ hỏng khi
 * thiếu cổng này là **sổ đếm phễu** (gia đình đã trả tiền mà lead vẫn ở "Chờ quyết định") và
 * **vết trong nhật ký**. Chú thích cũ "mở khoá convert" ở `payment.ts` đã lỗi thời từ GĐ5.
 *
 * IDEMPOTENT: `updateMany` có guard `status = CHO_QUYET_DINH` nên gọi lại không lùi bậc,
 * không đụng lead ở bậc khác, và không ghi dòng nhật ký thứ hai. Trả `true` nếu VỪA nâng bậc.
 * Chạy TRONG tx do chỗ gọi cấp — bậc phễu và số tiền phải cùng sống hoặc cùng chết.
 */
export async function maybeAdvanceLeadToRegistered(
  tx: Tx,
  params: { leadId: string; actor: ActorDayPheu },
): Promise<boolean> {
  const upd = await tx.lead.updateMany({
    where: { id: params.leadId, status: "CHO_QUYET_DINH", deletedAt: null },
    data: { status: "DA_DANG_KY" },
  });
  if (upd.count === 0) return false;
  // Giá trị trạng thái là bộ 10 của GĐ5, KHÔNG phải AWAITING_DECISION/REGISTERED cũ.
  await recordLeadStatusLedger({
    tx,
    leadId: params.leadId,
    from: "CHO_QUYET_DINH",
    to: "DA_DANG_KY",
    source: "payment",
    actorId: params.actor.id,
    actorName: params.actor.name ?? null,
  });
  // C-07: trước đây chỗ này CHỈ tạo `LeadActivity`, không có dòng `AuditLog` nào ⇒ mốc
  // "tiền vào → Đã đăng ký" biến mất khỏi mục "Lịch sử thay đổi" của trang chi tiết lead
  // (thứ QLCS xem), trong khi đường đổi tay thì có.
  await recordLeadStatusChange({
    tx,
    leadId: params.leadId,
    actorId: params.actor.id,
    actorName: params.actor.name ?? "Hệ thống",
    from: "CHO_QUYET_DINH",
    to: "DA_DANG_KY",
    source: "PAYMENT",
  });
  return true;
}
