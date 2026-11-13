"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { HvDauTrang, HvLuoi, HvThe } from "@/components/portal/hv-ui";
import { Ic } from "@/components/portal/hv-icon";
import { dinhDangSoCoin } from "@/lib/portal/hv-dieu-huong";
import { moTaChang, type Chang, type HocPhanBanDo, type HuyHieu, type KyNang } from "@/lib/portal/hv-hanh-trinh-thuan";
import { nhanThoiGian } from "@/lib/portal/hv-thong-bao-thuan";

// Màn "Hành trình & huy hiệu" — artifact HV-Hanh-trinh / M-HV-Hanh-trinh.
// KHÔNG vẽ: "Đổi quà" (chưa có danh mục quà / luồng đổi), "Cách nhận coin" (chưa có luật tự cộng coin khi nộp bài),
// 4 huy hiệu thiếu dữ liệu (xem lib/portal/hv-hanh-trinh-thuan.ts).

type Du = {
  ten: string;
  tenKhoa: string | null;
  soHocPhan: number;
  soChang: number;
  xong: number;
  pct: number;
  banDo: HocPhanBanDo[];
  changMo: number;
  huyHieu: HuyHieu[];
  huyHieuDa: number;
  kyNang: KyNang[];
  /** Số dư SataCoin; `null` = mục «SataCoin» tạm ẩn (04/11/2026) ⇒ không vẽ thẻ «SataCoin của em». */
  coin: number | null;
  giaoDich: { id: string; ten: string; luc: string; so: number }[];
};

function ngChang(c: Chang, chon: boolean): string {
  const co = {
    xong: "bg-[var(--sr-orange)] text-[var(--sr-on-orange)]",
    vang: "bg-[var(--sr-tint-orange)] text-foreground shadow-[inset_0_0_0_2px_var(--sr-orange)]",
    sau: "bg-[var(--sr-purple)] text-white",
    toi: "bg-card text-muted-foreground shadow-[inset_0_0_0_2px_var(--border)]",
    "chua-cham": "bg-card text-muted-foreground shadow-[inset_0_0_0_2px_var(--sr-orange)]",
  }[c.trangThai];
  return cn("relative flex h-11 items-center justify-center rounded-xl text-sm font-bold", co, chon && "outline outline-[3px] outline-offset-2 outline-foreground");
}

