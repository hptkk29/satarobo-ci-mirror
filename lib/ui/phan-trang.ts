// lib/ui/phan-trang.ts — HẰNG SỐ + HÀM THUẦN của phân trang, dùng được ở CẢ hai phía.
//
// ⚠️ FILE NÀY KHÔNG ĐƯỢC CÓ `"use client"`. Đó là toàn bộ lý do nó tồn tại.
//
// Sự cố 12/08/2026: `docSoDong()` ban đầu nằm trong `components/ui/chon-so-dong.tsx` —
// một file `"use client"`. Server Component gọi nó thì Next ném ngay lúc chạy:
//   "Attempted to call docSoDong() from the server but docSoDong is on the client."
// `tsc` và `next build` đều XANH, vì đây là ràng buộc RUNTIME của RSC chứ không phải lỗi
// kiểu. Người dùng thấy màn hình lỗi kèm mã digest, còn nguyên nhân thì nằm trong log
// server. Bài học: hằng số và hàm thuần dùng chung phải ở module KHÔNG đánh dấu phía nào.

/** Các mức số dòng/trang người dùng chọn được. */
export const MUC_SO_DONG = [10, 20, 50, 100] as const;

/** Mặc định cho MỌI bảng trong hệ (chủ dự án chốt 11/08/2026). */
export const SO_DONG_MAC_DINH = 20;

/**
 * Đọc `?size=` từ searchParams. Chỉ nhận đúng 4 mức trên; mọi thứ khác → mặc định.
 *
 * Chặt tay là có chủ đích: đây là tham số người dùng gõ thẳng vào thanh địa chỉ, và
 * `?size=99999` sẽ thành `take: 99999` trong truy vấn — một cách làm sập trang bằng URL.
 */
export function docSoDong(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return MUC_SO_DONG.includes(n as (typeof MUC_SO_DONG)[number]) ? n : SO_DONG_MAC_DINH;
}

// ─── Kanban lead ──────────────────────────────────────────────────────────────

/**
 * Số thẻ hiển thị TỐI ĐA trong MỘT cột Kanban.
 *
 * Vì sao mặc định 10 mà không phải 20 như bảng: cột Kanban xếp DỌC và có 10 cột nằm
 * ngang. Một cột 50 thẻ đẩy trang dài ra tới mức muốn xem cột kế bên phải cuộn dọc về
 * đầu rồi cuộn ngang — đúng cái làm người dùng bỏ chế độ Kanban. Mười thẻ là vừa một
 * màn hình, và người cần xem sâu hơn thì có ô chọn ngay trên đầu.
 *
 * Mức chọn dùng chung `MUC_SO_DONG` với bảng (10/20/50/100), chỉ khác GIÁ TRỊ MẶC ĐỊNH.
 */
export const SO_THE_MOI_COT_MAC_DINH = 5;

/**
 * Mức chọn RIÊNG của Kanban — có thêm mức 5, KHÁC `MUC_SO_DONG` của bảng.
 *
 * Vì sao không nhét 5 vào `MUC_SO_DONG` dùng chung: `MUC_SO_DONG[0]` đang được ba
 * component phân trang dùng làm NGƯỠNG hiện thanh phân trang (`tong > MUC_SO_DONG[0]`).
 * Thêm 5 vào đầu mảng là mọi bảng trong hệ đổi ngưỡng từ 10 xuống 5 — thanh phân trang
 * mọc ra ở những bảng 6 dòng vốn đang gọn. Đổi Kanban thì đổi mỗi Kanban.
 */
export const MUC_THE_MOI_COT = [5, 10, 20, 50, 100] as const;

/**
 * Đọc `?size=` cho Kanban. Dùng CHUNG tham số với bảng, nên bốn mức 10/20/50/100 giữ
 * nguyên khi bấm qua lại giữa hai chế độ.
 *
 * ⚠️ Mức 5 chỉ Kanban hiểu. Chọn 5 ở Kanban rồi bấm sang Bảng thì bảng về mặc định 20
 * (`docSoDong` không nhận 5) — chấp nhận có chủ đích: bảng không có mục 5 trong ô chọn,
 * cho nó nhận 5 là ô chọn hiện giá trị không có trong danh sách.
 *
 * Chặt tay như `docSoDong`: chỉ nhận đúng 5 mức, mọi thứ khác về mặc định.
 */
export function docSoTheMoiCot(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return MUC_THE_MOI_COT.includes(n as (typeof MUC_THE_MOI_COT)[number])
    ? n
    : SO_THE_MOI_COT_MAC_DINH;
}
