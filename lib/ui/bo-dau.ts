// lib/ui/bo-dau.ts — BỎ DẤU TIẾNG VIỆT cho việc tìm kiếm. HÀM THUẦN, dùng được CẢ hai phía.
//
// ⚠️ FILE NÀY KHÔNG ĐƯỢC CÓ `"use client"`. Đó là toàn bộ lý do nó tồn tại — y hệt
// `lib/ui/phan-trang.ts` bên cạnh.
//
// Bản đầu của hàm này nằm trong `app/(admin)/admin/tra-cuu/_components/tra-cuu-workspace.tsx`
// (một file `"use client"`), còn `page.tsx` — Server Component — gọi nó để ghép sẵn chuỗi
// tìm. Kết quả: `pnpm typecheck` XANH, `pnpm build` XANH, và trang **sập lúc chạy** với
//   "An error occurred in the Server Components render"
// Đây là ràng buộc RUNTIME của RSC, không phải lỗi kiểu, nên không cổng tĩnh nào bắt được;
// chỉ mở trang thật mới thấy. Cùng một sự cố đã xảy ra 12/08/2026 với `docSoDong()`.
//
// ⇒ Hằng số và hàm thuần dùng chung phải ở module KHÔNG đánh dấu phía nào.

/**
 * Chuẩn hoá chuỗi để so khớp khi tìm: bỏ dấu, hạ chữ thường, cắt khoảng trắng hai đầu.
 * "Luyện thi RoboSim" → "luyen thi robosim", nên gõ "luyen thi" là ra.
 *
 * ⚠️ `normalize("NFD")` tách được dấu phụ (`ộ` → `o` + dấu) nhưng KHÔNG tách `đ`: nó là
 * một ký tự riêng trong Unicode, không phải `d` + dấu. Thiếu hai dòng thay `đ`/`Đ` thì
 * gõ "do choi" không ra "Đồ chơi" — lỗi câm, người dùng chỉ kết luận "hệ thống không có".
 * Cùng cái bẫy đã ghi ở `lib/orders/uu-dai-anh-em.ts`.
 */
export function boDau(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}
