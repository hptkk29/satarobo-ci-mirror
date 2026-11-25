// lib/lead/close-mark.ts — G-06 · MỐC CHỐT: thời điểm một đứa trẻ thành học viên.
//
// VÌ SAO CÓ FILE NÀY: C-03 ("Lead đã chuyển đổi") có cột **thời gian chốt** = chốt −
// vào hệ thống, và đơn vị đếm là HỌC SINH chứ không phải phụ huynh (G-07). `Lead
// .convertedAt` là mốc của cả phiếu — một phiếu hai con có thể chốt hai thời điểm
// khác nhau, nên nó không thay được mốc của từng đứa.
//
// ⚠️ ĐỪNG NHẦM VỚI LUẬT CỦA ĐƠN HÀNG. Đợt 3 chốt "một đơn – một con" (quyết định B4)
// nên `inferLeadChildIdForConvert` (lib/orders/lead-child-link.ts) trả `null` khi lượt
// chốt có 2 con: khoản tiền của MỘT đơn chung thật sự thuộc về cả hai, không có cách
// chia nào đúng. Ở đây thì ngược lại — sự kiện "đứa này đã thành học viên" KHÔNG mập
// mờ chút nào: chốt hai con là hai đứa cùng vào học, cả hai đều có mốc chốt thật.
//
// Bê nguyên luật của đơn hàng sang đây là im lặng bỏ mốc chốt của CẢ HAI đứa mỗi khi
// một phụ huynh cho hai con vào học cùng lúc, và C-03 sẽ thiếu người trong khi tổng
// doanh thu vẫn khớp — loại sai không ai truy ra được.

/**
 * Trạng thái "đã chốt" của một đứa con, theo quyết định B2 (24/08/2026): *đã đến bước
 * đăng ký thành công và trở thành học viên của trung tâm*. KHÔNG tính "đã trả tiền
 * nhưng chưa ghi danh".
 *
 * Hằng này là định nghĩa mà C-02 (tỷ lệ thành công) và C-03 đếm theo — đổi nó là đổi
 * ý nghĩa của hai con số đó, không phải đổi một chuỗi.
 */
export const CLOSED_CHILD_STATUS = "ENROLLED" as const;

/** Học viên trong một lượt chốt ghi danh — chỉ cần phần "quy về con nào". */
export type ClosingStudentRef = { leadChildId?: string | null };

/**
 * Danh sách con được đóng mốc chốt trong một lượt `convertLeadV2`.
 *
 * Luật: mỗi học viên có gắn `leadChildId` ⇒ con đó đã chốt. Học viên không gắn con
 * (nhập thẳng, không đi từ phiếu) thì **không đoán** — không có mốc nào để ghi.
 *
 * Trả về danh sách đã CẮT khoảng trắng và BỎ TRÙNG, giữ nguyên thứ tự xuất hiện: chỗ
 * gọi dùng nó cho một `updateMany(where: { id: { in } })` duy nhất.
 */
export function resolveClosedLeadChildIds(students: readonly ClosingStudentRef[]): string[] {
  const ra: string[] = [];
  const daCo = new Set<string>();
  for (const s of students) {
    const id = s.leadChildId?.trim();
    if (!id || daCo.has(id)) continue;
    daCo.add(id);
    ra.push(id);
  }
  return ra;
}
