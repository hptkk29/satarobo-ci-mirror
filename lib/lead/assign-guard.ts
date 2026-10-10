// lib/lead/assign-guard.ts — Đợt G (23/08/2026): ai được nhận một lead khi GÁN TAY.
//
// Vì sao tách ra hàm thuần thay vì viết `if` trong action: điều kiện này phải
// giống nhau ở mọi cửa (gán tay từ trang chi tiết, gán từ bảng kanban, và bất kỳ
// cửa nào thêm sau). Lần trước nó chỉ nằm ở một chỗ và chỗ đó thiếu hai vế —
// hậu quả là sự cố 21/08 phải gỡ tay.
//
// KHÔNG kiểm quyền ở đây. Quyền là câu hỏi "người bấm có được gán không"
// (`leads:assign`, do action gác). File này trả lời câu khác: "người NHẬN có
// nhận nổi lead này không". Trộn hai câu vào một chỗ là cách chắc chắn để sau
// này ai đó sửa một câu và vô tình đổi câu kia.

export type ManualAssignSale = {
  id: string;
  isActive: boolean;
  deletedAt: Date | null;
  /** Cơ sở của người nhận. `null` = dữ liệu hỏng, xem ghi chú dưới. */
  centerId: string | null;
};

export type ManualAssignInput = {
  sale: ManualAssignSale;
  /** Cơ sở của lead. `null` = lead chưa gắn cơ sở. */
  leadCenterId: string | null;
  /**
   * Người GÁN đứng ở cấp Hội sở (hoặc SUPER_ADMIN) — tức nhìn thấy mọi cơ sở.
   * Họ được gán xuyên cơ sở vì điều phối liên cơ sở là nghiệp vụ có thật.
   */
  actorIsHoLevel: boolean;
};

export type ManualAssignResult = { ok: true } | { ok: false; error: string };

/**
 * Người này có nhận được lead này không. THUẦN.
 *
 * Ba vế, theo thứ tự "sai rõ ràng nhất trước" để thông báo trả về nói đúng cái sai:
 *
 *  1. Còn làm việc không. Gán cho tài khoản đã nghỉ / đã xoá mềm là chôn lead:
 *     họ không đăng nhập nữa, và mọi vòng chia tự động cũng đã loại họ rồi.
 *  2. Người nhận có cơ sở không. Sale thiếu `centerId` vốn đã rơi khỏi mọi vòng
 *     chia (bộ lọc ứng viên lọc theo cột đó). Gán tay cho họ là dựng lại đúng
 *     cái lead-chết bằng tay, chỉ chậm hơn.
 *  3. Cùng cơ sở với lead không — TRỪ khi người gán ở cấp Hội sở.
 *     Đây là vế đã thiếu và đã gây sự cố: `scopedDb` cách ly theo cơ sở, nên
 *     sale CS2 nhận lead CS1 sẽ **không mở nổi** nó. Không có màn nào báo lỗi;
 *     lead chỉ đơn giản biến mất khỏi tầm nhìn của cả hai bên.
 *
 * Lead CHƯA có cơ sở thì KHÔNG chặn: cơ sở của lead sẽ theo người nhận, và đây
 * là đường hợp lệ để một lead vô chủ về đúng người.
 */
export function canManualAssign(input: ManualAssignInput): ManualAssignResult {
  const { sale, leadCenterId, actorIsHoLevel } = input;

  if (!sale.isActive || sale.deletedAt !== null) {
    return { ok: false, error: "Tư vấn viên này không còn làm việc — chọn người khác." };
  }

  if (!sale.centerId) {
    return {
      ok: false,
      error:
        "Tư vấn viên này chưa được gắn cơ sở nào, giao lead sẽ không ai xử lý được. Cập nhật cơ sở cho họ trước.",
    };
  }

  if (leadCenterId && !actorIsHoLevel && sale.centerId !== leadCenterId) {
    return {
      ok: false,
      error:
        "Tư vấn viên này thuộc cơ sở khác — nhận xong họ sẽ không mở được lead. Dùng “Chuyển lead” nếu muốn đổi cơ sở.",
    };
  }

  return { ok: true };
}
