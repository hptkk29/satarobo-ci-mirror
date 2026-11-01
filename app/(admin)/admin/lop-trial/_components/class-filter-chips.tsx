// app/(admin)/admin/lop-trial/_components/class-filter-chips.tsx — GĐ2.
//
// SERVER Component (không "use client"): chỉ render <Link>, không state/effect/handler.

import type { JSX } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { docLocLop } from "../_lib/filters";

const CHIP_BASE = "rounded-full px-3 py-1.5 text-sm transition-colors";

function chipClass(active: boolean): string {
  return cn(
    CHIP_BASE,
    active
      ? "bg-primary text-white"
      : "bg-muted text-muted-foreground hover:bg-muted/70",
  );
}

/**
 * Dựng href cho một chip.
 *
 * ⚠️ Luôn mang theo `q`: chip là <Link> nên URL mới THAY hẳn URL cũ, không
 * merge. Quên `q` là mỗi lần bấm lọc lại xoá trắng ô tìm của người dùng.
 */
function buildHref(status: string | undefined, q: string | undefined): string {
  const sp = new URLSearchParams();
  if (status) sp.set("status", status);
  if (q) sp.set("q", q);
  const qs = sp.toString();
  return qs ? `/lop-trial?${qs}` : "/lop-trial";
}

/**
 * Danh sách chip cho bảng lớp trải nghiệm.
 *
 * ⚠️ "Đang mở" KHÁC "Đang mở lớp":
 * - "Đang mở" = chế độ MẶC ĐỊNH, href cố ý KHÔNG có tham số `status`. Bộ lọc ở
 *   `_lib/queries.ts` hiểu `status` rỗng là "ẩn COMPLETED + CANCELLED", tức gộp
 *   cả OPEN lẫn RUNNING.
 * - "Đang mở lớp" = `?status=OPEN`, lọc đúng một trạng thái.
 * Đặt `?status=OPEN` cho chip mặc định sẽ âm thầm giấu mất các lớp RUNNING.
 */
export function ClassFilterChips({
  current,
  q,
}: {
  current?: string;
  q?: string;
}): JSX.Element {
  // Chuỗi rỗng và undefined đều là "chưa lọc" — searchParams trả "" khi URL có `?status=`.
  const active = current || "";

  // 23/09 — chip theo trạng thái HIỂN THỊ (lib/trial/trang-thai-lop.ts), cùng bộ đọc
  // với bộ lọc (`docLocLop`) nên link cũ `?status=COMPLETED` vẫn sáng đúng chip.
  const loc = active ? docLocLop(active) : "dang-mo";
  const chips: { label: string; status?: string; isActive: boolean }[] = [
    { label: "Đang mở", status: undefined, isActive: loc === "dang-mo" },
    { label: "Đã đóng", status: "da-dong", isActive: loc === "da-dong" },
    { label: "Đã huỷ", status: "da-huy", isActive: loc === "da-huy" },
    { label: "Tất cả", status: "all", isActive: loc === "all" },
  ];

  return (
    <nav
      aria-label="Lọc lớp theo trạng thái"
      className="flex flex-wrap items-center gap-2"
    >
      {chips.map((chip) => (
        <Link
          key={chip.label}
          href={buildHref(chip.status, q)}
          aria-current={chip.isActive ? "page" : undefined}
          className={chipClass(chip.isActive)}
        >
          {chip.label}
        </Link>
      ))}
    </nav>
  );
}
