/**
 * Lớp phạm vi cho hộp nổi render qua PORTAL (Dialog · Sheet · Tooltip · Popover) — giải gốc R1 của audit 05.
 *
 * VẤN ĐỀ. Token admin (`--primary` tím, `--accent`…) chỉ có BÊN TRONG phần tử `.admin-scope`
 * (`app/globals.css`, `components/admin/admin-shell.tsx`). Hộp nổi của base-ui render qua portal ra `<body>`, tức
 * NGOÀI khung đó ⇒ `bg-primary` rơi về CAM của `:root`, chữ trắng trên cam ≈ 2,3:1 (trượt AA). Trước đây từng chỗ gọi
 * tự nhớ gắn `admin-scope` vào className (ban-chung-tu.tsx, huy-phieu-the-dialog.tsx…); `ConfirmDialog` quên và không
 * test nào đỏ — cùng họ lỗi "quên truyền cờ" của luật 11.
 *
 * CÁCH GIẢI. Popup tự hỏi: "trang này có khung `.admin-scope` không?" — có thì tự gắn `admin-scope` lên CHÍNH popup
 * (cùng phần tử mà các chỗ gọi đang vá tay; gắn trùng là vô hại). Không có (site public, cổng phụ huynh, site giáo viên)
 * thì trả chuỗi rỗng ⇒ không đổi một lớp CSS nào ở các site đó.
 *
 * VÌ SAO KHÔNG DÙNG CONTEXT/PROVIDER. Provider phải đặt ở `admin-shell.tsx` (ngoài phạm vi lát này) — chưa đặt thì
 * bản vá chết im lặng. Thăm dò DOM chạy ngay, không phụ thuộc dây nối ở nơi khác.
 *
 * VÌ SAO KHÔNG DỜI CONTAINER CỦA PORTAL VÀO TRONG KHUNG. Khung admin là `h-screen overflow-hidden`; đặt popup vào
 * trong dễ bị cắt/đè lớp xếp chồng — thứ jsdom không thấy. Giữ nguyên chỗ portal, chỉ thêm class.
 *
 * SSR an toàn: popup chỉ có trong cây sau khi Portal đã gắn (client), nên giá trị tính lúc render không gây lệch
 * hydration; ở server `document` không tồn tại ⇒ rỗng.
 */

/** Tên lớp token admin — trùng với `.admin-scope` trong `app/globals.css`. */
export const LOP_PHAM_VI_QUAN_TRI = "admin-scope";

/** THUẦN — nhận "tài liệu" để test được mà không cần jsdom thật. `null` ⇒ không ở trình duyệt. */
export function lopPhamViChoTaiLieu(taiLieu: Pick<Document, "querySelector"> | null): string {
  if (!taiLieu) return "";
  return taiLieu.querySelector(`.${LOP_PHAM_VI_QUAN_TRI}`) ? LOP_PHAM_VI_QUAN_TRI : "";
}

/** Dùng trong popup: `cn(useLopPhamViPortal(), "...", className)`. Rỗng khi không ở trong khung admin. */
export function useLopPhamViPortal(): string {
  return lopPhamViChoTaiLieu(typeof document === "undefined" ? null : document);
}
