// app/(admin)/admin/lop-trial/_components/search-form.tsx — GĐ2.
//
// Ô tìm kiếm dùng chung cho cả hai tab của màn "Lớp Trial".
//
// CỐ Ý là Server Component (không "use client", không state, không JS): form GET thuần
// đẩy thẳng bộ lọc lên URL nên trang chia sẻ / đánh dấu / F5 được, và không tốn một
// Client Component nào chỉ để gõ một ô tìm.

import type { JSX } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SearchForm({
  action,
  placeholder,
  hidden,
  defaultValue,
}: {
  /** Đường dẫn trang nhận kết quả, viết theo clean-URL của host admin (vd "/lop-trial"). */
  action: string;
  placeholder: string;
  /**
   * Các tham số lọc hiện hành cần GIỮ LẠI khi submit. Cặp có giá trị `undefined`
   * hoặc chuỗi rỗng bị bỏ qua để không rác URL bằng `?status=`.
   */
  hidden: Record<string, string | undefined>;
  defaultValue?: string;
}): JSX.Element {
  return (
    // ⚠️ Trình duyệt VỨT SẠCH query string có sẵn trong `action` khi submit form GET —
    // nó dựng lại query CHỈ từ các control trong form. Nên bấm chip lọc rồi gõ tìm sẽ
    // mất bộ lọc nếu không tự bơm lại từng tham số bằng input hidden bên dưới.
    // Đây là chỗ vỡ kinh điển của form GET, đừng rút gọn.
    <form method="get" action={action} className="flex w-full items-center gap-2">
      {Object.entries(hidden).map(([name, value]) =>
        value === undefined || value === "" ? null : (
          // `defaultValue` chứ không phải `value`: input hidden ở đây không có onChange,
          // dùng `value` là tự rước cảnh báo "controlled input" của React. HTML sinh ra
          // y hệt nhau.
          <input key={name} type="hidden" name={name} defaultValue={value} />
        ),
      )}

      <Input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 flex-1"
      />

      <Button type="submit" size="sm" className="h-9 shrink-0 gap-1.5">
        <Search className="size-4" aria-hidden="true" />
        Tìm
      </Button>
    </form>
  );
}
