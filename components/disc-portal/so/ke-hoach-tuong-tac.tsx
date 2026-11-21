"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { camOnViecAction, luuCheckinAction, taoKeHoachAction, tickViecAction } from "@/app/(portal)/portal/disc/_actions-so";
import { cn } from "@/lib/utils";
import type { ManCheckinVM } from "@/lib/disc/so-gia-dinh/man-hinh-ke-hoach";
import type { ViecVM } from "@/lib/disc/so-gia-dinh/man-hinh-ke-hoach";

import { NUT_CAM, NUT_VIEN } from "./chung";

/** Phần có trạng thái của màn Kế hoạch: tick việc · cảm ơn · tạo kế hoạch · check-in. Mọi nút gọi Server Action thật; lỗi hiện tại chỗ. */

export function NutViec({ v }: { v: ViecVM }) {
  const router = useRouter();
  const [dang, batDau] = useTransition();
  const [loi, setLoi] = useState<string | null>(null);
  const chay = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    batDau(async () => {
      setLoi(null);
      const r = await fn();
      if (!r.ok) setLoi(r.error ?? "Chưa thực hiện được.");
      else router.refresh();
    });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {v.xong ? (
          <span className="inline-flex min-h-10 items-center rounded-[10px] bg-[var(--sr-success-bg)] px-3.5 text-[13px] font-bold text-[var(--sr-success)]">✓ Đã làm</span>
        ) : (
          <button
            type="button"
            aria-pressed={false}
            disabled={dang || !v.cho.tick}
            onClick={() => chay(() => tickViecAction({ viecId: v.id }))}
            className={cn(NUT_CAM, "disabled:cursor-not-allowed disabled:opacity-50")}
          >
            {dang ? "Đang lưu…" : "Đánh dấu đã làm"}
          </button>
        )}
        {v.coCamOn ? (
          <button
            type="button"
            aria-pressed={v.camOn}
            disabled={dang || v.camOn}
            onClick={() => chay(() => camOnViecAction({ viecId: v.id }))}
            className={cn(NUT_VIEN, "disabled:cursor-default disabled:opacity-70")}
          >
            {v.camOn ? `❤ ${v.tenNguoiNhan ?? "Người nhận"} đã cảm ơn` : `❤ ${v.tenNguoiNhan ?? "Người nhận"} cảm ơn`}
          </button>
        ) : null}
      </div>
      {!v.xong && v.cho.lyDoKhong ? <span className="text-xs text-[var(--sr-ink-muted)]">{v.cho.lyDoKhong}</span> : null}
      {loi ? <span role="alert" className="text-xs text-[var(--sr-bad-ink)]">{loi}</span> : null}
    </div>
  );
}

export function TaoKeHoachForm({ ky, nhanKy, macDinh, soViec }: { ky: "NGAY_7" | "THANG_1" | "NAM_1"; nhanKy: string; macDinh: string; soViec: string }) {
  const router = useRouter();
  const [ngay, setNgay] = useState(macDinh);
  const [loi, setLoi] = useState<string | null>(null);
  const [dang, batDau] = useTransition();
  return (
    <section className="flex flex-col gap-3 rounded-[20px] border-2 border-dashed border-border bg-card p-6">
      <b className="text-lg">Chưa có kế hoạch {nhanKy}</b>
      <span className="text-sm leading-[21px] text-[var(--sr-ink-muted)]">{soViec}</span>
      <label className="flex max-w-xs flex-col gap-1.5 text-sm">
        <span className="font-semibold">Ngày bắt đầu</span>
        <input
          type="date"
          value={ngay}
          min={macDinh}
          onChange={(e) => setNgay(e.target.value)}
          className="h-11 rounded-xl border border-border bg-background px-3 text-foreground"
        />
      </label>
      {loi ? <span role="alert" className="text-sm text-[var(--sr-bad-ink)]">{loi}</span> : null}
      <button
        type="button"
        disabled={dang || !/^\d{4}-\d{2}-\d{2}$/.test(ngay)}
        onClick={() =>
          batDau(async () => {
            setLoi(null);
            const r = await taoKeHoachAction({ ky, batDau: ngay });
            if (!r.ok) setLoi(r.error);
            else router.refresh();
          })
        }
        className={cn(NUT_CAM, "h-11 self-start rounded-xl px-4 text-sm disabled:opacity-60")}
      >
        {dang ? "Đang tạo…" : `Tạo kế hoạch ${nhanKy}`}
      </button>
    </section>
  );
}

