"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Cổng phụ huynh — khung 2 cột của "Nhắn cô thầy" (artifact Tin-nhan.dc.html): danh sách hội thoại bên trái, luồng tin bên phải.
// Từ 900px hiện cả hai cột; dưới 900px chỉ hiện MỘT cột (danh sách khi chưa chọn hội thoại, luồng tin khi đã chọn) — cùng 2 route như cũ,
// nên mọi đường vào (/portal/tin-nhan, /portal/tin-nhan/[id]) và cổng chính sách giữ nguyên.

export function TinNhanKhung({ danhSach, children }: { danhSach: ReactNode; children: ReactNode }) {
  const seg = useSelectedLayoutSegment();
  const daChon = seg !== null;
  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-[28px] font-extrabold leading-[34px] min-[560px]:text-[32px] min-[560px]:leading-[38px]">Nhắn cô thầy</h1>
        <div className="text-sm text-[var(--sr-ink-muted)]">Trao đổi trực tiếp với giáo viên và trung tâm.</div>
      </header>
      <div className="flex min-h-[560px] overflow-hidden rounded-[20px] border border-border bg-card min-[900px]:min-h-[720px]">
        <nav
          aria-label="Cuộc trò chuyện"
          className={cn(
            "min-w-0 flex-col gap-1 border-border p-3 min-[900px]:flex min-[900px]:w-[320px] min-[900px]:flex-none min-[900px]:border-r",
            daChon ? "hidden" : "flex flex-1",
          )}
        >
          {danhSach}
        </nav>
        <section className={cn("min-w-0 flex-1 flex-col min-[900px]:flex", daChon ? "flex" : "hidden")}>{children}</section>
      </div>
    </div>
  );
}

/** Một dòng hội thoại — client để tô đậm dòng đang mở theo URL. */
export function DongHoiThoai({
  id,
  ten,
  vaiTro,
  xemTruoc,
  gio,
  chuaDoc,
  daXoa,
  luuTru,
  nhan,
}: {
  id: string;
  ten: string;
  vaiTro: string;
  xemTruoc: string;
  gio: string | null;
  chuaDoc: number;
  daXoa: boolean;
  luuTru: boolean;
  nhan: string;
}) {
  const seg = useSelectedLayoutSegment();
  const dang = seg === id;
  return (
    <Link
      href={`/portal/tin-nhan/${id}`}
      aria-current={dang ? "page" : undefined}
      className={cn("flex min-h-16 items-center gap-3 rounded-xl p-3 text-[var(--sr-ink)] hover:bg-[var(--sr-tint-purple)]", dang ? "bg-[var(--sr-tint-purple)]" : "")}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-[42px] flex-none items-center justify-center rounded-xl text-[13px] font-bold",
          luuTru ? "bg-[var(--sr-soft-off)] text-[var(--sr-soft-off-ink)]" : "bg-[var(--sr-purple)] text-white",
        )}
      >
        {nhan}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex justify-between gap-2">
          <span className={cn("min-w-0 truncate text-sm", chuaDoc > 0 ? "font-extrabold" : "font-bold")}>{ten}</span>
          {gio ? <span className="flex-none text-[11px] text-[var(--sr-ink-muted)]">{gio}</span> : null}
        </span>
        <span className="truncate text-xs text-[var(--sr-ink-muted)]">{vaiTro}</span>
        <span className={cn("truncate text-[13px]", daXoa ? "italic text-[var(--sr-ink-muted)]" : "")}>{xemTruoc}</span>
      </span>
      {chuaDoc > 0 ? (
        <span className="flex h-5 min-w-5 flex-none items-center justify-center rounded-full bg-[var(--sr-orange)] px-1 text-[10px] font-bold text-[var(--sr-on-orange)]">
          {chuaDoc > 9 ? "9+" : chuaDoc}
        </span>
      ) : null}
    </Link>
  );
}
