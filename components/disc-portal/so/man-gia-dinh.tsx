import Link from "next/link";

import { cn } from "@/lib/utils";
import type { BaoCaoGiaDinhVM, ManGiaDinhVM, TangVM, TheTvVM } from "@/lib/disc/so-gia-dinh/man-hinh";

import { ChipMuc, DiscNav, GhiChuDisc, H2, KHUNG, LOP_MUC, MAU_TRUC, NUT_CAM, NUT_VIEN, OTron, TieuDeDisc } from "./chung";

/** Tab «Gia đình» — dựng theo board Disc.dc.html. Server Component thuần: không hook, không DB. */

const CHIP_TANG: Record<TangVM["trangThai"], string> = {
  mo: "bg-[var(--sr-success-bg)] text-[var(--sr-success)]",
  "mot-phan": "bg-[var(--sr-tint-orange)] text-[var(--sr-orange-text)]",
  nhap: "bg-[var(--sr-tint-orange)] text-[var(--sr-orange-text)]",
  khoa: "bg-[var(--sr-soft-off)] text-[var(--sr-ink-muted)]",
};

function TangThe({ t }: { t: TangVM }) {
  return (
    <Link
      href={t.href}
      className={cn(
        "flex flex-col gap-1.5 rounded-2xl p-4 text-foreground no-underline",
        t.trangThai === "khoa" ? "border border-dashed border-border bg-[var(--sr-soft-off)]" : "border border-border bg-card hover:border-[var(--sr-purple)]",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold tracking-[0.06em] text-[var(--sr-ink-muted)]">TẦNG {t.n}</span>
        <span className={cn("flex-none rounded-full px-2.5 py-[3px] text-xs font-bold", CHIP_TANG[t.trangThai])}>{t.nhanTrangThai}</span>
      </span>
      <span className="text-[17px] font-bold">{t.ten}</span>
      <span className="text-[13px] leading-[19px] text-[var(--sr-ink-muted)]">{t.ghi}</span>
    </Link>
  );
}

const CHIP_TV: Record<TheTvVM["trangThai"], string> = {
  xong: "bg-[var(--sr-success-bg)] text-[var(--sr-success)]",
  uoc: "border border-dashed border-[var(--sr-purple)] bg-card text-[var(--sr-purple-text)]",
  dang: "bg-[var(--sr-tint-orange)] text-[var(--sr-orange-text)]",
  chua: "bg-[var(--sr-soft-off)] text-[var(--sr-ink-muted)]",
};

function TheThanhVien({ m }: { m: TheTvVM }) {
  return (
    <div className={cn(KHUNG, "flex flex-col gap-3 p-4")}>
      <div className="flex items-center gap-3">
        <OTron chu={m.chu} chinh={m.chinh} uocLuong={m.trangThai === "uoc"} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="break-words text-base">{m.ten}</b>
          <span className="text-xs text-[var(--sr-ink-muted)]">{m.phu}</span>
        </span>
        <span className={cn("flex-none rounded-full px-2.5 py-[3px] text-xs font-bold", CHIP_TV[m.trangThai])}>{m.nhanTrangThai}</span>
      </div>
      <div className="text-sm leading-5">{m.hoSo}</div>
      <Link href={m.nut.href} className={m.nut.noiBat ? cn(NUT_CAM, "h-10") : cn(NUT_VIEN, "h-10")}>
        {m.nut.ten}
      </Link>
    </div>
  );
}

function BanDo({ b }: { b: BaoCaoGiaDinhVM["banDo"] }) {
  const mauDay = { cao: "stroke-[var(--disc-cao)]", "trung-binh": "stroke-[var(--disc-tb)]", thap: "stroke-[var(--disc-thap)]" } as const;
  const mauNut = { D: "fill-[var(--disc-d)]", I: "fill-[var(--disc-i)]", S: "fill-[var(--disc-s)]", C: "fill-[var(--disc-c)]" } as const;
  const chuNut = { D: "fill-[var(--disc-d-chu)]", I: "fill-[var(--disc-i-chu)]", S: "fill-[var(--disc-s-chu)]", C: "fill-[var(--disc-c-chu)]" } as const;
  return (
    <svg role="img" aria-label={b.aria} viewBox="0 0 400 400" className="mx-auto h-auto w-full max-w-[520px]">
      <rect x="20" y="20" width="180" height="180" fill="var(--disc-nen-ban-do-d)" />
      <rect x="200" y="20" width="180" height="180" fill="var(--disc-nen-ban-do-i)" />
      <rect x="200" y="200" width="180" height="180" fill="var(--disc-nen-ban-do-s)" />
      <rect x="20" y="200" width="180" height="180" fill="var(--disc-nen-ban-do-c)" />
      <line x1="200" y1="20" x2="200" y2="380" stroke="var(--disc-luoi)" />
      <line x1="20" y1="200" x2="380" y2="200" stroke="var(--disc-luoi)" />
      <g fontSize="13" fontWeight="700">
        <text x="30" y="40" className="fill-[var(--disc-d)]">D</text>
        <text x="362" y="40" className="fill-[var(--disc-i)]">I</text>
        <text x="362" y="372" className="fill-[var(--disc-s)]">S</text>
        <text x="30" y="372" className="fill-[var(--disc-c)]">C</text>
      </g>
      <g fontSize="11" className="fill-[var(--sr-ink-muted)]">
        <text x="200" y="14" textAnchor="middle">Nhanh, chủ động</text>
        <text x="200" y="396" textAnchor="middle">Chậm, thận trọng</text>
        <text x="24" y="196">Việc</text>
        <text x="376" y="196" textAnchor="end">Người</text>
      </g>
      {b.day.map((d, i) => (
        <line key={i} x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} strokeWidth={d.muc === "cao" ? 4 : 2.5} strokeOpacity={0.85} strokeDasharray={d.uocLuong ? "6 4" : undefined} className={mauDay[d.muc]} />
      ))}
      {b.nut.map((n) => (
        <g key={n.id}>
          <circle cx={n.x} cy={n.y} r="20" strokeWidth="2" strokeDasharray={n.uocLuong ? "4 3" : undefined} className={cn(mauNut[n.chinh], "stroke-[var(--disc-net-vien)]")} />
          <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" className={chuNut[n.chinh]}>
            {n.nhan}
          </text>
        </g>
      ))}
      <circle cx={b.giaDinh.x} cy={b.giaDinh.y} r="6" className="fill-[var(--disc-net-vien)]" />
      <text x={b.giaDinh.x} y={b.giaDinh.y + 18} textAnchor="middle" fontSize="10" className="fill-[var(--disc-net-vien)]">
        cả nhà
      </text>
    </svg>
  );
}

function Chu({ children }: { children: string }) {
  return <b className="text-base">{children}</b>;
}

function BaoCaoGiaDinh({ b }: { b: BaoCaoGiaDinhVM }) {
  return (
    <>
      <div className="flex flex-wrap items-stretch gap-5">
        <section aria-labelledby="h-bd" className="flex min-w-0 flex-[1_1_420px] flex-col gap-3 rounded-[20px] border border-border bg-card p-[22px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="h-bd" className={H2}>Bản đồ gia đình</h2>
            {b.nhap ? <span className="rounded-full bg-[var(--sr-tint-orange)] px-2.5 py-[3px] text-xs font-bold text-[var(--sr-orange-text)]">Bản nháp</span> : null}
          </div>
          <BanDo b={b.banDo} />
          <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-[var(--sr-ink-muted)]">
            {(["cao", "trung-binh", "thap"] as const).map((m) => (
              <span key={m} className="inline-flex items-center gap-1.5">
                <span className={cn("h-1 w-4 rounded-full", LOP_MUC[m].thanh)} />
                {m === "cao" ? "Va chạm cao" : m === "trung-binh" ? "Trung bình" : "Thấp"}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="box-border size-3.5 rounded-full border-2 border-dashed border-[var(--disc-net-vien)]" />
              Ước lượng
            </span>
          </div>
        </section>

        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-4">
          <article className="flex flex-col gap-2.5 rounded-[20px] bg-[var(--sr-purple)] p-[22px] text-white">
            <span className="text-xs font-bold tracking-[0.08em] text-[var(--sr-hero-eyebrow)]">KIỂU GIA ĐÌNH</span>
            <span className="font-display text-[26px] font-extrabold">{b.kieu.ten}</span>
            <span className="text-sm leading-[21px]"><b>Điểm mạnh:</b> {b.kieu.manh}</span>
            <span className="text-sm leading-[21px]"><b>Cần để ý:</b> {b.kieu.rui}</span>
          </article>
          <article className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-card p-5">
            <div className="flex items-baseline justify-between gap-2">
              <Chu>Chỉ số cân bằng</Chu>
              <span className="font-display text-[28px] font-extrabold text-[var(--sr-success)]">{b.canBang.v}</span>
            </div>
            <div className="h-2.5 rounded-full bg-[var(--sr-tint-purple)]">
              <div className="h-full rounded-full bg-[var(--sr-success)]" style={{ width: `${b.canBang.v}%` }} />
            </div>
            <span className="text-[13px] leading-[19px] text-[var(--sr-ink-muted)]">Nhà mình {b.canBang.ghi}.</span>
          </article>
          <article className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-card p-5">
            <Chu>Độ phủ 4 nhóm</Chu>
            <div className="grid grid-cols-2 gap-2">
              {b.phu.map((p) => (
                <div key={p.k} className={cn("flex flex-col gap-0.5 rounded-xl px-3 py-2.5", p.co ? MAU_TRUC[p.k].nhat : "border-2 border-dashed border-[var(--sr-bad)] bg-card")}>
                  <b className="text-[13px]">{p.k} · {p.ten}</b>
                  <span className="text-xs">{p.ai}</span>
                </div>
              ))}
            </div>
            <span className="text-[13px] leading-[19px] text-[var(--sr-ink-muted)]">{b.phuGhi}</span>
          </article>
        </div>
      </div>

      <section aria-label="Nhà mình trong một câu" className="flex flex-col gap-3.5 rounded-[22px] bg-[linear-gradient(120deg,var(--sr-purple)_0%,var(--sr-purple-mid)_55%,var(--sr-orange)_140%)] p-6 text-white">
        <span className="text-xs font-bold tracking-[0.08em] text-[var(--sr-hero-eyebrow)]">NHÀ MÌNH TRONG MỘT CÂU</span>
        <b className="font-display text-xl leading-[28px] min-[560px]:text-2xl min-[560px]:leading-8">{b.motCau}</b>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(160px,100%),1fr))] gap-2.5">
          {b.kpi.map((k) => (
            <div key={k.nhan} className="flex flex-col gap-0.5 rounded-[14px] bg-white/15 px-3.5 py-3">
              <span className="text-xs opacity-85">{k.nhan}</span>
              <b className="text-lg">{k.v}</b>
              <span className="text-xs opacity-85">{k.ghi}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-5">
        <section aria-labelledby="h-tb" className={cn(KHUNG, "flex flex-col gap-3.5 rounded-[20px] p-[22px]")}>
          <div className="flex flex-col gap-0.5">
            <h2 id="h-tb" className={H2}>4 nhóm trong nhà mình</h2>
            <span className="text-xs text-[var(--sr-ink-muted)]">Vạch màu là trung bình cả nhà; mỗi chấm là một người.</span>
          </div>
          {b.dotPlot.map((r) => (
            <div key={r.k} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-1 text-sm">
                <b>{r.k} · {r.ten}</b>
                <span className="text-xs text-[var(--sr-ink-muted)]">TB {r.tb} · cao nhất: {r.top}</span>
              </div>
              <div className="relative h-7">
                <div className={cn("absolute left-0 top-2.5 h-2 rounded-full opacity-35", MAU_TRUC[r.k].dac)} style={{ width: `${r.tb}%` }} />
                {r.cham.map((c, i) => (
                  <span
                    key={c.id}
                    title={`${c.ten} ${c.v}`}
                    style={{ left: `calc(${Math.max(0, Math.min(100, c.v))}% - 12px)`, top: 2 + (i % 2) * 2 }}
                    className={cn("absolute box-border flex size-6 items-center justify-center rounded-full border-2 border-card text-[10px] font-extrabold", MAU_TRUC[c.chinh].dac, c.uocLuong && "outline outline-2 outline-dashed outline-[var(--disc-net-vien)]")}
                  >
                    {c.chu}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div className="flex justify-between text-[11px] text-[var(--sr-ink-muted)]">
            <span>0</span>
            <span>60 = có mặt rõ</span>
            <span>100</span>
          </div>
        </section>

        <section aria-labelledby="h-6c" className={cn(KHUNG, "flex flex-col gap-2.5 rounded-[20px] p-[22px]")}>
          <div className="flex flex-col gap-0.5">
            <h2 id="h-6c" className={H2}>Mức va chạm từng cặp</h2>
            <span className="text-xs text-[var(--sr-ink-muted)]">Xếp theo độ ưu tiên (mức va chạm × hệ số quan hệ).</span>
          </div>
          {b.capDs.map((c) => (
            <Link key={c.href} href={c.href} className={cn("flex flex-col gap-1.5 rounded-xl px-3 py-2.5 text-foreground no-underline", c.canChuY && "bg-[var(--sr-tint-orange)]/50")}>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <b className="text-sm">{c.ten} <span className="font-normal text-[var(--sr-ink-muted)]">· {c.kieu} · {c.qh}</span></b>
                <ChipMuc muc={c.muc}>{c.nhanMuc}{c.canChuY ? " · cần chú ý" : ""}</ChipMuc>
              </span>
              <span className="block h-2 rounded-full bg-[var(--sr-bar-off)]">
                <span className={cn("block h-2 rounded-full", LOP_MUC[c.muc].thanh)} style={{ width: `${c.diem}%` }} />
              </span>
            </Link>
          ))}
        </section>
      </div>

      {b.capNong.length > 0 ? (
        <section aria-labelledby="h-nong" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="h-nong" className={H2}>{b.capNong[0]?.canGiu ? "Cặp nên giữ cho vững" : `${b.capNong.length} cặp nên chú ý trước`}</h2>
            <Link href="/portal/disc?muc=the-cap" className="text-sm font-bold text-[var(--sr-purple-text)]">Xem đủ thẻ cặp →</Link>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-3">
            {b.capNong.map((c) => (
              <Link key={c.href} href={c.href} className={cn("flex flex-col gap-2 rounded-[18px] border-2 bg-card p-[18px] text-foreground no-underline", LOP_MUC[c.muc].vien)}>
                <span className="flex items-center justify-between gap-2">
                  <b className="text-base">{c.ten}</b>
                  <ChipMuc muc={c.muc}>{c.nhanMuc}</ChipMuc>
                </span>
                <span className="text-[13px] text-[var(--sr-ink-muted)]">{c.ghi}</span>
                {c.loi.map((l) => (
                  <span key={l} className="text-sm leading-[21px]">{l}</span>
                ))}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="h-vai" className={cn(KHUNG, "flex flex-col gap-3 rounded-[20px] p-[22px]")}>
        <h2 id="h-vai" className={H2}>Vai trò tự nhiên</h2>
        {b.vai.map((v) => (
          <div key={v.id} className="flex items-center gap-3">
            <OTron chu={v.chu} chinh={v.chinh} kich={40} uocLuong={v.uocLuong} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <b className="text-[15px]">{v.ten} · {v.vai}</b>
              <span className="text-[13px] text-[var(--sr-ink-muted)]">{v.gop}</span>
            </span>
          </div>
        ))}
      </section>
    </>
  );
}

export function ManGiaDinh({ vm, capNhat }: { vm: ManGiaDinhVM; capNhat: { chu: string } | null }) {
  const kicker = `${vm.tenGiaDinh} · ${vm.soThanhVien} thành viên${vm.snapTen ? ` · ${vm.snapTen}` : ""}`;
  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-[22px]">
      <DiscNav dang="gia-dinh" />
      <TieuDeDisc
        kicker={kicker}
        tieuDe="Nhà mình hợp nhau thế nào?"
        phu="Mỗi người làm bài theo đúng tuổi. Báo cáo mở dần khi thêm người làm xong, và được tính lại mỗi lần có kết quả mới."
        phai={
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs text-[var(--sr-ink-muted)]">Độ tin cậy của báo cáo</span>
            <span className={cn("rounded-full px-3.5 py-1.5 text-base font-extrabold", vm.tinCayTot ? "bg-[var(--sr-success-bg)] text-[var(--sr-success)]" : "bg-[var(--sr-tint-orange)] text-[var(--sr-orange-text)]")}>{vm.tinCay}%</span>
          </div>
        }
      />
      <GhiChuDisc them="Không có phong cách tốt hay xấu, chỉ có khác biệt và cách bắc cầu." />

      {capNhat ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-[var(--sr-success-bg)] px-4 py-3.5">
          <span className="flex-[1_1_320px] text-sm leading-[21px]"><b>{capNhat.chu}</b> Kế hoạch đang chạy không bị đổi giữa chừng.</span>
          <Link href="/portal/disc?muc=ke-hoach" className="inline-flex h-10 flex-none items-center rounded-[10px] bg-[var(--sr-success)] px-3.5 text-[13px] font-bold text-[var(--sr-success-bg)] no-underline hover:opacity-90">
            Cập nhật kế hoạch theo kết quả mới
          </Link>
        </div>
      ) : null}

      <section aria-labelledby="h-tang" className="flex flex-col gap-3">
        <h2 id="h-tang" className={H2}>Báo cáo đã mở</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-3">
          {vm.tang.map((t) => (
            <TangThe key={t.n} t={t} />
          ))}
        </div>
      </section>

      <section aria-labelledby="h-tv" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="h-tv" className={H2}>Thành viên</h2>
          <Link href="/portal/disc?muc=thanh-vien" className="text-sm font-bold text-[var(--sr-purple-text)]">Thêm thành viên, xem quan hệ →</Link>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))] gap-3">
          {vm.thanhVien.map((m) => (
            <TheThanhVien key={m.id} m={m} />
          ))}
        </div>
      </section>

      {vm.khoaT3.khoa ? (
        <section className="flex flex-col items-start gap-2.5 rounded-[20px] border-2 border-dashed border-border bg-card p-7">
          <b className="text-lg">Bản đồ gia đình chưa mở</b>
          <span className="text-sm leading-[21px] text-[var(--sr-ink-muted)]">{vm.khoaT3.ly}</span>
          <Link href="/portal/disc/lam-bai" className={cn(NUT_CAM, "h-11 rounded-xl px-4 text-sm")}>Làm bài cho người thân</Link>
        </section>
      ) : vm.baoCao ? (
        <BaoCaoGiaDinh b={vm.baoCao} />
      ) : null}

      {vm.han && vm.han.nguoiDenHan.length > 0 ? (
        <section aria-label="Đến hạn làm lại" className="rounded-[14px] border border-border bg-card px-4 py-3 text-sm">
          <b>Đến hạn làm lại bài (sau 6 tháng):</b> {vm.han.nguoiDenHan.map((h) => h.ten).join(", ")}. Làm lại sớm hơn hạn vẫn được — kết quả có thể chưa khác.
        </section>
      ) : null}
    </div>
  );
}
