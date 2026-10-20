// lib/hoa-hong/_handlers/doi-nguon-sau-thu.ts — consumer của DomainEvent `nguon.da-doi-sau-thanh-toan` (PR2 phát; engine PR5b nghe).
//
// Đổi nguồn lead SAU khi đã có khoản thu ⇒ LẬP ĐỀ XUẤT điều chỉnh chờ duyệt cho các ô bị ảnh hưởng (`apDungDoiNguonSauThu`) — KHÔNG ghi sổ (hướng B+C, 16/10/2026): tiền chỉ đổi
// sau khi người duyệt (một hoặc hai cấp) duyệt. Đổi nguồn không ảnh hưởng tiền ⇒ chỉ ghi một AuditLog tóm tắt. Engine TẮT hoặc CHƯA có mốc cutover ⇒ không có
// sổ nào để sửa ⇒ bỏ qua (không ném: ném làm dispatcher retry vô ích tới FAILED). Việc rơi mất đó được vá bằng script backfill từ AuditLog
// (`scripts/hoa-hong/doi-nguon-sau-thu-backfill.ts`) và bằng lượt quét/đối soát (đổi `LeadAttribution.updatedAt` ⇒ Q4 ⇒ INPUT_DRIFT cho người duyệt).
//
// Đồng hồ: handler là BIÊN chạy thật nên đọc `new Date()` MỘT lần ở đây rồi truyền xuống (luật 19) — hàm tính không tự đọc.
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";

import { dungBoiCanhQuet } from "../boi-canh";
import { apDungDoiNguonSauThu } from "../doi-nguon-sau-thu";

export async function onNguonDaDoiSauThanhToan(event: DomainEventLite): Promise<void> {
  const leadId = typeof event.payload.leadId === "string" ? event.payload.leadId : "";
  if (!leadId) return;
  const ngu = await dungBoiCanhQuet(db, new Date());
  if (ngu.loai === "TAT") return;
  const actorId = typeof event.payload.actorId === "string" ? event.payload.actorId : "";
  // Không biết ai đổi nguồn ⇒ không có "người đề xuất" để tách nhiệm: dừng (ném ⇒ dispatcher retry rồi FAILED để người vận hành thấy), KHÔNG đoán một người.
  if (!actorId) throw new Error(`Sự kiện ${event.id} thiếu actorId — không lập được đề xuất đổi nguồn (không có người đề xuất để tách nhiệm).`);
  const kq = await apDungDoiNguonSauThu(db, ngu.bc, { leadId, refEventId: event.id, requestedById: actorId });
  // Audit TÓM TẮT cho mọi lượt, kể cả khi không có đề xuất nào (đổi nguồn không ảnh hưởng tiền) — để "đã xử lý, không đổi đồng nào" đọc lại được.
  await writeAudit({
    actor: { id: actorId, name: "Người đổi nguồn" },
    module: "hoa-hong",
    entityType: "Lead",
    entityId: leadId,
    action: "DOI_NGUON_SAU_THU_XU_LY",
    newValues: { soKhoan: kq.soKhoan, ketQua: kq.theoKetQua, deXuat: kq.deXuat, khongAnhHuongTien: kq.deXuat.length === 0 },
    reason: kq.deXuat.length > 0 ? "đổi nguồn sau thanh toán — đã lập đề xuất điều chỉnh chờ duyệt" : "đổi nguồn sau thanh toán — không có chênh lệch do nguồn, sổ không đổi",
  });
}

export function registerNguonDoiSauThuHandlers(): void {
  on("nguon.da-doi-sau-thanh-toan", onNguonDaDoiSauThanhToan);
}
