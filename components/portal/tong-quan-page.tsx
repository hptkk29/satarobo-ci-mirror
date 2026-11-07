import Link from "next/link";
import {
  Bell,
  CalendarDays,
  Check,
  Clock3,
  CreditCard,
  ImageOff,
  MapPin,
  MessageCircle,
  MessageSquareText,
  Plus,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NHAN_XU_HUONG } from "@/lib/portal/tong-quan-thuan";
import type { TongQuan } from "@/lib/portal/tong-quan";

// Cổng phụ huynh — "Tổng quan", dựng theo artifact Main.dc.html (desktop) và Mobile.dc.html.
// Màu đi qua token `--sr-*` / token shadcn của `.portal-v2` nên sáng/tối tự đổi theo
// `PortalAppearanceProvider`; không có hex cứng ở đây.
//
// Responsive: các lưới dùng `auto-fit/minmax(min(Npx,100%),1fr)` đúng như artifact nên tự
// rơi một cột ở 320px; không có điểm gãy cứng nào ngoài 900px của vỏ (menu bên ↔ thanh tab).

const CARD = "rounded-[20px] border border-border bg-card";
const NUT_VIEN =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-[var(--sr-tint-purple)]";

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-orange-text)]", className)}>
      {children}
    </div>
  );
}

function TheSo({
  icon,
  nen,
  nhan,
  tieuDe,
  phu,
  href,
  hanhDong,
}: {
  icon: React.ReactNode;
  nen: string;
  nhan: string;
  tieuDe: string;
  phu: string;
  href?: string;
  hanhDong?: string;
}) {
  const noiDung = (
    <>
      <span aria-hidden="true" className={cn("flex size-10 flex-none items-center justify-center rounded-xl", nen)}>
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="text-[13px] text-muted-foreground">{nhan}</div>
        <div className="text-lg font-bold leading-snug">{tieuDe}</div>
        <div className="text-xs leading-[17px] text-muted-foreground">{phu}</div>
        {hanhDong ? <span className="text-[13px] font-bold text-[var(--sr-purple-text)]">{hanhDong} →</span> : null}
      </div>
    </>
  );
  const lop = "flex items-start gap-3.5 rounded-2xl border border-border bg-card p-[18px]";
  return href ? (
    <Link href={href} className={cn(lop, "transition-colors hover:bg-[var(--sr-tint-purple)]")}>
      {noiDung}
    </Link>
  ) : (
    <div className={lop}>{noiDung}</div>
  );
}

