"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePortalAppearance } from "@/components/portal/appearance-provider";
import { DaiLinkPhapLy } from "@/components/public/dai-link-phap-ly";
import { DongCoin, IC, Ic } from "@/components/portal/hv-icon";
import { dinhDangSoCoin, mucDangMo, tieuDeThanhTren, type MucHv } from "@/lib/portal/hv-dieu-huong";
import { locMucBaiTapBaiThi } from "@/lib/portal/muc-tam-an-thuan";

// Vỏ CỔNG HỌC SINH theo artifact "HvSide / HvTab / M-HV-*" (02/11/2026):
//   ≥900px  menu bên 248px (HvSide.dc.html)
//   <900px  thanh trên (avatar · tiêu đề · SataCoin · chuông) + thanh tab dưới 5 mục (HvTab.dc.html) + màn "Thêm"
// Chế độ học sinh KHÔNG suy từ đường dẫn mà do cookie đã ký (xem lib/portal/hv-token.ts); component này chỉ VẼ.
// Màu lấy hết từ token `--sr-*` / shadcn của `.portal-v2` nên sáng/tối tự đổi cùng nhau.

export type HvVoProps = {
  ten: string;
  /** Chữ cái đầu 1–2 ký tự của avatar. */
  tat: string;
  /** Dòng phụ dưới tên: `Sata 3 · Lớp 005`. */
  phu: string;
  /** Số dư SataCoin; `null` = mục «SataCoin» tạm ẩn (04/11/2026) ⇒ không vẽ chip coin ở menu bên lẫn thanh trên. BẮT BUỘC khai. */
  coin: number | null;
  mauAv: 0 | 1 | 2;
  tinMoi: number;
  baiTap: number;
  danhGia: number;
  /**
   * «Bài tập & bài thi» đang hiện không — BẮT BUỘC, không mặc định (luật 11): quên truyền = mục biến mất im lặng, hoặc hiện mà route đã 404.
   * Tạm ẩn 03/11/2026; `docHvVo` tính bằng `mucBaiTapBaiThiDangHien()`. Ẩn ⇒ thanh tab chỉ còn 4 ô.
   */
  coBaiTap: boolean;
};

type Muc = { id: MucHv; ten: string; href: string; icon: string; badge: number };

// Lối vào màn thoát — khai dạng `href: "…"` để lưới v2-nav-day-du thấy đủ route của cổng học sinh.
const THOAT = { href: "/portal/hoc-sinh/thoat", ten: "Về chế độ ba mẹ" };

const AVATAR: Record<0 | 1 | 2, string> = {
  0: "bg-[var(--sr-orange)] text-[var(--sr-on-orange)]",
  1: "bg-[var(--sr-tint-orange)] text-[var(--sr-orange-text)]",
  2: "bg-[var(--sr-success-bg)] text-[var(--sr-success)]",
};

export function Avatar({ tat, mauAv, size, className }: { tat: string; mauAv: 0 | 1 | 2; size: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className={cn("grid shrink-0 place-items-center rounded-full font-extrabold", AVATAR[mauAv], className)}
    >
      {tat}
    </span>
  );
}

function Logo() {
  return (
    <Link href="/portal/hoc-sinh" aria-label="Sata Robo — Hôm nay" className="flex flex-col gap-0.5 px-2 no-underline">
      <span className="flex items-baseline gap-0.5 font-display text-[26px] font-extrabold leading-none tracking-[0.02em]">
        <span className="text-[var(--sr-orange)]">SATA</span>
        <span className="text-[var(--sr-purple-text)]">ROBO</span>
      </span>
      <span className="text-[11px] font-bold tracking-[0.08em] text-[var(--sr-orange-text)]">CỔNG HỌC SINH</span>
    </Link>
  );
}

function DoiGiaoDien() {
  const { isDark, setTheme } = usePortalAppearance();
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="flex min-h-10 items-center gap-3 rounded-[10px] px-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {isDark ? <Sun className="size-[18px] shrink-0" aria-hidden="true" /> : <Moon className="size-[18px] shrink-0" aria-hidden="true" />}
      {isDark ? "Giao diện sáng" : "Giao diện tối"}
    </button>
  );
}

