import Link from "next/link";
import { chuanHoaDuongDan } from "./menu";

/**
 * Đang ở trang MỘT BÀI (`/elearning/hoc/{enrollmentId}/{lessonId}`), kể cả khi host e-learning phục vụ clean URL (`/hoc/…`).
 */
export function laTrangBai(duongDan: string): boolean {
  return /^\/elearning\/hoc\/[^/]+\/[^/]+/.test(chuanHoaDuongDan(duongDan));
}

/**
 * Liên kết nội bộ của khung khu học tập.
 *
 * ⚠️ Vì sao có lớp này: bộ đo đọc/xem (`ReadingTracker`, `VideoPlayer`) ghi nhịp mỗi 15 giây và nhịp CUỐI chỉ gửi ở `pagehide`
 * (`sendBeacon`). Điều hướng phía client của `<Link>` KHÔNG bắn `pagehide` ⇒ rời bài bằng nó trước nhịp đầu tiên là server không
 * nhận dòng tiến độ nào (đo 24/10/2026: đọc 12 giây, bấm "Bài sau" ⇒ 0 dòng). Khi `toanTrang` bật thì render `<a href>` thường —
 * tải trang đầy đủ, `pagehide` chạy đúng thiết kế, mà KHÔNG phải sửa mã đo (enforcement giữ nguyên).
 * Trang khác dùng `<Link>` như thường để giữ điều hướng nhanh.
 */
export function LienKet({
  toanTrang = false,
  href,
  children,
  ...rest
}: Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  toanTrang?: boolean;
}) {
  return toanTrang ? (
    <a href={href} {...rest}>
      {children}
    </a>
  ) : (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}
