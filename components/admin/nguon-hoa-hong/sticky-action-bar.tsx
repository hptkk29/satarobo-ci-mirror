// components/admin/nguon-hoa-hong/sticky-action-bar.tsx — `StickyActionBar` (06 §5.2): thanh nút dính đáy vùng cuộn của form dài.
//
// Dính vào đáy VÙNG CUỘN (`main` của khung admin), không vào cửa sổ: nên dùng `sticky bottom-0`, không `fixed`. Nền đặc + viền
// trên, KHÔNG làm mờ/blur trang trí (DESIGN.md §7). Trái = thông tin trạng thái ("Đã lưu 14:02", lý do nút tắt); phải = nút.
// Cột trái có nền cơ sở 16rem: câu dài (lý do khoá nút Lưu) thì XUỐNG DÒNG trên hàng riêng ở màn hẹp thay vì bị ép thành cột 100px cạnh nút (chụp thật 375px, 10/10).
// `role="group"` + nhãn để trình đọc màn hình biết đây là cụm thao tác của form, không phải footer trang.
import { cn } from "@/lib/utils";

export function StickyActionBar({
  trai,
  children,
  className,
}: {
  trai?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Thao tác"
      className={cn(
        "sticky bottom-0 z-10 mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-b-xl border-t border-border bg-card px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0 flex-[1_1_16rem] text-sm text-muted-foreground">{trai}</div>
      <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}