export function HvShell(props: HvVoProps & { children: React.ReactNode }) {
  const { ten, tat, phu, coin, mauAv, tinMoi, baiTap, danhGia, coBaiTap, children } = props;
  const pathname = usePathname();
  const dang = mucDangMo(pathname);
  const soCoin = coin === null ? null : dinhDangSoCoin(coin);

  const mucDayDu: Muc[] = [
    { id: "homnay", ten: "Hôm nay", href: "/portal/hoc-sinh", icon: IC.homnay, badge: 0 },
    { id: "lich", ten: "Lịch học", href: "/portal/hoc-sinh/lich", icon: IC.lich, badge: 0 },
    { id: "hanhtrinh", ten: "Hành trình & huy hiệu", href: "/portal/hoc-sinh/hanh-trinh", icon: IC.hanhtrinh, badge: 0 },
    { id: "baitap", ten: "Bài tập & bài thi", href: "/portal/hoc-sinh/bai-tap", icon: IC.baitap, badge: baiTap },
    { id: "sanpham", ten: "Sản phẩm & tính cách", href: "/portal/hoc-sinh/san-pham", icon: IC.sanpham, badge: 0 },
    { id: "danhgia", ten: "Đánh giá thầy cô", href: "/portal/hoc-sinh/danh-gia-gv", icon: IC.danhgia, badge: danhGia },
    { id: "thongbao", ten: "Tin mới cho em", href: "/portal/hoc-sinh/thong-bao", icon: IC.thongbao, badge: tinMoi },
  ];
  const muc = locMucBaiTapBaiThi(mucDayDu, coBaiTap);
  const tabDayDu: { id: MucHv | "them"; ten: string; href: string; icon: string; cham: boolean }[] = [
    { id: "homnay", ten: "Hôm nay", href: "/portal/hoc-sinh", icon: IC.homnay, cham: false },
    { id: "lich", ten: "Lịch học", href: "/portal/hoc-sinh/lich", icon: IC.lich, cham: false },
    { id: "hanhtrinh", ten: "Huy hiệu", href: "/portal/hoc-sinh/hanh-trinh", icon: IC.hanhtrinh, cham: false },
    { id: "baitap", ten: "Bài tập", href: "/portal/hoc-sinh/bai-tap", icon: IC.baitap, cham: baiTap > 0 },
    { id: "them", ten: "Thêm", href: "/portal/hoc-sinh/them", icon: IC.them, cham: danhGia + tinMoi > 0 },
  ];
  const tab = locMucBaiTapBaiThi(tabDayDu, coBaiTap);
  const tabDangMo = tab.some((t) => t.id === dang) ? dang : "them";

  // Màn thoát là thẻ giữa trang trên nền tím — không menu, không thanh tab (artifact HV-Thoat / M-HV-Thoat).
  if (dang === "thoat") return <div className="min-h-screen">{children}</div>;

  return (
    <div className="flex min-h-screen flex-wrap items-stretch bg-background font-sans text-foreground">
      {/* Menu bên (≥900px) */}
      <aside
        aria-label="Menu cổng học sinh"
        className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-border bg-card px-4 py-6 min-[900px]:flex"
      >
        <Logo />
        <div className="flex flex-col gap-3 rounded-2xl bg-[var(--sr-purple)] p-3.5 text-white">
          <div className="flex items-center gap-3">
            <Avatar tat={tat} mauAv={mauAv} size={44} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="break-words text-base font-bold leading-tight">{ten}</span>
              <span className="text-xs text-[var(--sr-hero-text)]">{phu}</span>
            </span>
          </div>
          {soCoin !== null && (
            <Link
              href="/portal/hoc-sinh/hanh-trinh"
              className="flex h-10 items-center justify-between gap-2 rounded-xl bg-white/[0.12] px-3 text-white no-underline"
            >
              <span className="flex items-center gap-2 text-[13px] text-[var(--sr-hero-text)]">
                <DongCoin size={18} />
                SataCoin
              </span>
              <b className="text-base">{soCoin}</b>
            </Link>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {muc.map((m) => {
            const on = m.id === dang;
            return (
              <Link
                key={m.id}
                href={m.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex min-h-[46px] items-center justify-between gap-2 rounded-xl px-3 text-[15px] no-underline",
                  on
                    ? "bg-[var(--sr-tint-orange)] font-bold text-foreground"
                    : "font-semibold text-[var(--sr-ink-body)] hover:bg-muted",
                )}
              >
                <span className="flex items-center gap-3">
                  <Ic d={m.icon} size={20} />
                  {m.ten}
                </span>
                {m.badge > 0 && (
                  <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-[var(--sr-orange)] px-[7px] text-xs font-bold text-[var(--sr-on-orange)]">
                    {m.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <div className="mt-auto flex flex-col gap-2.5 border-t border-border pt-4">
          <DoiGiaoDien />
          <Link
            href={THOAT.href}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-bold text-foreground no-underline"
          >
            <Ic d={IC.khoa} size={16} />
            {THOAT.ten}
          </Link>
          <div className="px-1 text-xs leading-[18px] text-muted-foreground">
            Em đang dùng trên tài khoản của ba mẹ. Học xong nhớ nhờ ba mẹ thoát nhé.
          </div>
        </div>
      </aside>

      {/* Nội dung */}
      <div className="flex min-w-0 flex-[999_1_560px] flex-col">
        <main className="min-w-0 flex-1 px-[clamp(16px,3vw,40px)] pb-[120px] pt-3 min-[900px]:pb-14 min-[900px]:pt-7">
          <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-4 min-[900px]:gap-[22px]">
            {/* Thanh trên của điện thoại (M-HV-*): avatar · tiêu đề · SataCoin · chuông */}
            <div className="flex min-h-12 items-center gap-2.5 min-[900px]:hidden">
              <Link href="/portal/hoc-sinh" aria-label="Về trang Hôm nay" className="no-underline">
                <Avatar tat={tat} mauAv={mauAv} size={42} />
              </Link>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[11px] font-bold tracking-[0.06em] text-[var(--sr-orange-text)]">CỔNG HỌC SINH</span>
                <b className="truncate text-base leading-5">{tieuDeThanhTren(dang)}</b>
              </span>
              {soCoin !== null && (
                <Link
                  href="/portal/hoc-sinh/hanh-trinh"
                  aria-label={`SataCoin của em: ${soCoin}`}
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--sr-tint-orange)] px-3 text-sm font-extrabold text-foreground no-underline"
                >
                  <DongCoin size={16} />
                  {soCoin}
                </Link>
              )}
              <Link
                href="/portal/hoc-sinh/thong-bao"
                aria-label={tinMoi > 0 ? `Tin mới cho em (${tinMoi})` : "Tin mới cho em"}
                className="relative flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground"
              >
                <Ic d={IC.thongbao} size={18} />
                {tinMoi > 0 && (
                  <span aria-hidden="true" className="absolute right-[7px] top-1.5 size-[9px] rounded-full border-2 border-card bg-[var(--sr-orange)]" />
                )}
              </Link>
            </div>
            {children}
          </div>
        </main>
        <div className="border-t border-border px-4 pb-[100px] pt-3 min-[900px]:px-6 min-[900px]:pb-3">
          <DaiLinkPhapLy />
        </div>
      </div>

      {/* Thanh tab dưới (<900px) */}
      <nav
        aria-label="Điều hướng cổng học sinh"
        style={{ gridTemplateColumns: `repeat(${tab.length}, minmax(0, 1fr))` }}
        className="fixed inset-x-0 bottom-0 z-20 grid h-[84px] border-t border-border bg-card px-1 pb-[22px] pt-2 min-[900px]:hidden"
      >
        {tab.map((t) => {
          const on = t.id === tabDangMo;
          return (
            <Link
              key={t.id}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-[3px] text-[11px] no-underline",
                on ? "font-bold text-foreground" : "font-medium text-muted-foreground",
              )}
            >
              <span className={cn("relative flex h-7 w-[52px] items-center justify-center rounded-full", on && "bg-[var(--sr-tint-orange)]")}>
                <Ic d={t.icon} size={22} />
                {t.cham && (
                  <span aria-hidden="true" className="absolute right-2 top-0 size-[9px] rounded-full border-2 border-card bg-[var(--sr-orange)]" />
                )}
              </span>
              {t.ten}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
