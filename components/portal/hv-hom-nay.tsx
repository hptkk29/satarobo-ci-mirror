import Link from "next/link";
import { cn } from "@/lib/utils";
import { IC, Ic } from "@/components/portal/hv-icon";
import { Sticker } from "@/components/portal/sticker";
import { HvLuoi, HvThe } from "@/components/portal/hv-ui";
import { dinhDangSoCoin } from "@/lib/portal/hv-dieu-huong";
import { nhanThoiGian } from "@/lib/portal/hv-thong-bao-thuan";
import type { HvHomNay } from "@/lib/portal/hv-du-lieu";

// Màn "Hôm nay" của Cổng học sinh — artifact HV-Hom-nay / M-HV-Hom-nay.
const SAC: Record<string, string> = {
  xanh: "bg-[var(--sr-success-bg)] text-[var(--sr-success)]",
  cam: "bg-[var(--sr-tint-orange)] text-[var(--sr-orange-text)]",
  tim: "bg-[var(--sr-tint-purple)] text-[var(--sr-purple-text)]",
  nen: "bg-background text-foreground",
};

export function HvHomNayTrang({ d }: { d: HvHomNay }) {
  const bay = new Date();
  return (
    <>
      {/* Hero */}
      <section className="relative flex flex-wrap items-center gap-5 overflow-hidden rounded-3xl bg-[var(--sr-purple)] p-[18px] text-white min-[900px]:p-7">
        <span aria-hidden="true" className="absolute -right-10 -top-10 size-[200px] rounded-full bg-[var(--sr-orange)]/[0.18]" />
        <span className="relative shrink-0">
          <Sticker ten="chao" cao={116} uuTien />
        </span>
        <div className="relative flex min-w-0 flex-[1_1_280px] flex-col gap-1.5">
          <div className="text-[13px] font-bold tracking-[0.06em] text-[var(--sr-hero-eyebrow)]">{d.nhanHomNay}</div>
          <h1 className="m-0 break-words font-display text-[25px] font-extrabold leading-[31px] min-[900px]:text-[32px] min-[900px]:leading-[38px]">
            Chào {d.ten}!
          </h1>
          <div className="text-base leading-6 text-[var(--sr-hero-text)]">{d.chao}</div>
        </div>
        <div className={cn("relative grid flex-[0_1_300px] gap-2.5 max-[430px]:flex-[1_1_100%]", d.coin === null ? "grid-cols-2" : "grid-cols-3")}>
          <Link href="/portal/hoc-sinh/hanh-trinh" className="flex flex-col gap-0.5 rounded-2xl bg-white/[0.12] p-3 text-white no-underline">
            <b className="text-[22px]">{d.xong}</b>
            <span className="text-xs text-[var(--sr-hero-text)]">buổi đã học</span>
          </Link>
          <Link href="/portal/hoc-sinh/hanh-trinh" className="flex flex-col gap-0.5 rounded-2xl bg-white/[0.12] p-3 text-white no-underline">
            <b className="text-[22px]">{d.huyHieu}</b>
            <span className="text-xs text-[var(--sr-hero-text)]">huy hiệu</span>
          </Link>
          {/* «SataCoin» tạm ẩn (04/11/2026): d.coin === null ⇒ không vẽ ô này. */}
          {d.coin !== null && (
            <Link href="/portal/hoc-sinh/hanh-trinh" className="flex flex-col gap-0.5 rounded-2xl bg-[var(--sr-orange)] p-3 text-[var(--sr-on-orange)] no-underline">
              <b className="text-[22px]">{dinhDangSoCoin(d.coin)}</b>
              <span className="text-xs">SataCoin</span>
            </Link>
          )}
        </div>
      </section>

      <HvLuoi>
        {/* Buổi học tiếp theo */}
        <HvThe vien="cam" aria-labelledby="buoi-toi" className="gap-4">
          <div className="flex items-center justify-between gap-2.5">
            <h2 id="buoi-toi" className="m-0 text-[13px] font-bold tracking-[0.06em] text-[var(--sr-orange-text)]">
              BUỔI HỌC TIẾP THEO
            </h2>
            {d.tiep && (
              <span className="rounded-full bg-[var(--sr-tint-orange)] px-3 py-[5px] text-[13px] font-bold">{d.tiep.conNgay}</span>
            )}
          </div>
          {d.tiep ? (
            <>
              <div className="flex items-center gap-4">
                <span className="flex size-16 shrink-0 flex-col items-center justify-center rounded-[18px] bg-[var(--sr-purple)] text-white">
                  <span className="text-[11px] text-[var(--sr-hero-text)]">Buổi</span>
                  <b className="text-2xl leading-[26px]">{d.tiep.so ?? "–"}</b>
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <div
                    className={cn(
                      "break-words text-xl font-bold leading-[26px]",
                      d.tiep.ten === null && "font-medium text-muted-foreground",
                    )}
                  >
                    {d.tiep.ten ?? "Chưa có tên bài"}
                  </div>
                  <div className="text-sm text-muted-foreground">{[d.tiep.ngayNhan, d.tiep.gio].filter(Boolean).join(" · ")}</div>
                </div>
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5 text-sm">
                <div className="flex flex-col gap-0.5 rounded-[14px] bg-background p-3">
                  <span className="text-xs text-muted-foreground">Dạy em</span>
                  <b>{d.tiep.giaoVien ?? "—"}</b>
                </div>
                <div className="flex flex-col gap-0.5 rounded-[14px] bg-background p-3">
                  <span className="text-xs text-muted-foreground">Ở đâu</span>
                  <b>{d.tiep.noi ?? "—"}</b>
                </div>
              </div>
            </>
          ) : (
            <p className="m-0 text-[15px] leading-6 text-muted-foreground">Em chưa có buổi học sắp tới. Có lịch mới là em thấy ngay ở đây.</p>
          )}
          <Link href="/portal/hoc-sinh/lich" className="self-start text-sm font-bold text-[var(--sr-purple-text)]">
            Xem cả lịch học →
          </Link>
        </HvThe>

        {(d.coBaiTap || d.loiDan) && (
        <div className="flex flex-col gap-5">
          {/* Việc của em — ẨN cùng «Bài tập & bài thi» (chủ dự án 04/11/2026: khi nào mở bài tập & bài thi thì mở theo). Thẻ này chỉ có
              bài về nhà + lời mời đánh giá thầy cô; ẩn ⇒ lối vào đánh giá vẫn còn ở menu «Đánh giá thầy cô». */}
          {d.coBaiTap && (
          <HvThe aria-labelledby="viec">
            <h2 id="viec" className="m-0 text-xl font-bold">
              Việc của em
            </h2>
            {d.baiTap ? (
              <Link
                href={`/portal/hoc-sinh/bai-tap/${d.baiTap.id}`}
                className="flex items-center gap-3.5 rounded-2xl bg-background p-3.5 text-foreground no-underline"
              >
                <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-[var(--sr-tint-orange)] text-[var(--sr-orange-text)]">
                  <Ic d={IC.baitap} size={22} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="text-xs font-bold text-[var(--sr-orange-text)]">
                    BÀI VỀ NHÀ{d.baiTap.buoi !== null ? ` · BUỔI ${d.baiTap.buoi}` : ""}
                  </span>
                  <b className="break-words text-[15px] leading-[21px]">{d.baiTap.ten}</b>
                  <span className="text-[13px] text-muted-foreground">
                    {[d.baiTap.han, d.baiTap.thieuBai > 1 ? `còn ${d.baiTap.thieuBai} bài chưa nộp` : null].filter(Boolean).join(" · ") || "Chưa đặt hạn nộp"}
                  </span>
                </span>
                <span className="flex h-9 shrink-0 items-center rounded-[10px] bg-[var(--sr-orange)] px-3.5 text-[13px] font-bold text-[var(--sr-on-orange)]">
                  Làm bài
                </span>
              </Link>
            ) : (
              <p className="m-0 rounded-2xl bg-background p-3.5 text-sm text-muted-foreground">Em đã nộp hết bài về nhà. Giỏi lắm!</p>
            )}
            {d.danhGia && (
              <Link
                href="/portal/hoc-sinh/danh-gia-gv"
                className="flex items-center gap-3.5 rounded-2xl bg-[var(--sr-tint-purple)] p-3.5 text-foreground no-underline"
              >
                <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-card text-[var(--sr-purple-text)]">
                  <Ic d={IC.danhgia} size={22} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <b className="text-[15px]">Em thấy giờ học với {d.danhGia.giaoVien} thế nào?</b>
                  <span className="text-[13px] text-muted-foreground">{d.danhGia.dot} · khoảng 2 phút · bí mật</span>
                </span>
                <span aria-hidden="true" className="shrink-0 text-xl text-[var(--sr-purple-text)]">
                  ›
                </span>
              </Link>
            )}
          </HvThe>
          )}

          {/* Lời thầy cô dặn */}
          {d.loiDan && (
            <HvThe aria-labelledby="loi-thay">
              <div className="flex items-center justify-between gap-2">
                <h2 id="loi-thay" className="m-0 text-xl font-bold">
                  Lời thầy cô dặn em
                </h2>
                {d.loiDan.buoi !== null && <span className="text-[13px] text-muted-foreground">Buổi {d.loiDan.buoi}</span>}
              </div>
              <blockquote className="m-0 rounded-2xl border-l-4 border-[var(--sr-orange)] bg-background px-[18px] py-4 text-[15px] leading-6">
                “{d.loiDan.noiDung}”
              </blockquote>
              {d.loiDan.giaoVien && <div className="text-[13px] text-muted-foreground">— {d.loiDan.giaoVien}</div>}
            </HvThe>
          )}
        </div>
        )}
      </HvLuoi>

      <HvLuoi>
        {/* Tiến độ */}
        <HvThe aria-labelledby="tien-do" className="flex-row flex-wrap items-center gap-5">
          <svg aria-hidden="true" width="120" height="120" viewBox="0 0 120 120" className="shrink-0">
            <circle cx="60" cy="60" r="50" fill="none" stroke="var(--sr-bar-off)" strokeWidth="14" />
            <circle
              cx="60"
              cy="60"
              r="50"
              fill="none"
              stroke="var(--sr-orange)"
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${((2 * Math.PI * 50 * d.tienDo.pct) / 100).toFixed(1)} ${(2 * Math.PI * 50).toFixed(1)}`}
              transform="rotate(-90 60 60)"
            />
            <text x="60" y="58" textAnchor="middle" className="font-display" fontSize="26" fontWeight="800" fill="var(--foreground)">
              {d.tienDo.pct}%
            </text>
            <text x="60" y="78" textAnchor="middle" fontSize="12" fill="var(--muted-foreground)">
              cả khoá
            </text>
          </svg>
          <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-2">
            <h2 id="tien-do" className="m-0 text-xl font-bold">
              Em đang ở học phần {d.tienDo.hocPhan}
            </h2>
            <div className="text-sm leading-[21px] text-muted-foreground">
              Đã xong {d.tienDo.trong}/12 buổi của học phần này. {d.tienDo.conLai ?? ""}
            </div>
            <div aria-hidden="true" className="grid grid-cols-12 gap-1">
              {d.tienDo.o.map((xong, i) => (
                <span key={i} className={cn("h-2.5 rounded-full", xong ? "bg-[var(--sr-orange)]" : "bg-[var(--sr-bar-off)]")} />
              ))}
            </div>
          </div>
        </HvThe>

        {/* Tin mới */}
        <HvThe aria-labelledby="tin" className="gap-3">
          <div className="flex items-center justify-between">
            <h2 id="tin" className="m-0 text-xl font-bold">
              Tin mới
            </h2>
            <Link href="/portal/hoc-sinh/thong-bao" className="text-sm font-bold text-[var(--sr-purple-text)]">
              Xem hết
            </Link>
          </div>
          {d.tin.length === 0 ? (
            <p className="m-0 rounded-[14px] bg-background p-3 text-sm text-muted-foreground">Chưa có tin mới.</p>
          ) : (
            d.tin.map((t) => (
              <Link key={t.id} href={t.href} className="flex items-center gap-3 rounded-[14px] bg-background p-3 text-foreground no-underline">
                <span aria-hidden="true" className={cn("grid size-[38px] shrink-0 place-items-center rounded-xl text-[15px] font-extrabold", SAC[t.sac])}>
                  {t.ky}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <b className="break-words text-sm leading-5">{t.ten}</b>
                  <span className="text-xs text-muted-foreground">{nhanThoiGian(t.luc, bay)}</span>
                </span>
              </Link>
            ))
          )}
        </HvThe>
      </HvLuoi>
    </>
  );
}
