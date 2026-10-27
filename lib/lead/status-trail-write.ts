// lib/lead/status-trail-write.ts — C-07: ĐƯỜNG GHI DUY NHẤT của vết đổi trạng thái.
//
// Trước ticket này có 8 chỗ đổi `Lead.status` / `LeadChild.status` và mỗi chỗ tự
// ghi một kiểu (xem đầu `status-trail.ts`). Hệ quả không nằm ở "code xấu" mà ở
// dữ liệu: mục "Lịch sử thay đổi" của trang chi tiết lead — thứ QLCS được xem —
// mất mốc của ghi nhận tiền, của điểm danh học thử, và của TOÀN BỘ đường tự chia
// khách (`MỚI → ĐÃ PHÂN CÔNG`). Dựng thêm màn hình không cứu được: mốc chưa bao
// giờ được ghi.
//
// Hàm này ghi ĐỦ hai dòng, trong CÙNG transaction mà chỗ gọi đang mở:
//   1. `AuditLog` (qua `logLeadAudit`, action STATUS_CHANGE) — nguồn của mục
//      "Lịch sử thay đổi" + "Mốc trạng thái".
//   2. `LeadActivity` type STATUS_CHANGE — dòng thời gian Sale đang nhìn.
//
// ⚠️ KHÔNG `.catch()` nuốt lỗi ở đây và cũng đừng thêm ở chỗ gọi: ghi vết hỏng
// mà lượt đổi vẫn lưu thì đúng bằng không có vết, và không ai biết là đã mất.
// Lỗi đó đã phải vá một lần ở `updateLeadFields` (V-6 · G-02).
import type { Prisma } from "@prisma/client";
import { logLeadAudit } from "@/lib/audit/log";
import { recordLeadActivity } from "./activity-write";
import {
  leadStatusTrailAudit,
  leadStatusTrailContent,
  leadStatusTrailMetadata,
  type LeadStatusChange,
} from "./status-trail";

export type RecordLeadStatusChangeInput = LeadStatusChange & {
  /** Transaction của chính lượt đổi — bắt buộc, vết phải cùng số phận với lượt ghi. */
  tx: Prisma.TransactionClient;
  leadId: string;
  actorId: string | null;
  actorName: string;
  /**
   * Chỗ gọi ĐÃ tự ghi dòng `AuditLog` cho đúng lượt này (chỉ `convert-lead*.ts`:
   * dòng của nó thuộc module `enrollment`, mang thêm mã đơn/mã học viên và đang
   * bị e2e `tests/e2e/r2/convert-lead.spec.ts` ghim). Bật cờ để bù DÒNG TIMELINE
   * còn thiếu mà không đẻ dòng nhật ký thứ hai cho cùng một sự việc.
   */
  auditAlreadyWritten?: boolean;
};

export async function recordLeadStatusChange(input: RecordLeadStatusChangeInput): Promise<void> {
  // Không đổi thì không có mốc — các đường tự động chạy lại (idempotent) sẽ đổ
  // đầy nhật ký bằng dòng "A → A" nếu ghi vô điều kiện.
  //
  // ⚠️ TRỪ khi lượt đó còn mang ô phụ đổi theo: đánh dấu RỚT lại cho đứa con đã
  // rớt với LÝ DO KHÁC là ca thật (C-06 ghi lý do ở cấp phụ huynh và ĐÈ lên lý
  // do cũ) — bỏ qua ở đây là lý do mới bị đè mà không còn vết nào truy ra.
  const coODoiKem = (input.extraChangedFields?.length ?? 0) > 0;
  if (input.from === input.to && !coODoiKem) return;

  const change: LeadStatusChange = {
    from: input.from,
    to: input.to,
    source: input.source,
    child: input.child ?? null,
    reason: input.reason ?? null,
    extra: input.extra ?? null,
    extraChangedFields: input.extraChangedFields,
  };

  if (!input.auditAlreadyWritten) {
    const { oldValues, newValues, changedFields } = leadStatusTrailAudit(change);
    await logLeadAudit({
      leadId: input.leadId,
      action: "STATUS_CHANGE",
      actorId: input.actorId,
      actorName: input.actorName,
      oldValues,
      newValues,
      changedFields,
      reason: input.reason?.trim() || undefined,
      tx: input.tx,
    });
  }

  // N-4 — qua đường ghi chung để lượt đổi trạng thái cũng bump
  // `Lead.lastActivityAt`. ⚠️ Bump KHÔNG có nghĩa "đã tiếp cận khách": máy đẩy
  // trạng thái (ghi nhận tiền, điểm danh học thử, tự chia) vẫn là dòng máy —
  // `STATUS_CHANGE` cố ý nằm ngoài `LEAD_OUTREACH_TYPES` (`activity-clock.ts`).
  await recordLeadActivity({
    tx: input.tx,
    leadId: input.leadId,
    actorId: input.actorId,
    actorName: input.actorName,
    type: "STATUS_CHANGE",
    content: leadStatusTrailContent(change),
    metadata: leadStatusTrailMetadata(change) as Prisma.InputJsonValue,
  });
}
