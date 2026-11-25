import Link from "next/link";

import { cn } from "@/lib/utils";
import { NHAN_KY } from "@/lib/disc/so-gia-dinh/ke-hoach";
import type { ManKeHoachVM, TabKeHoach, ViecVM } from "@/lib/disc/so-gia-dinh/man-hinh-ke-hoach";

import { DiscNav, H2, KHUNG, NUT_CAM, OTron, TieuDeDisc } from "./chung";
import { CheckinForm, NutViec, TaoKeHoachForm } from "./ke-hoach-tuong-tac";

/** Tab «Kế hoạch» — board Disc-ke-hoach.dc.html. Việc lấy từ bảng của engine; tick/cảm ơn/check-in ghi DB thật. */

const duongTab = (tab: TabKeHoach, them = "") => `/portal/disc?muc=ke-hoach&ky=${tab}${them}`;

function ThanhTab({ vm }: { vm: ManKeHoachVM }) {
  return (
    <div role="tablist" aria-label="Kỳ kế hoạch" className="disc-cuon-ngang flex max-w-full gap-1.5 overflow-x-auto rounded-[14px] bg-[var(--sr-tint-purple)] p-1">
      {vm.tabs.map((t) => (
        <Link
          key={t.tab}
          role="tab"
          aria-selected={vm.tab === t.tab}
          href={duongTab(t.tab)}
          className={cn(
            "inline-flex h-10 flex-none items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3.5 text-sm no-underline",
            vm.tab === t.tab ? "bg-card font-bold text-foreground shadow-[0_1px_2px_var(--sr-shadow)]" : "font-semibold text-[var(--sr-ink-muted)]",
          )}
        >
          {t.nhan}
          {!t.mo ? <span aria-label="chưa mở" className="text-[11px]">🔒</span> : null}
        </Link>
      ))}
    </div>
  );
}

function Hero({ h }: { h: NonNullable<ManKeHoachVM["hero"]> }) {
  const chuvi = 2 * Math.PI * 46;
  return (
    <section aria-label="Tuần này" className="flex flex-wrap items-center gap-5 rounded-[22px] bg-[linear-gradient(120deg,var(--sr-purple)_0%,var(--sr-purple-mid)_55%,var(--sr-orange)_140%)] p-6 text-white">
      <div className="relative size-28 flex-none">
        <svg aria-hidden width="112" height="112" viewBox="0 0 112 112">
          <circle cx="56" cy="56" r="46" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="12" />
          <circle cx="56" cy="56" r="46" fill="none" stroke="var(--sr-orange)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(h.tile / 100) * chuvi} ${chuvi}`} transform="rotate(-90 56 56)" />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center"><b className="font-display text-[26px]">{h.tile}%</b><span className="text-[11px] opacity-85">tuần này</span></span>
      </div>
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-hero-eyebrow)]">Tuần {h.tuan}{h.chuDeTuan ? ` · chủ đề ${h.chuDeTuan.toLowerCase()}` : ""}</span>
        <b className="font-display text-xl leading-7">Đã làm {h.daLam} / {h.tong} việc{h.chuoi > 0 ? ` · chuỗi ${h.chuoi} ngày liên tiếp` : ""}</b>
      </div>
      <div className="grid w-full grid-cols-2 gap-2.5 min-[560px]:w-auto min-[560px]:grid-cols-4">
        {h.huyHieu.map((n) => (
          <div key={n.ten} className="flex min-w-[88px] flex-col rounded-[14px] bg-white/15 px-3 py-2.5"><span className="text-[11px] opacity-85">{n.ten}</span><b className="text-lg">{n.v}</b></div>
        ))}
      </div>
    </section>
  );
}

function TheViec({ v }: { v: ViecVM }) {
  return (
    <article className={cn("flex flex-col gap-2.5 rounded-2xl border p-4", v.xong ? "border-[var(--sr-success)] bg-[var(--sr-success-bg)]/40" : "border-border bg-card")}>
      <div className="flex items-center gap-2.5">
        <OTron chu={v.chu} chinh={null} kich={36} mo />
        <span className="flex min-w-0 flex-1 flex-col"><b className="break-words text-sm">{v.huong}</b><span className="text-xs text-[var(--sr-ink-muted)]">{v.meta}</span></span>
        <span className="flex-none rounded-full bg-[var(--sr-tint-purple)] px-2.5 py-[3px] text-xs font-bold text-[var(--sr-purple-text)]">{v.phut} phút</span>
      </div>
      <p className="m-0 text-[15px] leading-[23px]">{v.noiDung}</p>
      <NutViec v={v} />
    </article>
  );
}

