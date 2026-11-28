"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { danhDauDaDocHocSinhAction } from "@/app/(portal)/portal/hoc-sinh/actions";
import { demTinMoi, laTinMoi, locTin, nhanChuaDoc, nhanThoiGian, type LocTin, type TinHv } from "@/lib/portal/hv-thong-bao-thuan";

// Màn "Tin mới cho em" — artifact HV-Thong-bao / M-HV-Thong-bao. Tin chỉ dựng từ việc học của em; "đã đọc" là mốc riêng của em
// (cookie trên máy này), KHÔNG đụng chuông thông báo của ba mẹ.

const SAC: Record<TinHv["sac"], string> = {
  xanh: "bg-[var(--sr-success-bg)] text-[var(--sr-success)]",
  cam: "bg-[var(--sr-tint-orange)] text-[var(--sr-orange-text)]",
  tim: "bg-[var(--sr-tint-purple)] text-[var(--sr-purple-text)]",
  nen: "bg-background text-foreground",
};

export function HvThongBaoTrang({ tin, moc, bayGio, boLoc }: { tin: TinHv[]; moc: number | null; bayGio: number; boLoc: { id: LocTin; ten: string }[] }) {
  const router = useRouter();
  const [loc, setLoc] = useState<LocTin>("tat");
  const [dang, bat] = useTransition();
  const bay = new Date(bayGio);
  const soMoi = demTinMoi(tin, moc, bay);
  const ds = locTin(tin, loc);

  const docHet = () =>
    bat(async () => {
      await danhDauDaDocHocSinhAction();
      router.refresh();
    });

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-display text-[26px] font-extrabold leading-8 min-[900px]:text-[32px] min-[900px]:leading-[38px]">Tin mới cho em</h1>
          <div className="text-[15px] text-muted-foreground">{nhanChuaDoc(soMoi)}</div>
        </div>
        {soMoi > 0 && (
          <button
            type="button"
            onClick={docHet}
            disabled={dang}
            className="h-[42px] rounded-xl border border-border bg-card px-4 text-sm font-bold text-foreground disabled:opacity-60"
          >
            Đánh dấu đã đọc hết
          </button>
        )}
      </header>

      <div role="tablist" aria-label="Lọc tin" className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {boLoc.map((l) => {
          const on = l.id === loc;
          return (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setLoc(l.id)}
              className={cn(
                "h-10 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-semibold",
                on ? "border-[var(--sr-purple)] bg-[var(--sr-purple)] text-white" : "border-border bg-card text-foreground",
              )}
            >
              {l.ten}
            </button>
          );
        })}
      </div>

      <section className="flex max-w-[860px] flex-col rounded-[22px] border border-border bg-card p-2">
        {ds.map((t) => {
          const moi = laTinMoi(t.luc, moc, bay);
          return (
            <Link key={t.id} href={t.href} className={cn("flex items-center gap-3.5 rounded-2xl p-3.5 text-foreground no-underline", moi && "bg-background")}>
              <span aria-hidden="true" className={cn("grid size-11 shrink-0 place-items-center rounded-[14px] text-[17px] font-extrabold", SAC[t.sac])}>
                {t.ky}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className={cn("break-words text-[15px] leading-[21px]", moi ? "font-bold" : "font-medium")}>{t.ten}</span>
                <span className="text-[13px] text-muted-foreground">{nhanThoiGian(t.luc, bay)}</span>
              </span>
              {moi && <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-[var(--sr-orange)]" />}
            </Link>
          );
        })}
        {ds.length === 0 && <div className="p-8 text-center text-[15px] text-muted-foreground">Chưa có tin nào ở mục này.</div>}
      </section>
    </>
  );
}
