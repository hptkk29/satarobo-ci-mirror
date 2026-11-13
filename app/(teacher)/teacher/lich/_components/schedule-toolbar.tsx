"use client";

// Thanh tìm kiếm + lọc cho Lịch làm việc. Trang lịch điều hướng THUẦN server qua
// searchParams (?view=&moc=) nên toolbar cũng đi theo: đổi bộ lọc / submit tìm
// kiếm → router.push GIỮ NGUYÊN các param hiện có (view/moc), chỉ thêm/bớt
// q/type/status. Dùng push tương đối ("?...") để chạy đúng cả host giaovien
// (clean URL /lich) LẪN localhost (/teacher/lich).

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchInput } from "../../_components/ui/search-input";

const TYPE_OPTIONS = [
  { value: "all", label: "Lớp & Trial" },
  { value: "lop", label: "Chỉ lớp" },
  { value: "trial", label: "Chỉ Trial" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "Mọi trạng thái" },
  { value: "SCHEDULED", label: "Đã lên lịch" },
  { value: "IN_PROGRESS", label: "Đang diễn ra" },
  { value: "COMPLETED", label: "Đã dạy" },
  { value: "CANCELLED", label: "Đã hủy" },
];

function labelOf(
  opts: { value: string; label: string }[],
  v: string | null,
): string {
  return opts.find((o) => o.value === v)?.label ?? "";
}

export function ScheduleToolbar({
  q,
  type,
  status,
}: {
  q: string;
  type: string;
  status: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [text, setText] = useState(q);

  function push(updates: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (!v || v === "all") p.delete(k);
      else p.set(k, v);
    }
    const qs = p.toString();
    // scroll:false — đổi bộ lọc là GIỮ NGUYÊN trang, chỉ đổi tham số truy vấn.
    // Mặc định App Router cuộn vọt lên đầu sau mỗi lần cập nhật router state.
    router.push(qs ? `?${qs}` : "?", { scroll: false });
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          push({ q: text.trim() || null });
        }}
        className="flex-1 sm:max-w-sm"
      >
        <SearchInput
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Tìm theo tên lớp/buổi thử, bài học..."
        />
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={type}
          onValueChange={(v) => v !== null && push({ type: v })}
        >
          <SelectTrigger className="h-10 w-auto min-w-[9rem] rounded-xl font-medium">
            <SelectValue>
              {(v: string | null) => labelOf(TYPE_OPTIONS, v)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => v !== null && push({ status: v })}
        >
          <SelectTrigger className="h-10 w-auto min-w-[9rem] rounded-xl font-medium">
            <SelectValue>
              {(v: string | null) => labelOf(STATUS_OPTIONS, v)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
