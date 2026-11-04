import { notFound } from "next/navigation";

// Ẩn TẠM THỜI trang Học cụ (/hoc-cu) khỏi site công khai.
//
// Lý do: hướng dẫn nộp hồ sơ Bộ Công Thương mục 4 — *"Tạm thời ẩn các sản phẩm/dịch vụ
// không công khai giá và không đặt hàng được"*. Ba bộ ZMROBO đủ CẢ HAI vế:
//   · giá: ô "GIÁ" in `kit.priceDisplay`, mặc định DB là chuỗi "Liên hệ tư vấn";
//   · đặt hàng: nút duy nhất là "Tư vấn ngay" → /lien-he (form lead), không có luồng đơn.
//
// VÌ SAO ẨN BẰNG MÃ, KHÔNG BẰNG DỮ LIỆU: đường dữ liệu (tắt công tắc "Đã đăng" ở
// /admin/kits) KHÔNG ghi audit — `grep writeAudit app/(admin)/admin/kits/_actions.ts` ra 0
// dòng. Nghĩa là trạng thái đã khai với cơ quan quản lý có thể bị đổi lại mà không ai biết
// và không có dấu vết. Ẩn bằng một file thì việc bật lại nằm trong lịch sử git.
//
// Bật lại = XOÁ ĐÚNG FILE NÀY, rồi bỏ comment mục "Học cụ" ở `components/public/header.tsx`
// + `components/sections/mobile-nav-drawer.tsx` + `components/sections/site-footer.tsx`,
// và thêm lại `/hoc-cu` vào `app/sitemap.ts`.
//
// Khuôn lấy từ `app/(public)/vinh-danh/layout.tsx` — cách ẩn này đang chạy thật trên prod.
export default function HocCuHiddenLayout() {
  notFound();
}
