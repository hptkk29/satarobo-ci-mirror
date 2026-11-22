// lib/lead/assignment.ts — Đợt A (kế hoạch Site Sale, 21/08/2026).
//
// Một chỗ duy nhất dựng khối `data` khi đổi chủ lead, để không ai quên `assignedAt`.
//
// VÌ SAO CẦN: đo trên prod 21/08 — trong 33 lead có vết chia, **chỉ 1** có
// `Lead.assignedAt`. Bốn đường đổi chủ (`autoAssignNewLead`, `manualAssignLead`,
// `transferLead`, `bulkReassignLeads`) đều ghi `assignedToId` mà bỏ mốc.
// `lib/crm/sla.ts` đọc mốc đó để tính:
//   • SLA-2 — đã bàn giao mà **chưa phân công** (điều kiện: `assignedAt` rỗng)
//   • SLA-3 — đã phân công mà **chưa liên hệ** (đếm từ `assignedAt`)
// Không có mốc ⇒ hai cảnh báo đó không bao giờ kêu, và mọi cơ chế thu hồi lead
// sau này đứng trên một đồng hồ chết.

export type AssignmentWrite = {
  assignedToId: string | null;
  assignedAt: Date | null;
};

/**
 * Khối `data` chuẩn cho mọi lần đổi chủ lead.
 *
 * @param userId người nhận; `null`/rỗng = trả lead về vô chủ
 * @param now    thời điểm phân công (mặc định: bây giờ) — truyền vào để test được
 *
 * Mốc được làm MỚI ở mỗi lần đổi chủ: người nhận mới phải có cửa sổ SLA riêng,
 * không thừa hưởng đồng hồ đã chạy của người trước.
 *
 * Trả lead về vô chủ thì **xoá luôn mốc** — giữ mốc cũ là nói dối đồng hồ, vì
 * SLA-2 nhận biết "chưa phân công" bằng chính việc mốc rỗng.
 */
export function assignmentWrite(
  userId: string | null | undefined,
  now: Date = new Date(),
): AssignmentWrite {
  const id = userId?.trim() || null;
  return id
    ? { assignedToId: id, assignedAt: now }
    : { assignedToId: null, assignedAt: null };
}
