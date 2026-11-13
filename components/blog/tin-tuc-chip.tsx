"use client";

import type { ReactNode } from "react";

/** Tên sự kiện báo cho danh sách bài chọn một chuyên mục (khoá = khoá của `chuyenMucCoBai`). */
export const SU_KIEN_CHON_CHUYEN_MUC = "tin-tuc:chon-chuyen-muc";

/**
 * Chip chuyên mục ở đầu trang (`.chip` của News.dc.html) là LIÊN KẾT lọc: bấm thì cuộn tới danh sách bài và bật tab
 * chuyên mục tương ứng. Không có JS thì vẫn là liên kết neo `#bai-viet`.
 */
export function ChipChuyenMuc({ khoa, children }: { khoa: string; children: ReactNode }) {
  return (
    <a
      className="chip"
      href="#bai-viet"
      style={{ textDecoration: "none", cursor: "pointer", color: "var(--text)" }}
      onClick={() => window.dispatchEvent(new CustomEvent(SU_KIEN_CHON_CHUYEN_MUC, { detail: khoa }))}
    >
      {children}
    </a>
  );
}