export function TongQuanPage({ d }: { d: TongQuan }) {
  const t = d.tiepTheo;
  const sac = (s: "ok" | "warn" | "muted") =>
    s === "ok"
      ? "text-[var(--sr-success)]"
      : s === "warn"
        ? "text-[var(--sr-orange-text)]"
        : "text-muted-foreground";

  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6">
      {/* ── Đầu trang ───────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Eyebrow>{d.homNay}</Eyebrow>
          <h1 className="font-display text-[26px] font-extrabold leading-8 text-foreground min-[560px]:text-[30px] min-[560px]:leading-9">
            Chào ba mẹ, đây là tuần học của {d.tenCon || "con"}.
          </h1>
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            href="/portal/thong-bao"
            aria-label={d.soThongBao > 0 ? `Thông báo, ${d.soThongBao} mục mới` : "Thông báo"}
            className="relative flex size-11 items-center justify-center rounded-xl border border-border bg-card"
          >
            <Bell className="size-5" aria-hidden="true" />
            {d.soThongBao > 0 ? (
              <span
                aria-hidden="true"
                className="absolute right-2.5 top-[9px] size-[9px] rounded-full border-2 border-card bg-[var(--sr-orange)]"
              />
            ) : null}
          </Link>
          <Link
            href="/portal/tin-nhan"
            className="flex h-11 items-center gap-2 rounded-xl bg-[var(--sr-orange)] px-4 text-sm font-bold text-[var(--sr-on-orange)]"
          >
            <MessageCircle className="size-[18px]" aria-hidden="true" />
            {d.giaoVienNhan ? `Nhắn ${d.giaoVienNhan}` : "Nhắn cô thầy"}
          </Link>
        </div>
      </header>

      {/* ── Buổi tiếp theo + sản phẩm ───────────────────────────────────── */}
      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-5">
        <article className="relative flex min-h-[300px] flex-col gap-5 overflow-hidden rounded-[20px] bg-[var(--sr-purple)] p-6 text-white min-[560px]:p-7">
          <div
            aria-hidden="true"
            className="absolute -right-10 top-[26px] flex h-7 w-[260px] items-center justify-evenly rounded-full bg-[var(--sr-purple-mid)] px-3.5"
          >
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i} className="size-3 rounded-full bg-[var(--sr-purple)]" />
            ))}
          </div>
          {t ? (
            <>
              <div className="relative flex flex-col gap-2">
                <div className="text-xs font-bold tracking-[0.08em] text-[var(--sr-hero-eyebrow)]">
                  BUỔI HỌC TIẾP THEO · {t.nhanDemNgay}
                </div>
                <div className="text-[15px] text-[var(--sr-hero-text)]">{t.dongPhu}</div>
                <h2 className="font-display text-[34px] font-extrabold leading-10 min-[560px]:text-[44px] min-[560px]:leading-[48px]">
                  {t.tieuDe}
                </h2>
                <div className="text-sm text-[var(--sr-hero-text)]">{t.nhanBuoi}</div>
              </div>
              <div className="relative flex flex-wrap gap-2.5">
                {t.gio ? (
                  <span className="flex items-center gap-2 rounded-[10px] bg-[var(--sr-purple-deep)] px-3 py-2 text-sm font-semibold">
                    <CalendarDays className="size-4" aria-hidden="true" />
                    {t.ngayNhan} · {t.gio}
                  </span>
                ) : null}
                {t.phong ? (
                  <span className="flex items-center gap-2 rounded-[10px] bg-[var(--sr-purple-deep)] px-3 py-2 text-sm font-semibold">
                    <MapPin className="size-4" aria-hidden="true" />
                    {t.phong}
                  </span>
                ) : null}
                {t.giaoVien ? (
                  <span className="flex items-center gap-2 rounded-[10px] bg-[var(--sr-purple-deep)] px-3 py-2 text-sm font-semibold">
                    <UserRound className="size-4" aria-hidden="true" />
                    {t.giaoVien}
                  </span>
                ) : null}
              </div>
              {t.mucTieu ? (
                <p className="relative max-w-[460px] text-sm leading-[21px] text-[var(--sr-hero-text)]">{t.mucTieu}</p>
              ) : null}
              <div className="relative mt-auto flex flex-wrap gap-2.5">
                <Link
                  href="/portal/lich"
                  className="flex h-11 items-center rounded-xl bg-[var(--sr-orange)] px-[18px] text-sm font-bold text-[var(--sr-on-orange)]"
                >
                  Xem lộ trình cả khoá
                </Link>
                <Link
                  href="/portal/yeu-cau"
                  className="flex h-11 items-center rounded-xl border border-[var(--sr-hero-line)] px-[18px] text-sm font-semibold text-white"
                >
                  Báo con nghỉ buổi này
                </Link>
              </div>
            </>
          ) : (
            <div className="relative flex flex-1 flex-col justify-center gap-3">
              <div className="text-xs font-bold tracking-[0.08em] text-[var(--sr-hero-eyebrow)]">BUỔI HỌC TIẾP THEO</div>
              <h2 className="font-display text-[28px] font-extrabold leading-9">Chưa có buổi học sắp tới</h2>
              <p className="max-w-[420px] text-sm leading-[21px] text-[var(--sr-hero-text)]">
                Khi trung tâm xếp lịch, ngày giờ, phòng học và giáo viên sẽ hiện ở đây.
              </p>
              <Link
                href="/portal/lich"
                className="mt-2 flex h-11 w-fit items-center rounded-xl bg-[var(--sr-orange)] px-[18px] text-sm font-bold text-[var(--sr-on-orange)]"
              >
                Xem lịch học
              </Link>
            </div>
          )}
        </article>

        <article className={cn(CARD, "flex flex-col gap-4 p-5")}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <Eyebrow>CON ĐÃ TỰ TAY LÀM RA</Eyebrow>
              <h2 className="text-xl font-bold leading-[26px]">
                {d.sanPham.loai === "CO" ? d.sanPham.tieuDe : "Sản phẩm của con"}
              </h2>
            </div>
            {d.sanPham.loai === "CO" && d.sanPham.ngay ? (
              <span className="whitespace-nowrap text-[13px] text-muted-foreground">{d.sanPham.ngay.slice(0, 5)}</span>
            ) : null}
          </div>

          {d.sanPham.loai === "CO" ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                {d.sanPham.anh.map((a, i) => (
                  /* Dùng <img> như hinh-anh-page: URL R2 ký động không khai được remotePatterns. */
                  <img
                    key={a.id}
                    src={a.url}
                    alt={a.caption ?? `Ảnh sản phẩm ${i + 1}`}
                    loading="lazy"
                    className={cn(
                      "w-full rounded-xl bg-[var(--sr-tint-purple)] object-cover",
                      i === 0 ? "col-span-3 aspect-[16/10] min-[420px]:col-span-2 min-[420px]:row-span-2 min-[420px]:aspect-auto min-[420px]:h-full min-[420px]:min-h-[170px]" : "aspect-square",
                    )}
                  />
                ))}
              </div>
              {d.sanPham.moTa ? <p className="text-sm leading-[21px]">{d.sanPham.moTa}</p> : null}
              <div className="mt-auto flex flex-wrap gap-2.5">
                <Link href="/portal/hinh-anh" className={cn(NUT_VIEN)}>
                  Xem {d.sanPham.tong} ảnh của con
                </Link>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl bg-[var(--sr-tint-purple)] p-6 text-center">
              <ImageOff className="size-9 text-[var(--sr-purple-text)]" aria-hidden="true" />
              <p className="max-w-[300px] text-sm leading-[21px]">
                {d.sanPham.loai === "KHOA"
                  ? "Ba mẹ chưa bật chia sẻ hình ảnh nên ảnh sản phẩm của con đang được ẩn."
                  : "Chưa có ảnh sản phẩm nào được duyệt. Ảnh giáo viên đăng sau buổi học sẽ hiện ở đây."}
              </p>
              <Link href="/portal/hinh-anh" className={NUT_VIEN}>
                {d.sanPham.loai === "KHOA" ? "Bật chia sẻ hình ảnh" : "Mở góc sản phẩm"}
              </Link>
            </div>
          )}
        </article>
      </section>

      {/* ── 4 ô tình hình nhanh ─────────────────────────────────────────── */}
      <section
        aria-label="Tình hình nhanh"
        className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-4"
      >
        <TheSo
          icon={<Check className="size-5 text-[var(--sr-success)]" aria-hidden="true" />}
          nen="bg-[var(--sr-success-bg)]"
          nhan="Đi học"
          tieuDe={d.diHoc.tieuDe}
          phu={d.diHoc.phu}
          href={d.diHoc.href}
          hanhDong="Xem chuyên cần"
        />
        <TheSo
          icon={<MessageSquareText className="size-5 text-[var(--sr-purple-text)]" aria-hidden="true" />}
          nen="bg-[var(--sr-tint-purple)]"
          nhan="Nhận xét"
          tieuDe={d.nhanXetThe.tieuDe}
          phu={d.nhanXetThe.phu}
          href="/portal/nhan-xet"
        />
        <TheSo
          icon={<CreditCard className="size-5 text-[var(--sr-orange-text)]" aria-hidden="true" />}
          nen="bg-[var(--sr-tint-orange)]"
          nhan="Học phí"
          tieuDe={d.hocPhi.tieuDe}
          phu={d.hocPhi.phu}
          href="/portal/hoc-phi"
        />
        <TheSo
          icon={<Clock3 className="size-5 text-[var(--sr-purple-text)]" aria-hidden="true" />}
          nen="bg-[var(--sr-tint-purple)]"
          nhan="Đã học"
          tieuDe={d.daHoc.tieuDe}
          phu={d.daHoc.phu}
          href="/portal/lich"
        />
      </section>

      {/* ── Hành trình ──────────────────────────────────────────────────── */}
      <section className={cn(CARD, "flex flex-col gap-5 p-5 min-[560px]:p-6")}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <Eyebrow>HÀNH TRÌNH{d.hanhTrinh.tenKhoa ? ` ${d.hanhTrinh.tenKhoa.toUpperCase()}` : ""}</Eyebrow>
            <h2 className="font-display text-2xl font-extrabold leading-[30px]">{d.hanhTrinh.dongTieuDe}</h2>
          </div>
          {d.hanhTrinh.tong > 0 ? (
            <Link href="/portal/lich" className="text-sm font-semibold text-[var(--sr-purple-text)] hover:underline">
              Xem cả {d.hanhTrinh.tong} buổi
            </Link>
          ) : null}
        </div>

        {d.hanhTrinh.hocPhan.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3">
            {d.hanhTrinh.hocPhan.map((hp) => (
              <div key={hp.ma} className="flex flex-col gap-2">
                <div className="flex justify-between text-[13px]">
                  <span className="font-bold">{hp.ten}</span>
                  <span className="text-muted-foreground">
                    {hp.daHoc > 0 ? `${hp.daHoc}/${hp.tong}` : hp.batDau ? `từ ${hp.batDau}` : `${hp.tong} buổi`}
                  </span>
                </div>
                <div
                  role="img"
                  aria-label={`${hp.ten}: đã học ${hp.daHoc} trên ${hp.tong} buổi`}
                  className="flex h-[22px] items-center gap-1 rounded-full bg-[var(--sr-tint-purple)] px-[5px]"
                >
                  {hp.ong.map((o, i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-3 flex-1 rounded-full",
                        o === "xong" ? "bg-[var(--sr-orange)]" : o === "tiep" ? "bg-[var(--sr-purple)]" : "bg-border",
                      )}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {d.hanhTrinh.sapToi.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] gap-3">
            {d.hanhTrinh.sapToi.map((b) => (
              <div
                key={b.id}
                className={cn(
                  "flex flex-col gap-1.5 rounded-[14px] p-3.5",
                  b.noiBat ? "bg-[var(--sr-purple)] text-white" : "border border-border",
                )}
              >
                <div
                  className={cn(
                    "text-[11px] font-bold tracking-[0.08em]",
                    b.noiBat ? "text-[var(--sr-hero-eyebrow)]" : "text-muted-foreground",
                  )}
                >
                  {b.nhan}
                </div>
                <div className="text-[15px] font-bold leading-snug">{b.tieuDe}</div>
                <div className={cn("text-xs", b.noiBat ? "text-[var(--sr-hero-text)]" : "text-muted-foreground")}>
                  {b.ngay}
                </div>
              </div>
            ))}
          </div>
        ) : d.hanhTrinh.hocPhan.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {d.hanhTrinh.tong > 0
              ? "Mọi buổi đã xếp lịch đều đã học xong."
              : "Lộ trình sẽ hiện khi trung tâm xếp lịch cho con."}
          </p>
        ) : null}
      </section>

      {/* ── Nhận xét + năng lực ─────────────────────────────────────────── */}
      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-5">
        <article className={cn(CARD, "flex flex-col gap-4 p-5 min-[560px]:p-6")}>
          {d.nhanXet ? (
            <>
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-11 flex-none items-center justify-center rounded-full bg-[var(--sr-tint-purple)] font-bold text-[var(--sr-purple-text)]"
                >
                  {d.nhanXet.vietTat}
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="text-[15px] font-bold">
                    {d.nhanXet.giaoVien ? `${d.nhanXet.giaoVien} nói về ${d.tenCon || "con"}` : "Nhận xét của giáo viên"}
                  </div>
                  <div className="text-xs text-muted-foreground">{d.nhanXet.nhan}</div>
                </div>
                {d.nhanXet.moi ? (
                  <span className="ml-auto rounded-full bg-[var(--sr-orange)] px-2.5 py-1 text-[11px] font-bold tracking-[0.06em] text-[var(--sr-on-orange)]">
                    MỚI
                  </span>
                ) : null}
              </div>
              {d.nhanXet.noiDung ? (
                <blockquote className="m-0 line-clamp-6 rounded-[14px] bg-[var(--sr-tint-purple)] px-5 py-[18px] text-base leading-[25px]">
                  {d.nhanXet.noiDung}
                </blockquote>
              ) : null}
              {d.nhanXet.khenLuyen.khen || d.nhanXet.khenLuyen.luyen ? (
                <div className="flex flex-wrap gap-2">
                  {d.nhanXet.khenLuyen.khen ? (
                    <span className="flex max-w-full items-center gap-1.5 rounded-full bg-[var(--sr-success-bg)] px-3 py-1.5 text-[13px] font-semibold text-[var(--sr-success)]">
                      <Check className="size-3.5 flex-none" aria-hidden="true" />
                      <span className="truncate">{d.nhanXet.khenLuyen.khen}</span>
                    </span>
                  ) : null}
                  {d.nhanXet.khenLuyen.luyen ? (
                    <span className="flex max-w-full items-center gap-1.5 rounded-full bg-[var(--sr-tint-orange)] px-3 py-1.5 text-[13px] font-semibold">
                      <Plus className="size-3.5 flex-none" aria-hidden="true" />
                      <span className="truncate">{d.nhanXet.khenLuyen.luyen}</span>
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-auto flex flex-wrap gap-2.5">
                <Link href="/portal/nhan-xet" className={NUT_VIEN}>
                  Đọc nhận xét chi tiết
                </Link>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
              <MessageSquareText className="size-9 text-[var(--sr-purple-text)]" aria-hidden="true" />
              <h2 className="text-lg font-bold">Chưa có nhận xét nào</h2>
              <p className="max-w-[320px] text-sm leading-[21px] text-muted-foreground">
                Sau mỗi buổi học, giáo viên gửi nhận xét về con — nhận xét sẽ hiện ở đây.
              </p>
            </div>
          )}
        </article>

        <article className={cn(CARD, "flex flex-col gap-[18px] p-5 min-[560px]:p-6")}>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <Eyebrow>CON LỚN LÊN THẾ NÀO</Eyebrow>
              <h2 className="text-xl font-bold leading-[26px]">
                {d.nangLuc
                  ? `Năng lực tháng ${d.nangLuc.thang} so với tháng ${d.nangLuc.thangTruoc}`
                  : "Năng lực theo tháng"}
              </h2>
            </div>
            <Link href="/portal/nhan-xet" className="text-sm font-semibold text-[var(--sr-purple-text)] hover:underline">
              Mở học bạ
            </Link>
          </div>
          {d.nangLuc ? (
            <>
              <div className="flex flex-col gap-3.5">
                {d.nangLuc.dong.map((r) => (
                  <div
                    key={r.nhom}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 min-[460px]:grid-cols-[minmax(84px,150px)_minmax(32px,1fr)_auto]"
                  >
                    <span className="text-sm font-semibold">{r.nhom}</span>
                    <span
                      className={cn(
                        "col-span-2 row-start-2 flex gap-1 min-[460px]:col-span-1 min-[460px]:row-start-auto",
                      )}
                      role="img"
                      aria-label={`${r.nhom}: ${r.nhanBac}`}
                    >
                      {[1, 2, 3].map((n) => (
                        <span
                          key={n}
                          className={cn(
                            "h-2.5 flex-1 rounded-full",
                            n <= r.bac
                              ? "bg-[var(--sr-purple)]"
                              : r.bacTruoc && n <= r.bacTruoc
                                ? "bg-[var(--sr-dash)]"
                                : "bg-border",
                          )}
                        />
                      ))}
                    </span>
                    <span
                      className={cn(
                        "justify-self-end text-[13px] font-semibold",
                        r.xuHuong === "tang"
                          ? "text-[var(--sr-success)]"
                          : r.xuHuong === "giam"
                            ? "text-[var(--sr-orange-text)]"
                            : "text-muted-foreground",
                      )}
                    >
                      {r.nhanBac}
                      {r.xuHuong ? ` · ${NHAN_XU_HUONG[r.xuHuong]}` : ""}
                    </span>
                  </div>
                ))}
              </div>
              <div className="border-t border-border pt-3 text-xs leading-[18px] text-muted-foreground">
                Tổng hợp từ {d.nangLuc.soNhanXet} nhận xét buổi học trong tháng · 3 bậc: Khá · Tốt · Tích cực
              </div>
            </>
          ) : (
            <p className="rounded-[14px] bg-[var(--sr-tint-purple)] p-4 text-sm leading-[21px]">
              Chưa đủ nhận xét có chấm năng lực để so sánh giữa các tháng. Khi giáo viên chấm các buổi học, biểu đồ sẽ hiện ở đây.
            </p>
          )}
        </article>
      </section>

      {/* ── Việc cần làm · học phí · nhóm lớp ───────────────────────────── */}
      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-5">
        <article className={cn(CARD, "flex flex-col gap-3.5 p-[22px]")}>
          <h2 className="text-lg font-bold">Ba mẹ cần làm</h2>
          {d.viecCanLam.length === 0 ? (
            <div className="flex items-center gap-3 rounded-[14px] bg-[var(--sr-success-bg)] p-3.5 text-sm font-semibold text-[var(--sr-success)]">
              <Check className="size-5 flex-none" aria-hidden="true" />
              Hiện không có việc nào cần ba mẹ làm.
            </div>
          ) : (
            d.viecCanLam.map((v) => (
              <div
                key={v.id}
                className={cn(
                  "flex items-center gap-3 rounded-[14px] p-3.5",
                  v.noiBat ? "bg-[var(--sr-tint-orange)]" : "border border-border",
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="text-sm font-bold">{v.tieuDe}</div>
                  <div className={cn("text-xs", v.noiBat ? "text-foreground" : "text-muted-foreground")}>{v.phu}</div>
                </div>
                <Link
                  href={v.href}
                  className={cn(
                    "flex h-10 flex-none items-center rounded-[10px] px-3.5 text-[13px] font-semibold",
                    v.noiBat ? "bg-[var(--sr-ink)] text-[var(--background)]" : "border border-border text-foreground",
                  )}
                >
                  {v.nhanNut}
                </Link>
              </div>
            ))
          )}
        </article>

        <article className={cn(CARD, "flex flex-col gap-3.5 p-[22px]")}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Học phí</h2>
            <Link href="/portal/hoc-phi" className="text-sm font-semibold text-[var(--sr-purple-text)] hover:underline">
              Chi tiết
            </Link>
          </div>
          {d.hocPhiChiTiet.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có khoản học phí nào.</p>
          ) : (
            <div className="flex flex-col">
              {d.hocPhiChiTiet.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-b-0"
                >
                  <span className="min-w-0 text-sm">
                    {r.ten}
                    {r.phu ? <span className="block text-xs text-muted-foreground">{r.phu}</span> : null}
                  </span>
                  <span className={cn("flex flex-none items-center gap-1.5 text-[13px] font-semibold", sac(r.sac))}>
                    {r.sac === "ok" ? <Check className="size-3.5" aria-hidden="true" /> : null}
                    {r.trangThai}
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className={cn(CARD, "flex flex-col gap-3.5 p-[22px]")}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Nhóm lớp</h2>
            {d.nhomLop && d.nhomLop.chuaDoc > 0 ? (
              <span className="rounded-full bg-[var(--sr-orange)] px-2 py-0.5 text-[11px] font-bold text-[var(--sr-on-orange)]">
                {d.nhomLop.chuaDoc} MỚI
              </span>
            ) : null}
          </div>
          {d.nhomLop ? (
            <div className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="flex size-[34px] flex-none items-center justify-center rounded-full bg-[var(--sr-tint-purple)] text-xs font-bold text-[var(--sr-purple-text)]"
              >
                <MessageCircle className="size-4" />
              </span>
              <div className="min-w-0 rounded-[4px_14px_14px_14px] bg-[var(--sr-tint-purple)] px-3 py-2.5 text-sm leading-5">
                <div className="mb-1 text-xs font-bold text-[var(--sr-purple-text)]">{d.nhomLop.ten}</div>
                <div className="line-clamp-3">{d.nhomLop.tinNhan ?? "Chưa có tin nhắn nào."}</div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Chưa có nhóm lớp hoặc cuộc trò chuyện nào.</p>
          )}
          <Link href="/portal/tin-nhan" className={cn(NUT_VIEN, "mt-auto w-full")}>
            {d.nhomLop ? "Mở nhóm lớp" : "Mở tin nhắn"}
          </Link>
        </article>
      </section>
    </div>
  );
}

