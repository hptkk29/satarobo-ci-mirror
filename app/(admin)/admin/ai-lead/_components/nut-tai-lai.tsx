import Link from "next/link";

/**
 * Nút «Tải lại» cho `ErrorState` của màn do Server Component bắt lỗi (không qua ranh giới `error.tsx`, nên không có `reset`).
 * Câu lỗi nói «Thử tải lại trang» nhưng điện thoại không có F5 dễ — đo 28/10/2026: ErrorState của Cấu hình/Kết nối/Chi tiết chỉ có chữ, không có nút (Ngoại lệ đã có).
 * Là liên kết về CHÍNH địa chỉ đang xem (giữ `?tab=`), vùng bấm ≥44px.
 */
export function NutTaiLai({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      Tải lại
    </Link>
  );
}
