// Link "về trang…" của trang 404 theo tên miền đang truy cập.
//
// ⚠️ Hàm THUẦN, nhận `host` do NƠI GỌI đưa vào. Trang 404 gốc (`app/not-found.tsx`) KHÔNG được đọc
// `headers()`/`cookies()` trên server: khi `notFound()` bắn từ một route tĩnh/ISR (slug chưa prerender, vd.
// `/tin-tuc/<slug lạ>`), Next render trang 404 trong ngữ cảnh TĨNH, một API động ở đó làm route "chuyển
// static → dynamic ở runtime" và khách nhận 500 thay vì 404 (đo 30/10/2026, cả Next 16.2.6 lẫn 16.4.3).
// Nên host được đọc ở TRÌNH DUYỆT (components/not-found/nut-ve-trang-chinh.tsx), còn quy tắc chọn đích nằm ở đây.
export type DichDen404 = { href: string; label: string };

export const DICH_DEN_MAC_DINH: DichDen404 = { href: "/", label: "Về trang chủ" };

export function chonDichDen404(host: string | null | undefined): DichDen404 {
  const h = (host ?? "").toLowerCase();
  if (h.startsWith("giaovien.")) return { href: "/teacher", label: "Về trang giáo viên" };
  if (h.startsWith("hocvien.")) return { href: "/portal", label: "Về cổng phụ huynh" };
  // `sale.` chỉ còn là host được 307 về admin (proxy.ts) nhưng giữ nhánh cho khớp hành vi cũ.
  if (h.startsWith("admin.") || h.startsWith("sale.")) return { href: "/dashboard", label: "Về Dashboard" };
  return DICH_DEN_MAC_DINH;
}
