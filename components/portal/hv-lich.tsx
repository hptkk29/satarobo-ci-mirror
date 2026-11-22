"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { HvDauTrang, HvLuoi, HvThe } from "@/components/portal/hv-ui";
import { HvTabs } from "@/components/portal/hv-tabs";
import { NHAN_CHIP, type ChipLich } from "@/lib/portal/hv-lich-thuan";
import type { HvLich } from "@/lib/portal/hv-du-lieu";

// Màn "Lịch học của em" — artifact HV-Lich / M-HV-Lich.
const THU = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

const CHIP_CLS: Record<ChipLich, string> = {
  tiep: "bg-[var(--sr-purple)] text-white",
  "trinh-bay": "bg-[var(--sr-tint-orange)] text-[var(--sr-orange-text)]",
  sap: "border border-border bg-card text-muted-foreground",
  "co-mat": "bg-[var(--sr-success-bg)] text-[var(--sr-success)]",
  vang: "bg-[var(--sr-tint-orange)] text-foreground",
  "da-bu": "bg-[var(--sr-success-bg)] text-[var(--sr-success)]",
  "chua-cham": "border border-border bg-card text-muted-foreground",
};

function oCls(kieu: string, homNay: boolean, trongThang: boolean): string {
  if (!trongThang) return "bg-transparent text-[var(--sr-dash)]";
  if (kieu === "xong") return "bg-[var(--sr-orange)] font-bold text-[var(--sr-on-orange)]";
  if (kieu === "tiep") return "bg-[var(--sr-purple)] font-bold text-white";
  if (kieu === "sap") return "bg-card font-bold text-[var(--sr-purple-text)] shadow-[inset_0_0_0_2px_var(--sr-purple)]";
  if (homNay) return "bg-[var(--sr-dash)] font-bold text-[var(--sr-on-orange)]";
  return "bg-transparent text-foreground";
}

