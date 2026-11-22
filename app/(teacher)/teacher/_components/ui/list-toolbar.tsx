"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchInput } from "./search-input";

export interface SelectFilter {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  /** Bề rộng cố định cho trigger, vd "w-44". */
  className?: string;
}

/**
 * Thanh công cụ danh sách: ô tìm kiếm + N bộ lọc.
 *
 * TeachUI dựng trên Radix Select; repo đã chuẩn hoá trên Base UI, nên đây dùng
 * `@/components/ui/select` của repo (KHÔNG thêm dependency Radix mới). API bên
 * ngoài giữ nguyên `SelectFilter` để các trang gọi không phải sửa.
 *
 * Base UI `SelectValue` render giá trị thô nếu không truyền `items`, nên ta tự
 * ánh xạ value → label bằng children dạng hàm.
 */
export function ListToolbar({
  query,
  onQuery,
  placeholder = "Tìm kiếm...",
  actions,
  filters = [],
}: {
  query: string;
  onQuery: (v: string) => void;
  placeholder?: string;
  /** Nút hành động bên phải thanh công cụ (vd "Giao bài", "Tạo bài tập") — parity TeachUI. */
  actions?: React.ReactNode;
  filters?: SelectFilter[];
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
      <SearchInput
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={placeholder}
        containerClassName="flex-1 sm:max-w-xs"
      />
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f, i) => (
          <Select
            key={i}
            value={f.value}
            // Base UI phát `string | null` (Radix phát `string`). Bộ lọc luôn có
            // một option được chọn, nên bỏ qua null thay vì ép kiểu.
            onValueChange={(v) => {
              if (v !== null) f.onChange(v);
            }}
          >
            <SelectTrigger
              className={
                f.className ?? "h-10 w-auto min-w-[9rem] rounded-xl font-medium"
              }
            >
              <SelectValue>
                {(v: string | null) =>
                  f.options.find((o) => o.value === v)?.label ?? ""
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {f.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
      </div>
      {actions && <div className="sm:ml-auto">{actions}</div>}
    </div>
  );
}
