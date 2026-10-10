// lib/hr/nghi-viec.ts — nghỉ việc thì TÀI KHOẢN phải chết theo. THUẦN, test không cần DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao có file này (08/09/2026)
//
// `updateEmployeeAction` nhận `status` (RESIGNED / TERMINATED) và chỉ ghi vào
// `Employee`. Nó KHÔNG đụng `User.isActive`, KHÔNG bump `User.tokenVersion`.
//
// Repo VỐN có đủ cơ chế cắt phiên và dùng đúng ở hai chỗ khác:
//   · đổi vai   → `nhan-su/actions.ts` bump `tokenVersion`;
//   · cấp quyền → `users/[id]/permissions/_actions.ts` bump `tokenVersion`.
// Chỉ nghỉ việc là quên. `checkSessionLiveness` (lib/auth/live-session.ts) đối chiếu
// `isActive` / `deletedAt` / `tokenVersion` với DB nên bump là cắt phiên NGAY request kế.
//
// ⚠️ Đo prod 08/09: **0 Employee mang RESIGNED/TERMINATED** — tức chưa ai từng ghi nhận
// nghỉ việc trong hệ thống. Theo luật 1 (docs/luat-doc-so-va-ket-luan.md): đường ghi
// SỐNG + 0 dòng = **bom hẹn giờ**, không phải "chưa cần lo". Nó nổ ở lần đầu tiên có
// người bấm đổi trạng thái sang đã-nghỉ.
//
// ⚠️ CỐ Ý MỘT CHIỀU. Chuyển NGƯỢC lại (đã nghỉ → đang làm) KHÔNG tự bật lại tài khoản:
// mở lại quyền truy cập là một quyết định riêng, phải có người bấm ở màn tài khoản. Tự
// động bật lại là biến một lần sửa nhầm trạng thái thành một lần cấp quyền.

/** Trạng thái nhân sự coi là ĐÃ NGHỈ — tài khoản không được sống tiếp. */
export const TRANG_THAI_DA_NGHI: readonly string[] = ["RESIGNED", "TERMINATED"];

export function laDaNghi(status: string | null | undefined): boolean {
  return status != null && TRANG_THAI_DA_NGHI.includes(status);
}

/**
 * Lượt sửa này có phải là NGHỈ VIỆC không — tức có phải vô hiệu hoá tài khoản không.
 *
 * Chỉ đúng khi CHUYỂN VÀO nhóm đã-nghỉ. Sửa một hồ sơ vốn đã nghỉ (đổi tên, đổi ngày
 * kết thúc) KHÔNG phải sự kiện nghỉ việc, và bump `tokenVersion` lần nữa ở đó là vô
 * nghĩa — tài khoản đã chết từ lần trước.
 */
export function canVoHieuTaiKhoan(
  truoc: string | null | undefined,
  sau: string | null | undefined,
): boolean {
  return laDaNghi(sau) && !laDaNghi(truoc);
}
