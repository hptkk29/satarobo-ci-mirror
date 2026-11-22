import Link from "next/link";

import { cn } from "@/lib/utils";
import type { ManTheCapVM } from "@/lib/disc/so-gia-dinh/man-hinh";

import { ChipMuc, DiscNav, KHUNG, LOP_MUC, NUT_CAM, NUT_VIEN, TieuDeDisc } from "./chung";

/** Tab «Thẻ cặp» — board Disc-cap.dc.html. Hàng = người hành động, cột = người nhận. Chọn ô bằng liên kết (URL giữ trạng thái, không cần JS). */

export function ManTheCap({ vm }: { vm: ManTheCapVM }) {
  if (vm.khoa) {
    return (
      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-[22px]">
        <DiscNav dang="the-cap" />
        <TieuDeDisc kicker="Tầng 2 · Thẻ cặp hai chiều" tieuDe="Cư xử với nhau thế nào cho hợp" />
        <section className="flex flex-col items-start gap-2.5 rounded-[20px] border-2 border-dashed border-border bg-card p-7">
          <b className="text-lg">Thẻ cặp chưa mở</b>
          <span className="text-sm leading-[21px] text-[var(--sr-ink-muted)]">{vm.khoa}</span>
          <Link href="/portal/disc/lam-bai" className={cn(NUT_CAM, "h-11 rounded-xl px-4 text-sm")}>Làm bài cho người thân</Link>
        </section>
      </div>
    );
  }
  const { the, muc } = vm;
  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-[22px]">
      <DiscNav dang="the-cap" />
      <TieuDeDisc
        kicker={`Tầng 2 · ${vm.soThe} thẻ chiều · A → B khác B → A${vm.nhap ? " · bản nháp" : ""}`}
        tieuDe="Cư xử với nhau thế nào cho hợp"
        phu="Hàng là người hành động, cột là người nhận. Bấm một ô để mở thẻ."
      />

      <section aria-label="Kết quả đang dùng" className="flex flex-wrap items-center gap-2 rounded-[14px] bg-[var(--sr-tint-purple)] px-4 py-3 text-[13px]">
        <b>Thẻ dùng lần làm mới nhất của mỗi người:</b>
        {vm.dangDung.map((d) => (
          <Link key={d.id} href={`/portal/disc?muc=ca-nhan&nguoi=${encodeURIComponent(d.id)}`} className="rounded-full bg-card px-2.5 py-1 text-xs text-foreground no-underline">
            <b>{d.ten}</b> · {d.lan}
          </Link>
        ))}
        <span className="text-[var(--sr-ink-muted)]">Ai làm lại bài thì thẻ có người đó tự tính lại.</span>
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <section aria-label="Ma trận thẻ cặp" className={cn(KHUNG, "flex min-w-0 flex-[1_1_420px] flex-col gap-3 rounded-[20px] p-5")}>
          <div className="disc-cuon-ngang overflow-x-auto">
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `minmax(72px,auto) repeat(${vm.nguoi.length}, minmax(76px,1fr))` }}>
              <span className="self-end text-[11px] text-[var(--sr-ink-muted)]">A ↓ · B →</span>
              {vm.nguoi.map((h) => (
                <b key={h.id} className="truncate px-1 text-center text-xs" title={h.ten}>{h.ten}</b>
              ))}
              {vm.hang.map((r) => (
                <div key={r.id} className="contents">
                  <b className="flex items-center truncate pr-1 text-xs" title={r.ten}>{r.ten}</b>
                  {r.o.map((o, i) =>
                    o ? (
                      <Link
                        key={o.bId}
                        href={o.href}
                        aria-label={o.aria}
                        aria-current={vm.chon && vm.chon.aId === o.aId && vm.chon.bId === o.bId ? "true" : undefined}
                        className={cn(
                          "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-1 py-1.5 text-center no-underline",
                          LOP_MUC[o.muc].chip,
                          vm.chon && vm.chon.aId === o.aId && vm.chon.bId === o.bId ? cn("border-foreground") : "border-transparent",
                        )}
                      >
                        <span className="text-[10px] opacity-80">{o.t1}</span>
                        <b className="text-xs">{o.t2}</b>
                      </Link>
                    ) : (
                      <span key={`${r.id}-${i}`} aria-hidden className="flex min-h-14 items-center justify-center rounded-xl bg-[var(--sr-soft-off)] text-[var(--sr-soft-off-ink)]">—</span>
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-[var(--sr-ink-muted)]">
            {(["cao", "trung-binh", "thap"] as const).map((m) => (
              <span key={m} className="inline-flex items-center gap-1.5">
                <span className={cn("size-3 rounded", LOP_MUC[m].thanh)} />
                {m === "cao" ? "Va chạm cao" : m === "trung-binh" ? "Trung bình" : "Thấp"}
              </span>
            ))}
          </div>
        </section>

        <article className={cn(KHUNG, "flex min-w-0 flex-[1_1_440px] flex-col gap-3.5 rounded-[20px] p-[22px]")}>
          {the && muc ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--sr-ink-muted)]">Thẻ chiều · {muc.nhanQuanHe}</span>
                  <h2 className="m-0 font-display text-2xl font-extrabold">{the.toiTen} → {the.kiaTen}</h2>
                </div>
                <ChipMuc muc={muc.muc}>{`${muc.nhan} · ${muc.T}`}</ChipMuc>
              </div>
              {muc.mu ? <div className="rounded-xl bg-[var(--sr-tint-orange)] px-3.5 py-2.5 text-sm"><b>Điểm mù chung:</b> {muc.mu}</div> : null}
              {the.khacPhienBan ? <div className="rounded-xl bg-[var(--sr-soft-off)] px-3.5 py-2.5 text-[13px]">Hai bạn được đo bằng hai phiên bản câu hỏi khác nhau — vẫn so được hai người khác nhau, nhưng đừng đọc chênh lệch quá chi li.</div> : null}
              {the.toiUocLuong || the.kiaUocLuong ? <div className="rounded-xl bg-[var(--sr-soft-off)] px-3.5 py-2.5 text-[13px]">{[the.toiUocLuong ? the.toiTen : null, the.kiaUocLuong ? the.kiaTen : null].filter(Boolean).join(" và ")}: hồ sơ ước lượng qua mắt chủ sổ — dùng giọng «có xu hướng».</div> : null}

              {the.lech.map((k) => (
                <section key={k.truc} className="flex flex-col gap-2.5 border-t border-border pt-3.5">
                  <b className="text-[15px]">{k.truc} · {k.tenTruc}</b>
                  <p className="m-0 text-sm leading-[22px]"><b>Dễ va chạm ở:</b> {k.veToi}</p>
                  <p className="m-0 text-sm leading-[22px]">{k.veNguoiKia}</p>
                  <div className="flex flex-col gap-1.5 rounded-[14px] bg-[var(--sr-success-bg)] p-3.5">
                    <b className="text-sm">{the.toiTen} nên làm với {the.kiaTen}</b>
                    <span className="text-sm leading-[22px]">{k.viecCuaToi}</span>
                  </div>
                  <div className="flex flex-col gap-1.5 rounded-[14px] bg-[var(--sr-tint-purple)] p-3.5">
                    <b className="text-sm">Thoả thuận hai tuần cho cả hai</b>
                    <span className="text-sm leading-[22px]">{k.thoaThuan}</span>
                  </div>
                </section>
              ))}
              {the.lech.length === 0 && the.trungKhop.length > 0 ? (
                <section className="flex flex-col gap-2 border-t border-border pt-3.5">
                  <b className="text-[15px]">Hai bạn khá cùng nhịp</b>
                  {the.trungKhop.map((k) => (
                    <p key={k.truc} className="m-0 text-sm leading-[22px]"><b>{k.truc} · {k.tenTruc}:</b> {k.chu}</p>
                  ))}
                </section>
              ) : null}

              <div className="flex flex-wrap gap-2.5 pt-1">
                {vm.daoChieuHref ? <Link href={vm.daoChieuHref} className={cn(NUT_VIEN, "h-10")}>Xem chiều ngược lại</Link> : null}
                <Link href="/portal/disc?muc=ke-hoach" className={cn(NUT_CAM, "h-10")}>Việc tuần này cho cặp này</Link>
              </div>
            </>
          ) : (
            <span className="text-sm text-[var(--sr-ink-muted)]">Chọn một ô trong ma trận để mở thẻ.</span>
          )}
        </article>
      </div>
      <div className="rounded-[14px] bg-[var(--sr-tint-purple)] px-4 py-3 text-[13px] leading-5">DISC mô tả xu hướng hành vi, không phải đánh giá tâm lý hay tính cách cố định.</div>
    </div>
  );
}
