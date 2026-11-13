"use client";

// components/admin/nguon-hoa-hong/tbody-dieu-huong.tsx — ↑/↓ đổi dòng trong hàng chờ (06 §7: "hàng chờ đi bằng ↑/↓ + Enter mở Sheet").
//
// Bảng hàng chờ là Server Component; chỉ `<tbody>` này là client để nhận phím. Mỗi dòng có đúng MỘT nút mở Sheet (`[data-nut-hang]`):
// ↓/↑ chuyển focus sang nút của dòng kế/trước, Enter (hành vi sẵn của nút) mở Sheet. Không bắt phím khi focus không nằm trên một nút
// dòng (vd đang gõ trong Sheet — Sheet nằm trong portal nên sự kiện không nổi lên `<tbody>` qua DOM, nhưng portal React vẫn nổi qua
// cây React: nên kiểm `target.closest("[data-nut-hang]")` chứ không tin vị trí).
import type { KeyboardEvent, ReactNode } from "react";

export const THUOC_TINH_NUT_HANG = "data-nut-hang";

export function TbodyDieuHuong({ children }: { children: ReactNode }) {
  function onKeyDown(e: KeyboardEvent<HTMLTableSectionElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const dich = e.target as HTMLElement;
    const nut = dich.closest<HTMLElement>(`[${THUOC_TINH_NUT_HANG}]`);
    if (!nut || !e.currentTarget.contains(nut)) return;
    const tatCa = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(`[${THUOC_TINH_NUT_HANG}]`));
    const i = tatCa.indexOf(nut);
    const j = e.key === "ArrowDown" ? i + 1 : i - 1;
    const tiep = tatCa[j];
    if (i < 0 || !tiep) return; // đầu/cuối danh sách: giữ nguyên, không vòng
    e.preventDefault(); // chặn cuộn trang theo phím mũi tên
    tiep.focus();
  }
  return <tbody onKeyDown={onKeyDown}>{children}</tbody>;
}
