// lib/finance/tu-xac-nhan.ts — "người này có là NGƯỜI GHI khoản này không" (AC5, tách nhiệm vụ). THUẦN.
//
// Luật AC5: người ghi nhận một khoản thu KHÔNG được tự xác nhận khoản của mình — phải là một người khác.
//
// ── VÌ SAO LÀ MỘT HÀM RIÊNG [sự cố F1] ────────────────────────────────────────────────────────────
// Phép so `recordedById === <người>` từng được CHÉP TAY ở năm chỗ (lõi xác nhận, action ở màn Thanh toán,
// xác nhận hàng loạt nhập liệu, bước chốt hoá đơn, hàng chờ hoá đơn) — còn NÚT ✓ ở màn Thanh toán thì
// KHÔNG hỏi phép so nào cả. Hệ quả đo trên môi trường test: tài khoản Quản trị ghi một khoản tiền mặt,
// rồi bấm ✓ trên chính dòng đó → toast "Người ghi nhận không được tự xác nhận khoản của mình". Nút vẫn
// được VẼ, máy chủ vẫn từ chối: lời hứa suông (luật 12).
//
// Nay MỘT hàm trả lời câu hỏi, và cả cổng máy chủ lẫn mọi nơi quyết có vẽ nút xác nhận hay không cùng
// gọi nó. Hai tham số BẮT BUỘC, không mặc định (luật 7): quên truyền người xem là lỗi biên dịch, không
// phải một cờ lặng lẽ rơi về `false` — mà `false` ở đây nghĩa là "cho vẽ nút".

/** Câu từ chối — một nguồn cho lõi xác nhận (`TU_XAC_NHAN`) lẫn tầng action. */
export const CAU_TU_XAC_NHAN = "Người ghi nhận không được tự xác nhận khoản của mình";

/**
 * `nguoiXemId` có phải chính người đã GHI khoản này không (⇒ không được tự xác nhận).
 *
 * `recordedById` rỗng / `null` (dữ liệu cũ, khoản hệ thống tự sinh) ⇒ `false`: không có "người ghi" nào để
 * mà tự xác nhận — giữ đúng hành vi cũ. `nguoiXemId` là `string` BẮT BUỘC (không `null`/`undefined`): chỗ gọi
 * nào chưa có id người xem trong tay là lỗi biên dịch, thay vì lặng lẽ ra `false` = "cho vẽ nút". Chuỗi rỗng ⇒ `false`.
 */
export function laNguoiGhiKhoan(recordedById: string | null | undefined, nguoiXemId: string): boolean {
  return Boolean(recordedById) && Boolean(nguoiXemId) && recordedById === nguoiXemId;
}