export function HvLichTrang({ d }: { d: HvLich }) {
  const [chon, setChon] = useState<string | null>(null);
  const [tab, setTab] = useState<"toi" | "xong">("toi");
  const ct = chon ? d.chiTiet[chon] : undefined;
  const ds = tab === "toi" ? d.sapToi : d.daHoc;
  const q = (x: { y: number; m0: number }) => `/portal/hoc-sinh/lich?y=${x.y}&m=${x.m0}`;

  return (
    <>
      <HvDauTrang
        nhan={[d.tenKhoa, d.tenLop].filter(Boolean).join(" · ").toUpperCase() || undefined}
        tieuDe="Lịch học của em"
        phu={d.dongLich ?? undefined}
        phai={
          d.tiepNhan ? (
            <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-semibold">
              <span aria-hidden="true" className="size-2.5 rounded-full bg-[var(--sr-orange)]" />
              Buổi tiếp theo: {d.tiepNhan}
            </span>
          ) : undefined
        }
      />
      <HvLuoi>
        <HvThe aria-labelledby="thang">
          <div className="flex items-center justify-between gap-2">
            <h2 id="thang" className="m-0 text-xl font-bold">
              Tháng {d.m0 + 1} / {d.y}
            </h2>
            <span className="flex items-center gap-1">
              <Link
                href={q(d.truoc)}
                scroll={false}
                aria-label="Tháng trước"
                className="grid size-9 place-items-center rounded-[10px] border border-border text-lg text-muted-foreground no-underline hover:bg-muted"
              >
                ‹
              </Link>
              <Link
                href={q(d.sau)}
                scroll={false}
                aria-label="Tháng sau"
                className="grid size-9 place-items-center rounded-[10px] border border-border text-lg text-muted-foreground no-underline hover:bg-muted"
              >
                ›
              </Link>
            </span>
          </div>
          <span className="-mt-2 text-[13px] text-muted-foreground">Bấm một ngày có buổi học</span>
          <div aria-hidden="true" className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-muted-foreground">
            {THU.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {d.o.map((o) => {
              const coBuoi = !!d.chiTiet[o.key] && o.trongThang;
              const cls = cn(
                "relative flex h-[46px] items-center justify-center rounded-xl text-[15px]",
                oCls(o.kieu, o.homNay, o.trongThang),
                chon === o.key && "outline outline-[3px] outline-offset-2 outline-foreground",
              );
              return coBuoi ? (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={chon === o.key}
                  aria-label={`Ngày ${o.ngay}, buổi ${d.chiTiet[o.key]?.n}`}
                  onClick={() => setChon(chon === o.key ? null : o.key)}
                  className={cls}
                >
                  {o.ngay}
                </button>
              ) : (
                <span key={o.key} className={cls}>
                  {o.ngay}
                </span>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3.5 text-[13px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-3 rounded-full bg-[var(--sr-orange)]" />
              Đã học
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-3 rounded-full bg-[var(--sr-purple)]" />
              Buổi tiếp theo
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="box-border size-3 rounded-full border-2 border-[var(--sr-purple)]" />
              Sắp tới
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-3 rounded-full bg-[var(--sr-dash)]" />
              Hôm nay
            </span>
          </div>
          {ct && (
            <div className="flex flex-col gap-1 rounded-2xl bg-[var(--sr-tint-purple)] p-3.5">
              <div className="text-xs font-bold text-[var(--sr-purple-text)]">{ct.nhanNgay}</div>
              <b className="break-words text-base">
                Buổi {ct.n} · {ct.ten ?? "Chưa có tên bài"}
              </b>
              <span className="text-[13px] text-muted-foreground">{ct.ghi}</span>
            </div>
          )}
        </HvThe>

        <HvThe aria-labelledby="ds">
          <HvTabs
            nhan="Danh sách buổi"
            muc={[
              { id: "toi", ten: "Sắp tới" },
              { id: "xong", ten: "Đã học" },
            ]}
            gia={tab}
            doi={setTab}
            cao={40}
          />
          <h2 id="ds" className="m-0 text-lg font-bold">
            {ds.length === 0 ? (tab === "toi" ? "Chưa có buổi sắp tới" : "Chưa có buổi nào đã học") : tab === "toi" ? `${ds.length} buổi tới` : `${ds.length} buổi gần nhất`}
          </h2>
          <div className="flex flex-col">
            {ds.map((b) => (
              <div
                key={b.id}
                className={cn(
                  "flex items-center gap-3 px-2 py-2.5",
                  b.tiep ? "rounded-xl bg-[var(--sr-tint-purple)]" : "border-b border-border",
                )}
              >
                <span
                  className={cn(
                    "grid size-[38px] shrink-0 place-items-center rounded-full text-sm font-bold",
                    b.tiep
                      ? "bg-[var(--sr-purple)] text-white"
                      : tab === "xong"
                        ? b.chip === "vang"
                          ? "bg-[var(--sr-tint-orange)] text-foreground"
                          : b.chip === "chua-cham"
                            ? "border-2 border-border bg-card text-muted-foreground"
                            : "bg-[var(--sr-orange)] text-[var(--sr-on-orange)]"
                        : "border-2 border-border bg-card text-muted-foreground",
                  )}
                >
                  {b.n}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cn("break-words text-[15px]", b.ten ? "font-bold" : "font-medium text-muted-foreground")}>
                    {b.ten ?? "Chưa có tên bài"}
                  </span>
                  <span className="text-[13px] text-muted-foreground">{b.ngay}</span>
                </span>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-bold", CHIP_CLS[b.chip])}>{NHAN_CHIP[b.chip]}</span>
              </div>
            ))}
          </div>
          {d.soBuoiVang > 0 && (
            <div className="flex gap-3 rounded-2xl border border-dashed border-[var(--sr-orange)] bg-background p-3.5">
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--sr-tint-orange)] font-extrabold">
                !
              </span>
              <span className="text-sm leading-[21px]">
                Em vắng {d.soBuoiVang} buổi. Ba mẹ đang xếp lịch học bù với trung tâm — có lịch là em thấy ngay ở đây.
              </span>
            </div>
          )}
        </HvThe>
      </HvLuoi>
    </>
  );
}