export function HvHanhTrinhTrang({ d }: { d: Du }) {
  const [chonN, setChonN] = useState(d.changMo);
  const tat = d.banDo.flatMap((h) => h.chang);
  const chon = tat.find((c) => c.n === chonN) ?? tat[0];
  const mt = chon ? moTaChang(chon) : null;
  const bay = new Date();

  return (
    <>
      <HvDauTrang
        nhan={[d.tenKhoa, `${d.soHocPhan} HỌC PHẦN`, `${d.soChang} BUỔI`].filter(Boolean).join(" · ").toUpperCase()}
        tieuDe={`Hành trình của ${d.ten}`}
        phu="Mỗi buổi là một chặng. Bấm vào chặng bất kỳ để xem em đã làm gì."
      />

      <HvThe aria-labelledby="ban-do" className="gap-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 id="ban-do" className="m-0 text-xl font-bold">
            Bản đồ {d.soChang} chặng
          </h2>
          <span className="text-sm text-muted-foreground">
            <b className="text-foreground">{d.xong}</b> / {d.soChang} chặng · {d.pct}%
          </span>
        </div>
        {d.banDo.length === 0 ? (
          <p className="m-0 text-[15px] text-muted-foreground">Khoá học của em chưa có lộ trình. Có lịch là bản đồ hiện ra ở đây.</p>
        ) : (
          d.banDo.map((h) => (
            <div key={h.so} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <b className={cn("text-[15px]", h.chip === "Chưa mở" && "text-muted-foreground")}>{h.ten}</b>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-bold",
                    h.chip === "Hoàn thành" && "bg-[var(--sr-success-bg)] text-[var(--sr-success)]",
                    h.chip === "Em đang ở đây" && "bg-[var(--sr-purple)] text-white",
                    h.chip === "Chưa mở" && "border border-border text-muted-foreground",
                  )}
                >
                  {h.chip}
                </span>
              </div>
              <div className="grid grid-cols-6 gap-1.5 min-[600px]:grid-cols-12">
                {h.chang.map((c) => (
                  <button
                    key={c.n}
                    type="button"
                    aria-label={`Chặng ${c.n}${c.demo ? " (demo)" : ""}`}
                    aria-pressed={c.n === chonN}
                    onClick={() => setChonN(c.n)}
                    className={ngChang(c, c.n === chonN)}
                  >
                    {c.demo ? "★" : c.n}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
        <div className="flex flex-wrap gap-3.5 text-[13px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-3 rounded bg-[var(--sr-orange)]" />
            Đã học
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-3 rounded bg-[var(--sr-tint-orange)] shadow-[inset_0_0_0_2px_var(--sr-orange)]" />
            Vắng · sẽ học bù
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-3 rounded bg-[var(--sr-purple)]" />
            Chặng tiếp theo
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-3 rounded bg-card shadow-[inset_0_0_0_2px_var(--border)]" />
            Chưa tới
          </span>
          <span className="flex items-center gap-1.5">
            <b aria-hidden="true" className="text-[var(--sr-orange-text)]">★</b>
            Buổi demo · em trình bày
          </span>
        </div>
        {chon && mt && (
          <div className="flex flex-wrap items-center gap-3.5 rounded-2xl bg-[var(--sr-tint-purple)] p-4">
            <span
              className={cn(
                "grid size-[52px] shrink-0 place-items-center rounded-2xl text-xl font-extrabold",
                chon.trangThai === "xong" && "bg-[var(--sr-orange)] text-[var(--sr-on-orange)]",
                chon.trangThai === "sau" && "bg-[var(--sr-purple)] text-white",
                chon.trangThai === "vang" && "bg-[var(--sr-tint-orange)] text-foreground",
                (chon.trangThai === "toi" || chon.trangThai === "chua-cham") && "bg-card text-muted-foreground",
              )}
            >
              {chon.n}
            </span>
            <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-[3px]">
              <div className="text-xs font-bold text-[var(--sr-purple-text)]">{mt.nhan}</div>
              <b className={cn("break-words text-[17px]", chon.ten === null && "font-medium text-muted-foreground")}>{chon.ten ?? "Chưa có tên bài"}</b>
              <span className="text-sm leading-[21px] text-[var(--sr-ink-body)]">{mt.ghi}</span>
            </div>
            {chon.coSanPham && (
              <Link href="/portal/hoc-sinh/san-pham" className="flex h-10 shrink-0 items-center rounded-[10px] bg-card px-3.5 text-sm font-bold text-foreground no-underline">
                Xem sản phẩm buổi này
              </Link>
            )}
          </div>
        )}
      </HvThe>

      <HvLuoi min={360}>
        <HvThe aria-labelledby="huy">
          <div className="flex items-center justify-between">
            <h2 id="huy" className="m-0 text-xl font-bold">
              Huy hiệu
            </h2>
            <span className="text-sm text-muted-foreground">
              <b className="text-foreground">{d.huyHieuDa}</b> / {d.huyHieu.length}
            </span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2.5">
            {d.huyHieu.map((h) => (
              <div
                key={h.ma}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-2xl px-1.5 py-3 text-center",
                  h.da ? "bg-background" : "border border-dashed border-[var(--sr-dash)] bg-card",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-[52px] place-items-center rounded-full",
                    h.da ? "bg-[var(--sr-orange)] text-[var(--sr-on-orange)] shadow-[inset_0_0_0_4px_var(--sr-tint-orange)]" : "bg-[var(--sr-tint-purple)] text-[var(--sr-soft-off-ink)]",
                  )}
                >
                  <Ic d={h.icon} size={26} />
                </span>
                <b className="text-[13px] leading-[17px]">{h.ten}</b>
                <span className={cn("text-[11px] leading-[15px]", h.da ? "font-bold text-[var(--sr-success)]" : "text-muted-foreground")}>
                  {h.da ? "Đã nhận" : h.dieuKien}
                </span>
              </div>
            ))}
          </div>
        </HvThe>

        <HvThe aria-labelledby="ky-nang">
          <h2 id="ky-nang" className="m-0 text-xl font-bold">
            Kỹ năng của em
          </h2>
          <div className="text-[13px] leading-[19px] text-muted-foreground">Theo nhận xét của thầy cô. Thanh càng dài là em càng vững.</div>
          {d.kyNang.length === 0 ? (
            <p className="m-0 rounded-[14px] bg-background p-3 text-sm text-muted-foreground">Thầy cô chưa đánh giá kỹ năng nào. Có đánh giá là hiện ở đây.</p>
          ) : (
            d.kyNang.map((k) => (
              <div key={k.ten} className="flex flex-col gap-1.5">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold">{k.ten}</span>
                  <span className={cn("font-bold", k.sac === "tot" && "text-[var(--sr-success)]", k.sac === "tap" && "text-[var(--sr-orange-text)]")}>{k.chu}</span>
                </div>
                <div aria-hidden="true" className="h-3 overflow-hidden rounded-full bg-[var(--sr-bar-off)]">
                  <div
                    style={{ width: `${k.pct}%` }}
                    className={cn("h-full rounded-full", k.sac === "tot" ? "bg-[var(--sr-success)]" : k.sac === "vua" ? "bg-[var(--sr-orange)]" : "bg-[var(--sr-tint-orange)]")}
                  />
                </div>
              </div>
            ))
          )}
        </HvThe>
      </HvLuoi>

      {d.coin !== null && (
      <HvThe aria-labelledby="coin" className="gap-[18px]">
        <div className="flex flex-wrap items-center gap-4">
          <span
            aria-hidden="true"
            className="grid size-16 shrink-0 place-items-center rounded-full bg-[var(--sr-orange)] font-display text-[28px] font-extrabold text-[var(--sr-on-orange)] shadow-[inset_0_0_0_5px_var(--sr-tint-orange)]"
          >
            S
          </span>
          <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
            <h2 id="coin" className="m-0 text-xl font-bold">
              SataCoin của em
            </h2>
            <span className="text-sm text-muted-foreground">Coin do thầy cô cộng cho em</span>
          </div>
          <b className="font-display text-4xl leading-10">{dinhDangSoCoin(d.coin)}</b>
        </div>
        <div className="flex max-w-[640px] flex-col gap-2.5">
          <div className="text-sm font-bold">Coin gần đây</div>
          {d.giaoDich.length === 0 ? (
            <p className="m-0 rounded-[14px] bg-background p-3 text-sm text-muted-foreground">Em chưa có giao dịch coin nào.</p>
          ) : (
            d.giaoDich.map((l) => (
              <div key={l.id} className="flex items-center gap-3 border-b border-border px-1 py-2.5">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="break-words text-sm font-semibold">{l.ten}</span>
                  <span className="text-xs text-muted-foreground">{nhanThoiGian(l.luc, bay)}</span>
                </span>
                <b className={cn("text-[15px]", l.so > 0 ? "text-[var(--sr-success)]" : "text-[var(--sr-danger)]")}>
                  {l.so > 0 ? "+" : "−"}
                  {Math.abs(l.so)}
                </b>
              </div>
            ))
          )}
        </div>
      </HvThe>
      )}
    </>
  );
}
