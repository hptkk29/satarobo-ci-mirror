import { redirect } from "next/navigation";

/**
 * `/orders/duyet` — ĐÃ GỘP VÀO `/orders` [25/09/2026].
 *
 * Chủ dự án: *"đưa mục duyệt đơn vào trong màn đơn hàng, các đơn hàng cần duyệt thì thiết
 * kế nổi bật lên để QLCS biết sẽ có những đơn nào cần duyệt để vào mục duyệt"*.
 *
 * Nội dung nay là một MÀN CON của `/orders`, mở bằng `?duyet=1` — đọc chú thích ở
 * `orders/page.tsx` để biết vì sao tham số URL chứ không phải state của client.
 *
 * ⚠️ Đá về `/orders?duyet=1` chứ KHÔNG phải `/orders` trần: người gõ đường dẫn cũ đang
 * muốn ĐI DUYỆT. Thả họ xuống danh sách rồi bắt tìm lại cái nút là bắt họ trả giá cho
 * một lần đổi cấu trúc mà họ không gây ra.
 *
 * ⚠️ **GIỮ tệp này, đừng xoá.** Đường dẫn đã đi vào thói quen gõ tay, bookmark, và các
 * link nội bộ cũ. Xoá là cho người ta một trang 404 ở đúng chỗ họ quen bấm; đá 307 thì họ
 * tới đúng nơi và tự học lại đường mới. Cùng lối với `sale.satarobo.vn` (CLAUDE.md §3).
 */
export default function DuyetDonHangPage() {
  redirect("/orders?duyet=1");
}
