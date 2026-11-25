"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

// Bước hiện tại của luồng nhiều bước (Kích hoạt / Quên mật khẩu / Nhận kết quả DISC). Trang (server) dựng thẻ + thanh bước,
// biểu mẫu (client) báo bước đang ở đâu qua ngữ cảnh này. Markup thanh bước CHÉP từ artifact (`.stepper > .st.(cur|done) > .bar > i`).
type Buoc = 1 | 2 | 3;
type BuocCtx = { buoc: Buoc; datBuoc: (b: Buoc) => void };
const Ctx = createContext<BuocCtx>({ buoc: 1, datBuoc: () => undefined });

export function BuocProvider({ children }: { children: ReactNode }) {
  const [buoc, datBuoc] = useState<Buoc>(1);
  const v = useMemo(() => ({ buoc, datBuoc }), [buoc]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useBuoc(): BuocCtx {
  return useContext(Ctx);
}

export function ThanhBuoc({ nhan, ten }: { nhan: readonly [string, string, string]; ten: string }) {
  const { buoc } = useBuoc();
  return (
    <div className="stepper" aria-label={ten}>
      {nhan.map((n, i) => {
        const so = (i + 1) as Buoc;
        return (
          <div key={n} className={buoc > so ? "st done" : buoc === so ? "st cur" : "st"}>
            <span className="bar">
              <i></i>
            </span>
            {i + 1}. {n}
          </div>
        );
      })}
    </div>
  );
}
