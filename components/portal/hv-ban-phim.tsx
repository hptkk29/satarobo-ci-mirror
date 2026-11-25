"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Bàn phím nhập mã 4 số dùng chung cho màn Vào / Mã / Thoát (artifact HV-Vao, HV-Ma, HV-Thoat).
// Nhập đủ 4 số thì gọi `onXong(ma)` sau một nhịp ngắn rồi XOÁ ô nhập (mã không nằm lại trong state sau khi dùng).
// Bàn phím vật lý cũng dùng được (0–9, Backspace) — người lớn nhập mã trên máy tính.

type Kich = "vao" | "ma" | "thoat";

const NUT: Record<Kich, string> = {
  vao: "h-[52px] w-16 rounded-[14px] text-[22px]",
  ma: "h-[60px] w-[68px] rounded-2xl text-2xl",
  thoat: "size-[72px] rounded-full text-[26px]",
};
const LUOI: Record<Kich, string> = {
  vao: "grid-cols-[repeat(3,64px)] gap-2",
  ma: "grid-cols-[repeat(3,68px)] gap-2.5",
  thoat: "grid-cols-[repeat(3,72px)] gap-3",
};

export function HvBanPhim({
  kich,
  onXong,
  khoa = false,
  chamDem = 4,
  thayDoi,
  nhanTieuDe,
}: {
  kich: Kich;
  /** Trả `true` nếu muốn GIỮ ô nhập (hiếm), mặc định xoá. */
  onXong: (ma: string) => void | Promise<void>;
  khoa?: boolean;
  chamDem?: number;
  thayDoi?: (soSo: number) => void;
  nhanTieuDe?: string;
}) {
  const [so, setSo] = useState("");
  const buf = useRef("");
  const treo = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dangXuLy = useRef(false);

  const dat = useCallback(
    (v: string) => {
      buf.current = v;
      setSo(v);
      thayDoi?.(v.length);
    },
    [thayDoi],
  );
  const them = useCallback(
    (d: string) => {
      if (khoa || dangXuLy.current || buf.current.length >= chamDem) return;
      const moi = buf.current + d;
      dat(moi);
      if (moi.length === chamDem) {
        dangXuLy.current = true;
        treo.current = setTimeout(async () => {
          try {
            await onXong(moi);
          } finally {
            dangXuLy.current = false;
            dat("");
          }
        }, 180);
      }
    },
    [chamDem, dat, khoa, onXong],
  );
  const xoa = useCallback(() => {
    if (dangXuLy.current) return;
    dat(buf.current.slice(0, -1));
  }, [dat]);

  useEffect(() => () => void (treo.current && clearTimeout(treo.current)), []);
  useEffect(() => {
    const phim = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (/^\d$/.test(e.key)) them(e.key);
      else if (e.key === "Backspace") xoa();
    };
    window.addEventListener("keydown", phim);
    return () => window.removeEventListener("keydown", phim);
  }, [them, xoa]);

  const phim = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "x"];
  return (
    <div className="flex flex-col items-center gap-3">
      <div aria-live="polite" aria-label={nhanTieuDe ?? `Đã nhập ${so.length} trên ${chamDem} số`} className={cn("flex h-6 items-center", kich === "thoat" ? "gap-3.5" : "gap-3")}>
        {Array.from({ length: chamDem }, (_, i) => (
          <span key={i} className={cn("box-border size-4 rounded-full", i < so.length ? "bg-[var(--sr-purple)]" : "border-2 border-[var(--sr-dash)]")} />
        ))}
      </div>
      <div className={cn("grid", LUOI[kich])}>
        {phim.map((d, i) =>
          d === "" ? (
            <span key={i} className={cn(NUT[kich], "invisible")} />
          ) : (
            <button
              key={i}
              type="button"
              disabled={khoa}
              aria-label={d === "x" ? "Xoá số vừa nhập" : `Số ${d}`}
              onClick={() => (d === "x" ? xoa() : them(d))}
              className={cn(
                NUT[kich],
                "border-0 font-bold text-foreground transition-transform active:scale-95 disabled:opacity-40",
                d === "x" ? "bg-card text-[22px] shadow-[inset_0_0_0_1px_var(--border)]" : "bg-[var(--sr-tint-purple)]",
              )}
            >
              {d === "x" ? "⌫" : d}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
