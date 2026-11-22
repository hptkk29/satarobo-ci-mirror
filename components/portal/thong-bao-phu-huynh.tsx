"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { NotificationFeed } from "@/lib/portal/notification-feed";
import {
  NUT_THONG_BAO,
  O_VUONG,
  TAB_THONG_BAO,
  gomNhom,
  loc,
  nhanGio,
  type KieuO,
  type TabThongBao,
} from "@/lib/portal/thong-bao-thuan";

// Cổng phụ huynh — "Thông báo", dựng theo artifact Thong-bao.dc.html.
// KHÔNG vẽ: nút "Đánh dấu đã đọc hết" (mở trang đã là đọc — `DanhDauDaDoc`) và khung "Ba mẹ muốn nhận qua đâu?" (chưa có nơi lưu
// lựa chọn kênh nhận thông báo; vẽ công tắc không ghi đi đâu là lời hứa suông).

const MAU_O: Record<KieuO, string> = {
  hoc: "bg-[var(--sr-tint-purple)] text-[var(--sr-purple-text)]",
  lich: "bg-[var(--sr-purple)] text-white",
  bu: "bg-[var(--sr-tint-orange)] text-[var(--sr-ink)]",
  phi: "bg-[var(--sr-success-bg)] text-[var(--sr-success)]",
};

export function ThongBaoPhuHuynh({ feed, nowISO }: { feed: NotificationFeed; nowISO: string }) {
  const [tab, setTab] = useState<TabThongBao>("tat-ca");
  const now = new Date(nowISO);
  const nhom = gomNhom(loc(feed.items, tab), now);

  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-orange-text)]">
          {feed.unreadTotal > 0 ? `${feed.unreadTotal} CHƯA ĐỌC` : "ĐÃ ĐỌC HẾT"}
        </div>
        <h1 className="font-display text-[28px] font-extrabold leading-[34px] min-[560px]:text-[32px] min-[560px]:leading-[38px]">Thông báo</h1>
      </header>

      <div role="tablist" aria-label="Lọc thông báo" className="flex flex-wrap gap-2">
        {TAB_THONG_BAO.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "h-10 rounded-full px-4 text-sm",
              tab === t.id ? "bg-[var(--sr-purple)] font-semibold text-white" : "border border-border bg-card font-medium",
            )}
          >
            {t.nhan}
          </button>
        ))}
      </div>

      <section className="flex max-w-[860px] flex-col gap-5">
        {nhom.length === 0 ? (
          <div className="rounded-[18px] border-2 border-dashed border-border px-4 py-7 text-center text-sm text-[var(--sr-ink-muted)]">
            Không có thông báo nào trong mục này.
          </div>
        ) : (
          nhom.map((g) => (
            <div key={g.ten} className="flex flex-col gap-2.5">
              <h2 className="text-[13px] font-bold tracking-[0.08em] text-[var(--sr-ink-muted)]">{g.ten}</h2>
              <div className="overflow-hidden rounded-[18px] border border-border bg-card">
                {g.items.map((n) => {
                  const o = O_VUONG[n.category];
                  const nut = NUT_THONG_BAO[n.category];
                  return (
                    <article
                      key={n.id}
                      className={cn(
                        "flex flex-wrap items-center gap-3.5 border-b border-border px-[18px] py-4 last:border-b-0",
                        n.read ? "" : "bg-background",
                      )}
                    >
                      <span aria-hidden="true" className={cn("flex size-11 flex-none items-center justify-center rounded-xl text-[11px] font-bold", MAU_O[o.kieu])}>
                        {o.chu}
                      </span>
                      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] font-bold">{n.title}</span>
                          {n.read ? null : <span role="img" aria-label="Chưa đọc" className="size-2 rounded-full bg-[var(--sr-orange)]" />}
                        </div>
                        <div className="whitespace-pre-line text-sm leading-[21px]">{n.body}</div>
                        <div className="text-xs text-[var(--sr-ink-muted)]">
                          {n.childName ? `${n.childName} · ` : ""}
                          {nhanGio(n.at, now)}
                        </div>
                      </div>
                      {nut ? (
                        <Link
                          href={nut.href}
                          className="flex h-10 flex-none items-center rounded-[10px] border border-border px-3.5 text-[13px] font-semibold hover:bg-[var(--sr-tint-purple)]"
                        >
                          {nut.nhan}
                        </Link>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
