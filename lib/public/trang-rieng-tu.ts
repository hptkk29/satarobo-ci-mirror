// lib/public/trang-rieng-tu.ts — đường dẫn công khai mà CHÍNH ĐƯỜNG DẪN là bí mật (mã liên kết = quyền truy cập). THUẦN, client-safe.
//
// Trang `/thong-tin-hoa-don/<id>.<token>` (phụ huynh điền thông tin người mua hoá đơn, không đăng nhập) nằm dưới `app/(public)` nên thừa hưởng layout marketing + `app/layout.tsx`. Mọi thành phần
// theo dõi / quảng cáo ở đó (GA4, Meta Pixel, ghi nguồn khách, popup, CTA nổi) phải im lặng trên đường dẫn này: GA4 / Pixel gửi TOÀN URL (kèm token) sang bên thứ ba khi người dùng đã đồng ý cookie,
// và `referrer: no-referrer` của trang không chặn được điều đó. Thêm đường dẫn riêng tư mới = thêm tiền tố ở ĐÂY (một chỗ), lưới `[TRT-02]` buộc các thành phần hỏi hàm này.

export const TIEN_TO_TRANG_RIENG_TU = ["/thong-tin-hoa-don"] as const;

export function laTrangRiengTu(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return TIEN_TO_TRANG_RIENG_TU.some((t) => pathname === t || pathname.startsWith(`${t}/`));
}
