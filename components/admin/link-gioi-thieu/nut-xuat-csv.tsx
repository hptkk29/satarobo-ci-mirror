"use client";

// components/admin/link-gioi-thieu/nut-xuat-csv.tsx — «Xuất CSV» của bảng «Dòng hoa hồng». Xuất ĐÚNG các dòng đang hiện trên màn (đã lọc, SĐT đã che) — không gọi máy chủ,
// không có dữ liệu nào mà màn chưa cho người này xem (cùng cách với bảng thống kê trial).
import { Download } from "lucide-react";

import type { DongHoaHongGioiThieu } from "@/lib/nguon/hoa-hong-gioi-thieu";

const o = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function NutXuatCsv({ dong }: { dong: readonly DongHoaHongGioiThieu[] }) {
  function xuat() {
    const dau = ["Phụ huynh được giới thiệu", "SĐT", "Khoá", "Đã đóng (gồm VAT)", "Mức", "Hoa hồng", "Trạng thái"];
    const than = dong.map((d) => [d.phuHuynh, d.sdtChe, d.khoaHoc, d.daDong, d.muc, d.hoaHong, d.nhanTrangThai]);
    const csv = "﻿" + [dau, ...than].map((h) => h.map(o).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "dong-hoa-hong-gioi-thieu.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button
      type="button"
      onClick={xuat}
      disabled={dong.length === 0}
      className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 md:h-9"
    >
      <Download aria-hidden className="size-4" />
      Xuất CSV
    </button>
  );
}