export function CheckinForm({ c, tenTuan }: { c: ManCheckinVM; tenTuan: string }) {
  const router = useRouter();
  const [diem, setDiem] = useState<Record<string, number>>(() => Object.fromEntries(c.nguoi.filter((n) => n.diem !== null).map((n) => [n.id, n.diem as number])));
  const [cap, setCap] = useState<string | null>(() => c.caps.find((x) => x.chon)?.nhan ?? null);
  const [kq, setKq] = useState<{ lyDo: readonly string[]; soViecTuan: number; doKho: number } | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [dang, batDau] = useTransition();
  const chonCap = c.caps.find((x) => x.nhan === cap) ?? null;
  const du = c.nguoi.every((n) => diem[n.id] !== undefined);
  return (
    <section className="flex flex-col gap-4 rounded-[20px] border border-border bg-card p-[22px]">
      <h2 className="m-0 text-xl font-bold">{tenTuan}</h2>
      <b className="text-base">Tuần này nhà mình hoà thuận thế nào?</b>
      {c.nguoi.map((n) => (
        <div key={n.id} className="flex flex-wrap items-center gap-3">
          <span className="min-w-24 flex-[1_1_120px] text-sm font-semibold">{n.ten}</span>
          <div role="radiogroup" aria-label={`Điểm hoà thuận của ${n.ten}`} className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={diem[n.id] === o}
                onClick={() => setDiem((d) => ({ ...d, [n.id]: o }))}
                className={cn("size-11 rounded-xl border text-sm font-bold", diem[n.id] === o ? "border-transparent bg-[var(--sr-purple)] text-white" : "border-border bg-card text-foreground hover:bg-[var(--sr-soft-off)]")}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      ))}
      <span className="text-xs text-[var(--sr-ink-muted)]">1 = căng thẳng · 5 = rất hoà thuận. Bé nhỏ thì chủ sổ chấm hộ.</span>
      {c.caps.length > 0 ? (
        <>
          <b className="text-base">Cặp nào tuần này dễ chịu hơn?</b>
          <div className="flex flex-wrap gap-2">
            {c.caps.map((x) => (
              <button key={x.nhan} type="button" aria-pressed={cap === x.nhan} onClick={() => setCap(cap === x.nhan ? null : x.nhan)} className={cn("min-h-10 rounded-full border px-3.5 text-[13px] font-semibold", cap === x.nhan ? "border-transparent bg-[var(--sr-purple)] text-white" : "border-border bg-card")}>
                {x.nhan}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <span className="rounded-xl bg-[var(--sr-soft-off)] px-3.5 py-2.5 text-xs leading-[18px]">Cần hỗ trợ khẩn về an toàn của trẻ: gọi Tổng đài quốc gia bảo vệ trẻ em 111 (miễn phí).</span>
      {loi ? <span role="alert" className="text-sm text-[var(--sr-bad-ink)]">{loi}</span> : null}
      {kq ? (
        <div role="status" className="flex flex-col gap-1 rounded-xl bg-[var(--sr-success-bg)] px-3.5 py-2.5 text-sm">
          <b>Đã lưu check-in. Kế hoạch tuần sau: {kq.soViecTuan} việc/tuần, độ khó {kq.doKho}.</b>
          {kq.lyDo.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        disabled={!du || dang}
        onClick={() =>
          batDau(async () => {
            setLoi(null);
            const ids = chonCap ? ([chonCap.a, chonCap.b] as [string, string]) : null;
            const r = await luuCheckinAction({
              keHoachId: c.keHoachId,
              tuan: c.tuan,
              diem: c.nguoi.map((n) => ({ thanhVienId: n.id, diem: diem[n.id] as number })),
              capDeChiu: ids,
            });
            if (!r.ok) setLoi(r.error);
            else {
              setKq({ lyDo: r.lyDo, soViecTuan: r.soViecTuan, doKho: r.doKho });
              router.refresh();
            }
          })
        }
        className={cn(NUT_CAM, "h-11 self-start rounded-xl px-4 text-sm disabled:opacity-50")}
      >
        {dang ? "Đang lưu…" : "Lưu check-in"}
      </button>
      {!du ? <span className="text-xs text-[var(--sr-ink-muted)]">Chấm điểm cho đủ mọi người rồi lưu.</span> : null}
    </section>
  );
}
