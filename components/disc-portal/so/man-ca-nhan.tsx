import Link from "next/link";

import { cn } from "@/lib/utils";
import { NHAN_TRUC } from "@/lib/disc/so-gia-dinh/kieu";
import type { ManCaNhanVM } from "@/lib/disc/so-gia-dinh/man-hinh";

import { XoaLanLam } from "./xoa-lan-lam";
import { DiscNav, H2, KHUNG, MAU_TRUC, NHAN_NHO, NUT_CAM, NUT_VIEN, TieuDeDisc } from "./chung";

/** Tab «Cá nhân» — board Disc-chi-tiet.dc.html. Chữ lời khuyên lấy NGUYÊN từ engine (`layDienGiaiDay`); khối không có dữ liệu thì không vẽ. */

type Ban = "day-du" | "con" | "bome";

function Cot({ vm }: { vm: ManCaNhanVM }) {
  return (
    <section aria-labelledby="h-m1" className={cn(KHUNG, "flex flex-col gap-3 rounded-[20px] p-[22px]")}>
      <h2 id="h-m1" className={NHAN_NHO}>1 · Biểu đồ 4 nhóm</h2>
      <div className="grid h-40 grid-cols-4 items-end gap-3">
        {vm.cot.map((c) => (
          <div key={c.k} className="flex h-full flex-col items-center justify-end gap-1.5">
            <b className="text-sm">{c.v}</b>
            <div className={cn("w-full max-w-16 rounded-t-lg", MAU_TRUC[c.k].dac)} style={{ height: `${Math.max(3, c.v)}%` }} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-3 text-center">
        {vm.cot.map((c) => (
          <div key={c.k} className="flex flex-col">
            <b className={cn("text-sm", MAU_TRUC[c.k].chu)}>{c.k}</b>
            <span className="text-xs text-[var(--sr-ink-muted)]">{c.ten}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2.5 rounded-xl bg-[var(--sr-soft-off)] px-3.5 py-2.5">
        <b className="text-base">{vm.nhan}</b>
        <span className="text-[13px] text-[var(--sr-ink-muted)]">Cường độ: {vm.cuongDo} · Nhịp độ {String(vm.pace).replace(".", ",")} · Trọng tâm {String(vm.focus).replace(".", ",")}</span>
      </div>
    </section>
  );
}

function SoSanh({ vm }: { vm: ManCaNhanVM }) {
  if (!vm.soSanh) return null;
  return (
    <section className={cn(KHUNG, "flex flex-col gap-2.5 rounded-[20px] p-5")}>
      <div className="flex flex-col gap-0.5">
        <b className="text-base">So với cả nhà</b>
        <span className="text-xs text-[var(--sr-ink-muted)]">Cột màu: {vm.ten} · vạch đen: trung bình cả nhà</span>
      </div>
      {vm.soSanh.map((r) => (
        <div key={r.k} className="grid grid-cols-[28px_1fr_auto] items-center gap-2.5">
          <b className="text-sm">{r.k}</b>
          <div className="relative h-2.5 rounded-full bg-[var(--sr-bar-off)]">
            <div className={cn("h-full rounded-full", MAU_TRUC[r.k].dac)} style={{ width: `${Math.max(2, r.v)}%` }} />
            <div className="absolute -top-1 h-[18px] w-0.5 bg-[var(--disc-net-vien)]" style={{ left: `${r.tb}%` }} />
          </div>
          <span className="text-[13px]"><b>{r.v}</b> <span className="text-[var(--sr-ink-muted)]">{r.ch}</span></span>
        </div>
      ))}
      {vm.soSanhGhi ? <span className="text-xs text-[var(--sr-ink-muted)]">{vm.soSanhGhi}</span> : null}
    </section>
  );
}

function ViTri({ vm }: { vm: ManCaNhanVM }) {
  const k = (v: number) => Math.round(v);
  const x = k(10 + ((vm.viTri.x - 20) / 360) * 220);
  const y = k(10 + ((vm.viTri.y - 20) / 360) * 220);
  return (
    <section className={cn(KHUNG, "flex flex-col gap-2.5 rounded-[20px] p-5")}>
      <div className="flex flex-col gap-0.5">
        <b className="text-base">Vị trí trên bản đồ gia đình</b>
        <span className="text-xs text-[var(--sr-ink-muted)]">Trục dọc: nhịp độ nhanh ↔ chậm · trục ngang: việc ↔ người</span>
      </div>
      <svg role="img" aria-label={`${vm.ten} nằm ở nhóm ${vm.chinh} trên bản đồ`} viewBox="0 0 240 240" className="mx-auto h-auto w-full max-w-[260px]">
        <rect x="10" y="10" width="110" height="110" fill="var(--disc-nen-ban-do-d)" />
        <rect x="120" y="10" width="110" height="110" fill="var(--disc-nen-ban-do-i)" />
        <rect x="120" y="120" width="110" height="110" fill="var(--disc-nen-ban-do-s)" />
        <rect x="10" y="120" width="110" height="110" fill="var(--disc-nen-ban-do-c)" />
        <line x1="120" y1="10" x2="120" y2="230" stroke="var(--disc-luoi)" />
        <line x1="10" y1="120" x2="230" y2="120" stroke="var(--disc-luoi)" />
        <g fontSize="12" fontWeight="700">
          <text x="16" y="26" className="fill-[var(--disc-d)]">D</text>
          <text x="216" y="26" className="fill-[var(--disc-i)]">I</text>
          <text x="216" y="224" className="fill-[var(--disc-s)]">S</text>
          <text x="16" y="224" className="fill-[var(--disc-c)]">C</text>
        </g>
        <circle cx={x} cy={y} r="14" strokeWidth="2" strokeDasharray={vm.uocLuong ? "4 3" : undefined} className={cn("stroke-[var(--disc-net-vien)]", { D: "fill-[var(--disc-d)]", I: "fill-[var(--disc-i)]", S: "fill-[var(--disc-s)]", C: "fill-[var(--disc-c)]" }[vm.chinh])} />
      </svg>
    </section>
  );
}

function Khoi({ tieu, children }: { tieu: string; children: React.ReactNode }) {
  return (
    <article className={cn(KHUNG, "flex flex-col gap-2 rounded-[20px] p-5")}>
      <span className={NHAN_NHO}>{tieu}</span>
      <div className="flex flex-col gap-2 text-sm leading-[22px]">{children}</div>
    </article>
  );
}

function DanhSach({ muc, dau }: { muc: readonly string[]; dau: string }) {
  return (
    <>
      {muc.map((m) => (
        <span key={m} className="flex gap-2"><span aria-hidden className="flex-none font-bold">{dau}</span><span>{m}</span></span>
      ))}
    </>
  );
}

export function ManCaNhan({
  vm,
  nguoi,
  ban,
}: {
  vm: ManCaNhanVM;
  nguoi: readonly { id: string; ten: string; coHoSo: boolean }[];
  ban: Ban;
}) {
  const { dg } = vm;
  const coBanCon = dg.banCon !== undefined;
  const coBanBoMe = dg.banBoMe !== undefined;
  const hienBan: Ban = ban === "con" && coBanCon ? "con" : ban === "bome" && coBanBoMe ? "bome" : coBanCon && coBanBoMe ? "bome" : coBanCon ? "con" : "day-du";
  const urlNguoi = (id: string, b?: Ban) => `/portal/disc?muc=ca-nhan&nguoi=${encodeURIComponent(id)}${b ? `&ban=${b}` : ""}`;

  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-[22px]">
      <DiscNav dang="ca-nhan" />
      <TieuDeDisc
        kicker={`Tầng 1 · Báo cáo cá nhân · bạn đang xem với tư cách chủ sổ`}
        tieuDe={vm.tieuDe}
        phu={vm.meta}
        phai={
          <div role="tablist" aria-label="Chọn người" className="disc-cuon-ngang flex max-w-full gap-1.5 overflow-x-auto rounded-[14px] bg-[var(--sr-tint-purple)] p-1">
            {nguoi.map((n) =>
              n.coHoSo ? (
                <Link key={n.id} role="tab" aria-selected={n.id === vm.id} href={urlNguoi(n.id)} className={cn("inline-flex h-10 flex-none items-center rounded-[10px] px-3.5 text-sm no-underline", n.id === vm.id ? "bg-card font-bold text-foreground shadow-[0_1px_2px_var(--sr-shadow)]" : "font-semibold text-[var(--sr-ink-muted)]")}>
                  {n.ten}
                </Link>
              ) : null,
            )}
          </div>
        }
      />

      {coBanCon && coBanBoMe ? (
        <div role="tablist" aria-label="Bản xem" className="flex gap-1.5 self-start rounded-[14px] bg-[var(--sr-tint-purple)] p-1">
          {([["con", "Bản cho con"], ["bome", "Dành cho bố mẹ"]] as const).map(([k, nhan]) => (
            <Link key={k} role="tab" aria-selected={hienBan === k} href={urlNguoi(vm.id, k)} className={cn("inline-flex h-10 items-center rounded-[10px] px-3.5 text-sm no-underline", hienBan === k ? "bg-card font-bold shadow-[0_1px_2px_var(--sr-shadow)]" : "font-semibold text-[var(--sr-ink-muted)]")}>
              {nhan}
            </Link>
          ))}
        </div>
      ) : null}

      {hienBan === "con" && dg.banCon ? (
        <>
          <section className="flex items-center gap-4 rounded-[22px] bg-[linear-gradient(120deg,var(--sr-purple)_0%,var(--sr-purple-mid)_55%,var(--sr-orange)_140%)] p-6 text-white">
            <span aria-hidden className="text-5xl">🤖</span>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-xs font-bold tracking-[0.08em] text-[var(--sr-hero-eyebrow)]">{vm.ten.toUpperCase()} LÀ</span>
              <span className="font-display text-[26px] font-extrabold">{vm.nhanVat}</span>
              <span className="text-sm leading-[21px]">{vm.motDong}</span>
            </div>
          </section>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
            {([["Khi quá tải", dg.banCon.khiCangThang], ["Thử tập thêm", dg.banCon.tapThem], ["Một việc tối nay", dg.banCon.motViecToiNay]] as const).map(([t, n]) => (
              <div key={t} className={cn(KHUNG, "flex flex-col gap-1.5 p-4")}><b className="text-[15px]">{t}</b><span className="text-sm leading-[21px]">{n}</span></div>
            ))}
          </div>
        </>
      ) : hienBan === "bome" && dg.banBoMe ? (
        <section className={cn(KHUNG, "flex flex-col gap-3.5 rounded-[20px] p-[22px]")}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={H2}>Dành cho bố mẹ đọc về {vm.ten}</h2>
            <span className="rounded-full bg-[var(--sr-tint-purple)] px-2.5 py-[3px] text-xs font-bold text-[var(--sr-purple-text)]">Chỉ chủ sổ thấy</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
            {([["Nói thế nào", dg.banBoMe.noiTheNao], ["Khi quá tải", dg.banBoMe.khiCangThang], ["Kỹ năng thêm cho con", dg.banBoMe.kyNangThem], ["Điều bố mẹ tự chỉnh", dg.banBoMe.boMeChinh], ["Cùng học thế nào", dg.banBoMe.cungHocTheNao], ["Một việc tối nay", dg.banBoMe.motViecToiNay]] as const).map(([t, n]) => (
              <div key={t} className="flex flex-col gap-1 rounded-[14px] bg-[var(--sr-soft-off)] p-3.5"><span className="text-xs font-bold text-[var(--sr-ink-muted)]">{t}</span><span className="text-sm leading-[21px]">{n}</span></div>
            ))}
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
            <div className="flex flex-col gap-1.5"><b className="text-sm text-[var(--sr-success)]">Câu nên nói</b><DanhSach muc={dg.banBoMe.cauNenNoi} dau="✓" /></div>
            <div className="flex flex-col gap-1.5"><b className="text-sm text-[var(--sr-bad-ink)]">Câu nên tránh</b><DanhSach muc={dg.banBoMe.cauNenTranh} dau="✕" /></div>
          </div>
        </section>
      ) : null}

      {hienBan !== "con" ? (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-5">
            <Cot vm={vm} />
            <section className="flex flex-col gap-4">
              <Khoi tieu="2 · Tóm tắt">{dg.trongNhuTheNao}</Khoi>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-4">
                <Khoi tieu="3 · Điểm mạnh trong nhà">{dg.diemManh}</Khoi>
                <Khoi tieu="4 · Cần để ý">{dg.choCanDeY}</Khoi>
              </div>
            </section>
          </div>
          {dg.pha ? (
            <Khoi tieu={`Hồ sơ pha · ${dg.pha.tieuDeNgan}`}>
              <b>{dg.pha.tieuDe}</b>
              {dg.pha.than}
            </Khoi>
          ) : null}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-5">
            <SoSanh vm={vm} />
            <ViTri vm={vm} />
          </div>
          {dg.banTuMinh ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-4">
              <Khoi tieu="5 · Khi căng thẳng">{dg.banTuMinh.khiCangThang}</Khoi>
              <Khoi tieu="6 · Thử tập thêm">{dg.banTuMinh.tapThem}</Khoi>
              <Khoi tieu="7 · Một việc tối nay">{dg.banTuMinh.motViecToiNay}</Khoi>
            </div>
          ) : null}
        </>
      ) : null}

      <section aria-labelledby="h-ls" className={cn(KHUNG, "flex flex-col gap-3 rounded-[20px] p-[22px]")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id="h-ls" className={H2}>Các lần làm của {vm.ten}</h2>
            <span className="text-xs text-[var(--sr-ink-muted)]">
              Báo cáo này và thẻ cặp đang dùng <b>{vm.lichSu.find((l) => l.dangDung)?.lan ?? "—"}</b>
              {vm.han ? ` · hạn làm lại ${vm.han.ngayDen}${vm.han.denHan ? " (đã đến hạn)" : ""}` : ""}
            </span>
          </div>
          <Link href={`/portal/disc/lam-bai?nguoi=${encodeURIComponent(vm.id)}`} className={cn(NUT_VIEN, "h-10")}>Làm lại bài</Link>
        </div>
        {vm.lichSu.map((x) => (
          <div key={x.id} className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-[14px] border p-3", x.dangDung ? "border-[var(--sr-success)] bg-[var(--sr-success-bg)]" : "border-border bg-card")}>
            <span className="flex min-w-0 flex-[1_1_200px] flex-col"><b className="text-sm">{x.lan} · {x.ngay}</b><span className="text-xs text-[var(--sr-ink-muted)]">{x.kieu}</span></span>
            <span className="flex min-w-0 flex-[2_1_260px] flex-col"><span className="text-[13px]">{x.diem}</span><span className="text-xs text-[var(--sr-ink-muted)]">{x.nhan} · {x.chenh}</span></span>
            <span className={cn("flex-none rounded-full px-2.5 py-[3px] text-[11px] font-bold", x.dangDung ? "bg-[var(--sr-success-bg)] text-[var(--sr-success)]" : "bg-[var(--sr-soft-off)] text-[var(--sr-ink-muted)]")}>{x.ghiDangDung}</span>
            <XoaLanLam baiId={x.id} lan={x.lan} />
          </div>
        ))}
        <span className="text-xs text-[var(--sr-ink-muted)]">Mỗi lần làm được lưu riêng. Lần tự làm mới nhất luôn là lần đang dùng; chỉ so trực tiếp hai lần cùng bộ câu hỏi.</span>
      </section>

      <section aria-labelledby="h-4n" className="flex flex-col gap-3">
        <h2 id="h-4n" className={H2}>Bốn nhóm trong {vm.ten}</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
          {dg.phoBonNhom.map((t) => (
            <div key={t.truc} className={cn("flex flex-col gap-1.5 rounded-2xl p-4", MAU_TRUC[t.truc].nhat)}>
              <b className="text-sm">{t.truc} · {NHAN_TRUC[t.truc]}</b>
              <span className="text-[13px] leading-5">{t.bieuHien}</span>
              <span className="text-[13px] leading-5">{t.than}</span>
              {t.choCanDeY ? <span className="text-[13px] leading-5"><b>Cần để ý:</b> {t.choCanDeY}</span> : null}
              {t.mucDoRo ? <span className="text-[13px] leading-5">{t.mucDoRo}</span> : null}
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--sr-ink-muted)]">
        <span>DISC mô tả xu hướng hành vi, không phải đánh giá tâm lý hay tính cách cố định.</span>
        <Link href="/portal/disc?muc=the-cap" className={cn(NUT_CAM, "h-10")}>Thẻ cặp có {vm.ten} →</Link>
      </div>
    </div>
  );
}
