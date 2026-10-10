"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

// Một ô lọc = một tham số URL. Đổi bộ lọc thì về trang 1 (`page` bỏ đi) — giữ trang cũ là dễ
// rơi vào trang trống khi tập đã hẹp lại. Lọc nằm trên URL nên bấm vào case rồi quay lại vẫn giữ.

export function OLoc({
  nhan,
  thamSo,
  giaTri,
  luaChon,
  tatCa,
  className,
}: {
  nhan: string;
  thamSo: string;
  giaTri: string;
  luaChon: { value: string; label: string }[];
  /** Nhãn cho "không lọc" — bỏ đi thì ô bắt buộc chọn một giá trị. */
  tatCa?: string;
  className?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const id = useId();

  function doi(v: string) {
    const p = new URLSearchParams(sp?.toString() ?? "");
    if (v) p.set(thamSo, v);
    else p.delete(thamSo);
    p.delete("page");
    start(() => router.replace(`?${p.toString()}`, { scroll: false }));
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-2 text-sm", className)}>
      <label htmlFor={id} className="whitespace-nowrap text-muted-foreground">
        {nhan}
      </label>
      <select
        id={id}
        value={giaTri}
        disabled={pending}
        onChange={(e) => doi(e.target.value)}
        className="h-9 min-w-0 max-w-[14rem] rounded-lg border border-border bg-background py-0 pl-2.5 pr-7 text-sm text-foreground outline-none transition-colors focus:border-primary disabled:opacity-60"
      >
        {tatCa !== undefined && <option value="">{tatCa}</option>}
        {luaChon.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Ô tìm học viên = tham số `q`. Gõ là lọc (chờ 350 ms cho dứt tay), Enter là lọc ngay, nút ✕ xoá.
// Cùng luật với `OLoc`: đổi chuỗi tìm thì về trang 1.
export function OTim({ giaTri, goiY, className }: { giaTri: string; goiY: string; className?: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [chu, setChu] = useState(giaTri);
  const hen = useRef<ReturnType<typeof setTimeout> | null>(null);

  // URL đổi từ nơi khác (nút "Xoá lọc", đổi tab) ⇒ ô theo về.
  useEffect(() => setChu(giaTri), [giaTri]);
  useEffect(() => () => {
    if (hen.current) clearTimeout(hen.current);
  }, []);

  function ap(v: string) {
    if (hen.current) clearTimeout(hen.current);
    const p = new URLSearchParams(sp?.toString() ?? "");
    const s = v.trim();
    if (s === (sp?.get("q") ?? "")) return;
    if (s) p.set("q", s);
    else p.delete("q");
    p.delete("page");
    start(() => router.replace(`?${p.toString()}`, { scroll: false }));
  }

  return (
    <form
      role="search"
      className={cn("relative w-full sm:w-72", className)}
      onSubmit={(e) => {
        e.preventDefault();
        ap(chu);
      }}
    >
      <label className="sr-only" htmlFor="hoc-bu-tim">
        Tìm học viên
      </label>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        id="hoc-bu-tim"
        type="search"
        value={chu}
        onChange={(e) => {
          const v = e.target.value;
          setChu(v);
          if (hen.current) clearTimeout(hen.current);
          hen.current = setTimeout(() => ap(v), 350);
        }}
        placeholder={goiY}
        autoComplete="off"
        aria-busy={pending}
        className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {chu && (
        <button
          type="button"
          onClick={() => {
            setChu("");
            ap("");
          }}
          aria-label="Xoá chuỗi tìm"
          className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </form>
  );
}