export function ManKeHoach({ vm, tenGiaDinh, snapTen }: { vm: ManKeHoachVM; tenGiaDinh: string; snapTen: string | null }) {
  const kh = vm.keHoach;
  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-[22px]">
      <DiscNav dang="ke-hoach" />
      <TieuDeDisc
        kicker={`Tầng 4 · ${tenGiaDinh}${kh ? ` · bắt đầu ${kh.batDauHien}` : ""}${snapTen ? ` · ${snapTen}` : ""}`}
        tieuDe="Nhà mình gần nhau hơn mỗi ngày"
        phu="Mỗi ngày một việc nhỏ dưới 10 phút cho người thân, mỗi cuối tuần một hoạt động cả nhà — chọn theo phong cách của từng người."
      />

      {vm.hero ? <Hero h={vm.hero} /> : null}
      <ThanhTab vm={vm} />

      {vm.capNhat ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-[var(--sr-success-bg)] px-4 py-3.5 text-sm">
          <span className="flex-[1_1_320px]"><b>{vm.capNhat}</b> Kế hoạch đang chạy không bị đổi giữa chừng — bạn chọn có tạo kế hoạch mới theo kết quả này hay không.</span>
        </div>
      ) : null}

      {vm.lyKhoa ? (
        <section className="flex flex-col items-start gap-2.5 rounded-[20px] border-2 border-dashed border-border bg-card p-7">
          <b className="text-lg">Kế hoạch {NHAN_KY[vm.tab as keyof typeof NHAN_KY] ?? ""} chưa mở</b>
          <span className="text-sm leading-[21px] text-[var(--sr-ink-muted)]">{vm.lyKhoa}</span>
          <Link href="/portal/disc/lam-bai" className={cn(NUT_CAM, "h-11 rounded-xl px-4 text-sm")}>Làm bài cho người thân</Link>
        </section>
      ) : null}

      {vm.canTaoMoi ? (
        <TaoKeHoachForm
          ky={vm.canTaoMoi.ky}
          nhanKy={NHAN_KY[vm.canTaoMoi.ky]}
          macDinh={vm.canTaoMoi.macDinh}
          soViec={
            vm.canTaoMoi.ky === "NGAY_7"
              ? "Mỗi người một việc nhỏ mỗi ngày (ngày 1–5), ngày 6 hoạt động chung, ngày 7 họp nhà 20 phút. Việc lấy từ chỗ vênh giữa hai người."
              : vm.canTaoMoi.ky === "THANG_1"
                ? "Bốn nghi thức mỗi tuần, thoả thuận hai tuần cho hai cặp cần chú ý nhất, và việc theo tuần cho từng cặp."
                : "Bốn quý, mỗi quý một chủ đề; mỗi tháng một ngày gia đình do lần lượt từng người lên kế hoạch; mốc làm lại bài."
          }
        />
      ) : null}

      {vm.tab === "NGAY_7" && kh && vm.ngayChon ? (
        <>
          <div role="tablist" aria-label="Chọn ngày" className="disc-cuon-ngang flex gap-2 overflow-x-auto">
            {vm.ngays.map((d) => {
              const chon = d.n === vm.ngayChon!.n;
              const xongHet = d.tong > 0 && d.xong === d.tong;
              return (
                <Link
                  key={d.n}
                  role="tab"
                  aria-selected={chon}
                  href={duongTab("NGAY_7", `&ngay=${d.n}`)}
                  className={cn("flex min-w-16 flex-none flex-col items-center gap-0.5 rounded-[14px] border px-3 py-2 no-underline", chon ? "border-transparent bg-[var(--sr-purple)] text-white" : "border-border bg-card text-foreground")}
                >
                  <span className="text-[11px] opacity-80">{d.thu}</span>
                  <b className="text-base">{d.n}</b>
                  <span aria-hidden className="text-[11px]">{xongHet ? "✓" : d.homNay ? "•" : " "}</span>
                </Link>
              );
            })}
          </div>
          <section className={cn(KHUNG, "flex flex-col gap-3.5 rounded-[20px] p-[22px]")}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className={H2}>Ngày {vm.ngayChon.n} · {vm.ngayChon.thu} {vm.ngayChon.ngay}</h2>
              <span className="text-xs text-[var(--sr-ink-muted)]">{vm.ngayChon.xong}/{vm.ngayChon.tong} việc đã làm</span>
            </div>
            {vm.viecNgay.length === 0 ? (
              <span className="text-sm text-[var(--sr-ink-muted)]">Ngày này không có việc.</span>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-3">
                {vm.viecNgay.map((v) => (
                  <TheViec key={v.id} v={v} />
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      {vm.tab === "THANG_1" && kh ? (
        <>
          <div role="tablist" aria-label="Chọn tuần" className="disc-cuon-ngang flex gap-2 overflow-x-auto">
            {vm.tuans.map((w) => (
              <Link
                key={w.n}
                role="tab"
                aria-selected={w.n === vm.tuanChon}
                href={duongTab("THANG_1", `&tuan=${w.n}`)}
                className={cn("flex min-w-24 flex-none flex-col rounded-[14px] border px-3.5 py-2 no-underline", w.n === vm.tuanChon ? "border-transparent bg-[var(--sr-purple)] text-white" : "border-border bg-card text-foreground")}
              >
                <b className="text-sm">Tuần {w.n}</b>
                <span className="text-xs opacity-80">{w.chu}</span>
              </Link>
            ))}
          </div>
          <section className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-3">
            {vm.viecTuan.length === 0 ? <span className="text-sm text-[var(--sr-ink-muted)]">Tuần này chưa có việc.</span> : vm.viecTuan.map((v) => <TheViec key={v.id} v={v} />)}
          </section>
        </>
      ) : null}

      {vm.tab === "NAM_1" && kh ? (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))] gap-3">
            {vm.quy.map((q) => (
              <article key={q.quy} className={cn(KHUNG, "flex flex-col gap-1.5 rounded-2xl p-[18px]")}>
                <span className="text-xs font-bold tracking-[0.06em] text-[var(--sr-ink-muted)]">QUÝ {q.quy}</span>
                <b className="text-[17px]">{q.chuDe}</b>
                <span className="text-sm leading-[21px]">{q.mucTieu}</span>
                <span className="text-[13px] leading-5 text-[var(--sr-ink-muted)]"><b>Mốc:</b> {q.moc}</span>
              </article>
            ))}
          </div>
          <section className={cn(KHUNG, "flex flex-col gap-3 rounded-[20px] p-[22px]")}>
            <h2 className={H2}>Ngày gia đình mỗi tháng — lần lượt từng người lên kế hoạch</h2>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
              {vm.ngayGiaDinh.map((v) => (
                <TheViec key={v.id} v={v} />
              ))}
            </div>
          </section>
          {vm.moc.length > 0 ? (
            <section className={cn(KHUNG, "flex flex-col gap-3 rounded-[20px] p-[22px]")}>
              <h2 className={H2}>Mốc trong năm</h2>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
                {vm.moc.map((v) => (
                  <TheViec key={v.id} v={v} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {vm.tab === "HOAT_DONG" ? (
        <section className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-3">
          {vm.hoatDong.map((h) => (
            <article key={h.id} className={cn(KHUNG, "flex flex-col gap-1.5 rounded-2xl p-4")}>
              <span className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--sr-ink-muted)]">{h.loai}</span>
              <b className="text-[15px]">{h.moTa}</b>
              {h.diaDiem ? <span className="text-[13px] text-[var(--sr-ink-muted)]">📍 {h.diaDiem.ten} — {h.diaDiem.diaChi}</span> : null}
              <span className="text-[13px] text-[var(--sr-ink-muted)]">🕒 {h.phut} phút{h.chiPhi ? ` · 💰 ${h.chiPhi}` : ""}</span>
            </article>
          ))}
          <span className="col-span-full text-xs text-[var(--sr-ink-muted)]">Địa chỉ, giờ mở cửa và giá vé là thông tin tham khảo do trung tâm biên tập và kiểm tra định kỳ — hãy kiểm lại trước khi đi.</span>
        </section>
      ) : null}

      {vm.tab === "CHECKIN" ? (
        vm.checkin ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-[var(--sr-ink-muted)]">Kế hoạch:</span>
              {vm.tabs.filter((t) => t.tab !== "CHECKIN" && t.tab !== "HOAT_DONG" && t.coKeHoach).map((t) => (
                <Link key={t.tab} href={`/portal/disc?muc=ke-hoach&ky=CHECKIN&plan=${t.tab}`} className={cn("rounded-full border px-3 py-1 no-underline", vm.checkin!.ky === t.tab ? "border-transparent bg-[var(--sr-purple)] text-white" : "border-border bg-card text-foreground")}>{t.nhan}</Link>
              ))}
              <span className="text-[var(--sr-ink-muted)]">· Tuần</span>
              {Array.from({ length: vm.checkin.soTuan }, (_, i) => i + 1).map((t) => (
                <Link key={t} href={`/portal/disc?muc=ke-hoach&ky=CHECKIN&plan=${vm.checkin!.ky}&tuan=${t}`} className={cn("rounded-full border px-3 py-1 no-underline", vm.checkin!.tuan === t ? "border-transparent bg-[var(--sr-purple)] text-white" : "border-border bg-card text-foreground")}>{t}</Link>
              ))}
            </div>
            <CheckinForm key={`${vm.checkin.keHoachId}-${vm.checkin.tuan}`} c={vm.checkin} tenTuan={`Check-in tuần ${vm.checkin.tuan}`} />
          </>
        ) : (
          <section className="rounded-[20px] border-2 border-dashed border-border bg-card p-7 text-sm text-[var(--sr-ink-muted)]">Chưa có kế hoạch đang chạy để check-in. Hãy tạo kế hoạch ở các tab trên.</section>
        )
      ) : null}

      <section className={cn(KHUNG, "flex flex-col gap-2.5 rounded-[20px] p-[22px]")}>
        <h2 className={H2}>Kế hoạch tự điều chỉnh</h2>
        {vm.luat.map((l) => (
          <div key={l.tt} className="flex items-start gap-3">
            <span className="mt-0.5 flex-none rounded-full bg-[var(--sr-tint-purple)] px-2.5 py-[3px] text-xs font-bold text-[var(--sr-purple-text)]">{l.tt}</span>
            <span className="text-sm leading-[21px]">{l.t}</span>
          </div>
        ))}
        {kh ? <span className="text-xs text-[var(--sr-ink-muted)]">Hiện tại: {kh.soViecTuan} việc/tuần · độ khó {kh.doKho}.</span> : null}
      </section>
    </div>
  );
}
