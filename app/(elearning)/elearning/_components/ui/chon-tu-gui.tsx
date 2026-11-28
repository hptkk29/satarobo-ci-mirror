"use client";

import { cn } from "@/lib/utils";

/**
 * Ô chọn TỰ GỬI form khi đổi giá trị (thiết kế: "Sắp xếp" không có nút Áp dụng). Là tăng cường dần (progressive enhancement): trang vẫn là
 * form GET chạy được KHÔNG cần JavaScript — khi đó trang nhớ đặt một nút "Áp dụng" trong `<noscript>`.
 */
export function ChonTuGui({
  name,
  defaultValue,
  className,
  children,
}: {
  name: string;
  defaultValue: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className={cn(className)}
    >
      {children}
    </select>
  );
}
