// lib/hoa-hong/_handlers/doi-nguon-sau-thu.ts — consumer của DomainEvent `nguon.da-doi-sau-thanh-toan` (PR2 phát; engine PR5b nghe).
//
// Đổi nguồn lead SAU khi đã có khoản thu ⇒ ghi `SOURCE_CORRECTION` cho mọi ô của lead (`apDungDoiNguonSauThu`). Engine TẮT hoặc CHƯA có mốc cutover ⇒ không có
// sổ nào để sửa ⇒ bỏ qua (không ném: ném làm dispatcher retry vô ích tới FAILED). Việc rơi mất đó được vá bằng script backfill từ AuditLog
// (`scripts/hoa-hong/doi-nguon-sau-thu-backfill.ts`) và bằng lượt quét/đối soát (đổi `LeadAttribution.updatedAt` ⇒ Q4 ⇒ INPUT_DRIFT cho người duyệt).
//
// Đồng hồ: handler là BIÊN chạy thật nên đọc `new Date()` MỘT lần ở đây rồi truyền xuống (luật 19) — hàm tính không tự đọc.
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";

import { dungBoiCanhQuet } from "../boi-canh";
import { apDungDoiNguonSauThu } from "../doi-nguon-sau-thu";

export async function onNguonDaDoiSauThanhToan(event: DomainEventLite): Promise<void> {
  const leadId = typeof event.payload.leadId === "string" ? event.payload.leadId : "";
  if (!leadId) return;
  const ngu = await dungBoiCanhQuet(db, new Date());
  if (ngu.loai === "TAT") return;
  await apDungDoiNguonSauThu(db, ngu.bc, { leadId, refEventId: event.id });
}

export function registerNguonDoiSauThuHandlers(): void {
  on("nguon.da-doi-sau-thanh-toan", onNguonDaDoiSauThanhToan);
}
