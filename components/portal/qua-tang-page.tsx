import Link from "next/link";
import { ChevronLeft, Gift, Sparkles, Tag } from "lucide-react";
import type { QuaTang } from "@/lib/portal/qua-tang";

// «Quà tặng» — hộp quà các tính năng MIỄN PHÍ cho ba mẹ (board M-Qua-tang). Server component: chỉ danh sách + link; mỗi quà tự gác cờ của
// trang đích, và danh sách đã được lọc theo cờ ở `lib/portal/qua-tang.ts`.
export function QuaTangPage({ qua, soKhuyenMai, coThuNhap }: { qua: readonly QuaTang[]; soKhuyenMai: number; coThuNhap: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-4">
      <Link
        href="/portal"
        className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-[var(--sr-purple-text)] hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Trang chủ
      </Link>

      <section className="relative flex flex-wrap items-center gap-x-6 gap-y-4 overflow-hidden rounded-3xl bg-gradient-to-br from-[#620c8b] via-[#8a2d9e] to-[#c2570c] px-7 py-6 text-white">
        <span aria-hidden="true" className="absolute -right-10 -top-12 size-[220px] rounded-full bg-white/10" />
        <span aria-hidden="true" className="relative flex size-[88px] flex-none items-center justify-center rounded-3xl bg-white/15">
          <Gift className="size-12" />
        </span>
        <div className="relative flex min-w-[240px] flex-[1_1_320px] flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#ffd9b3]">Quà tặng cho cả nhà · miễn phí</span>
          <h1 className="font-display text-[25px] font-extrabold leading-[31px]">Hộp quà của gia đình</h1>
          <p className="max-w-[620px] text-[15px] leading-[23px] text-[#f2e6fa]">
            Những công cụ Sata Robo tặng ba mẹ để hiểu con và chăm sóc cả nhà. Dùng bao nhiêu cũng được, không tính phí.
          </p>
        </div>
      </section>

      <section aria-label="Danh sách quà" className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4">
        {qua.map((q) => (
          <Link
            key={q.ma}
            href={q.href}
            className="flex flex-col gap-3 rounded-[22px] border border-border bg-card p-5 text-foreground no-underline transition-colors hover:bg-[var(--sr-tint-purple)]"
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-[52px] flex-none items-center justify-center rounded-2xl text-[22px] font-extrabold"
                style={{ background: q.nen, color: q.chu }}
              >
                {q.ten.slice(0, 1)}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <b className="text-lg leading-6">{q.ten}</b>
                <span className="text-[13px] text-[var(--sr-ink-muted)]">{q.phu}</span>
              </div>
            </div>
            <span className="text-sm leading-[22px] text-[var(--sr-ink-soft,#3a2d48)]">{q.mo}</span>
            <div className="mt-auto flex items-center justify-between gap-2.5 border-t border-[#f3eaf8] pt-3">
              <span className="rounded-full px-2.5 py-1 text-[13px] font-bold" style={{ background: q.nen, color: q.chu }}>
                Miễn phí
              </span>
              <span className="text-sm font-bold text-[var(--sr-purple-text)]">{q.nut} ›</span>
            </div>
          </Link>
        ))}
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-[22px] border-2 border-dashed border-border p-5 text-center text-[var(--sr-ink-muted)]">
          <Sparkles className="size-8" aria-hidden="true" />
          <b className="text-base text-foreground">Sắp có thêm quà</b>
          <span className="max-w-[260px] text-[13px] leading-5">
            Sata Robo sẽ thêm công cụ mới vào hộp quà. Có quà mới ba mẹ sẽ nhận thông báo.
          </span>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[18px] border border-[#f3d3b0] bg-[var(--sr-tint-orange,#fff1e4)] px-[22px] py-[18px]">
        <Tag className="size-7 flex-none text-[#c2570c]" aria-hidden="true" />
        <div className="flex min-w-[240px] flex-[1_1_320px] flex-col gap-0.5">
          <b className="text-base">
            {soKhuyenMai > 0 ? `Đang có ${soKhuyenMai} chương trình khuyến mãi` : "Chương trình khuyến mãi của trung tâm"}
          </b>
          <span className="text-sm text-[#6b4a2a]">Xem ưu đãi học phí đang áp dụng.</span>
        </div>
        <Link
          href="/portal/khuyen-mai"
          className="flex h-11 items-center rounded-xl bg-[var(--sr-orange)] px-[18px] text-sm font-bold text-[var(--sr-on-orange)]"
        >
          Xem khuyến mãi
        </Link>
      </section>

      {/* «Thu nhập thêm» — CHỈ khi cờ THU_NHAP_THEM_ENABLED bật (mặc định tắt ⇒ không vẽ gì, không link chết). */}
      {coThuNhap ? (
        <Link
          href="/portal/thu-nhap"
          className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[18px] border border-border bg-card px-[22px] py-[18px] text-foreground no-underline"
        >
          <b className="text-base">Thu nhập thêm</b>
          <span className="flex-1 text-sm text-[var(--sr-ink-muted)]">Khách ba mẹ giới thiệu và hoa hồng.</span>
          <span className="text-sm font-bold text-[var(--sr-purple-text)]">Xem ›</span>
        </Link>
      ) : null}
    </div>
  );
}
