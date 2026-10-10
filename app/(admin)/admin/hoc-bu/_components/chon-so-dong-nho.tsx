"use client";

import { useId, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MUC_THE_MOI_COT } from "@/lib/ui/phan-trang";

import { COOKIE_SO_DONG_HOC_BU } from "@/lib/hoc-bu/huy";

// Ô "Hiển thị N dòng" NHỚ lựa chọn (chủ dự án 29/09: "khi quay lại trang vẫn giữ nguyên lựa chọn
// đó chứ không phải reset về 5"). Lưu vào cookie để CHÍNH máy chủ đọc được lúc dựng trang —
// localStorage thì trang phải vẽ 5 dòng trước rồi mới nhảy, và server không biết gì.

export function ChonSoDongNho({ soDong, tong, tenDonVi }: { soDong: number; tong: number; tenDonVi: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const id = useId();

  function doi(n: number) {
    document.cookie = `${COOKIE_SO_DONG_HOC_BU}=${n}; path=/; max-age=31536000; samesite=lax`;
    const p = new URLSearchParams(sp?.toString() ?? "");
    p.set("size", String(n));
    p.delete("page");
    start(() => router.replace(`?${p.toString()}`, { scroll: false }));
  }

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <label htmlFor={id} className="whitespace-nowrap">
        Hiển thị
      </label>
      <select
        id={id}
        value={soDong}
        disabled={pending}
        onChange={(e) => doi(Number(e.target.value))}
        className="h-9 rounded-lg border border-border bg-background py-0 pl-2.5 pr-7 text-sm text-foreground outline-none transition-colors focus:border-primary disabled:opacity-60"
      >
        {MUC_THE_MOI_COT.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <span className="whitespace-nowrap">
        / {tong} {tenDonVi}
      </span>
    </div>
  );
}
