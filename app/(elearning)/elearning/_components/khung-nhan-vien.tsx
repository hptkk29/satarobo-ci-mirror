"use client";

// KHUNG NHÂN VIÊN (người học) — theo HTML thiết kế `01-nhan-vien/Main.html` (`header.top`, `.tnav`, `.tright`, `.who`, `.menu`):
//   · Thanh trên MỘT HÀNG, cao 64px, nền thẻ + viền dưới: logo tròn + "Cổng Elearning / Sata Robo", điều hướng GẠCH CHÂN
//     (mục đang mở: chữ đậm + gạch 2px dưới đáy thanh), bên phải: biểu tượng tìm kiếm, chuông, avatar + tên + dòng vai trò.
//   · ≤ 1180px ẩn tên/dòng vai trò; ≤ 900px ẩn chữ thương hiệu (logo còn); ≤ 720px các mục điều hướng chuyển thành THANH DƯỚI
//     có biểu tượng. Thanh trên không bao giờ xuống hàng thứ hai.
//   · Menu tài khoản: thẻ người dùng · Dữ liệu của tôi · Chứng nhận của tôi · Thông báo · Giao diện tối/sáng · Đăng xuất.
// Khác `AppShell` (khung quản trị): không có thanh bên, không có ngăn kéo.
//
// SAI KHÁC CÓ CHỦ ĐÍCH so với HTML (DECISIONS.md D-05/D-06/D-20):
//   · "Đề nghị đào tạo" CHƯA vẽ trên thanh điều hướng — Q14 chưa chốt (D-05/D-06); lối vào theo ngữ cảnh ở trang Khoá của tôi.
//   · "Hướng dẫn sử dụng" và "Về hệ thống Sata Robo" của menu thiết kế chưa vẽ: chưa có route (P8 / không thuộc phạm vi) — luật 12.
//   · Chuông giữ NotificationBell dùng chung (có bảng xem nhanh + realtime) thay vì liên kết trần.
//   · Thêm "Sang khu Quản trị" (chỉ khi người này có mục quản trị) và "Theo hệ thống" (Q3: mặc định theo hệ thống).
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Award, BookOpen, Database, House, LibraryBig, LogOut, Monitor, Moon, Search, Settings2, Sun } from "lucide-react";
import { NotificationBell } from "@/components/notifications/notification-bell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutToGate } from "@/lib/auth/logout-client";
import { elearningHref } from "@/lib/elearning/notification-href";
import { cn } from "@/lib/utils";
import { useElearningTheme } from "./elearning-theme";
import { LienKet, laTrangBai } from "./lien-ket";
import { mucDangMo, type BieuTuong, type KhuMenu } from "./menu";

const ICON: Partial<Record<BieuTuong, typeof Award>> = {
  "tong-quan": House,
  khoa: LibraryBig,
  "chung-nhan": Award,
};

/** Ba mục điều hướng chính (có biểu tượng cho thanh dưới). Dữ liệu của tôi nằm ở menu tài khoản, đúng như thiết kế. */
const HREF_CHINH: readonly string[] = ["/elearning", "/elearning/khoa-cua-toi", "/elearning/chung-nhan-cua-toi"];

/** Thiết kế gọi mục thứ ba là "Chứng nhận" (menu tài khoản mới là "Chứng nhận của tôi"); "Khoá của tôi" giữ nguyên. */
function nhanNav(nhan: string): string {
  return nhan === "Chứng nhận của tôi" ? "Chứng nhận" : nhan;
}

/** Dòng phụ dưới tên người dùng — từ hồ sơ nhân sự thật (không có thì không vẽ, KHÔNG bịa vai trò). */
export type ThongTinNguoi = { maSo: string; chucDanh: string; coSo: string | null };

function chuCai(ten: string): string {
  const t = ten.trim().split(/\s+/).filter(Boolean);
  if (t.length === 0) return "?";
  const dau = t[0]?.[0] ?? "";
  const cuoi = t.length > 1 ? (t[t.length - 1]?.[0] ?? "") : "";
  return (dau + cuoi).toUpperCase();
}

/** THUẦN — "Giáo viên · CS2" (bỏ phần thiếu). */
export function dongVaiTro(n: ThongTinNguoi | undefined): string {
  return [n?.chucDanh, n?.coSo].filter((x): x is string => Boolean(x && x.trim())).join(" · ");
}

function Avatar({ ten, className }: { ten: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 flex-none items-center justify-center rounded-full bg-secondary text-xs font-medium text-[color:var(--el-text2)]",
        className,
      )}
    >
      {chuCai(ten)}
    </span>
  );
}

export function KhungNhanVien({
  userId,
  userName,
  nguoi,
  khu,
  chuyenKhu,
  children,
}: {
  userId: string;
  userName: string;
  nguoi?: ThongTinNguoi;
  /** Các khu người này thấy; khung chỉ dùng khu "hoc-tap". */
  khu: readonly KhuMenu[];
  /** Lối sang khung quản trị — CHỈ truyền khi người này có ít nhất một mục quản trị. */
  chuyenKhu?: { href: string; nhan: string };
  children: React.ReactNode;
}) {
  const duongDan = usePathname() ?? "/elearning";
  const toanTrang = laTrangBai(duongDan);
  const hocTap = khu.find((k) => k.id === "hoc-tap");
  const muc = (hocTap?.muc ?? []).filter((m) => HREF_CHINH.includes(m.href));
  const dangMo = mucDangMo(hocTap ? [hocTap] : [], duongDan);
  const { theme, resolved, setTheme } = useElearningTheme();
  const vaiTro = dongVaiTro(nguoi);

  return (
    <div className="min-h-screen print:bg-white">
      <a
        href="#noi-dung"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
      >
        Bỏ qua điều hướng, tới nội dung
      </a>

      <header className="sticky top-0 z-30 print:hidden">
        {/* `flex-nowrap` + `min-w-0`: thanh trên LUÔN một hàng. Co giãn bằng cách ẩn bớt chữ, không bằng cách xuống dòng. */}
        <div className="flex min-h-16 flex-nowrap items-center gap-6 border-b border-border bg-card px-[clamp(16px,4vw,40px)] max-[1180px]:gap-4 max-[720px]:min-h-14 max-[720px]:gap-2">
          <LienKet
            href="/elearning"
            toanTrang={toanTrang}
            aria-label="Cổng Elearning · Sata Robo — Tổng quan"
            className="flex min-h-16 shrink-0 items-center gap-2.5 rounded-lg text-primary-ink outline-none focus-visible:ring-2 focus-visible:ring-ring max-[720px]:min-h-14"
          >
            <Image
              src="/brand/logo-satarobo-tron.png"
              alt=""
              width={32}
              height={32}
              priority
              className="size-8 flex-none rounded-full"
            />
            <span className="text-[15px] font-medium leading-[18px] max-[900px]:hidden max-[720px]:block">
              <span>Cổng Elearning</span>
              <span className="block text-[13px] font-normal leading-4 text-[color:var(--el-text2)]">Sata Robo</span>
            </span>
          </LienKet>

          <nav
            aria-label="Điều hướng chính"
            className="flex min-w-0 items-stretch gap-1 self-stretch max-[720px]:hidden"
          >
            {muc.map((m) => {
              const mo = dangMo?.href === m.href;
              return (
                <LienKet
                  key={m.href}
                  href={m.href}
                  toanTrang={toanTrang}
                  aria-current={mo ? "page" : undefined}
                  className={cn(
                    "flex items-center whitespace-nowrap border-b-2 px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-[900px]:px-2.5",
                    mo
                      ? "border-foreground font-medium text-foreground"
                      : "border-transparent text-[color:var(--el-text2)] hover:text-foreground",
                  )}
                >
                  {nhanNav(m.nhan)}
                </LienKet>
              );
            })}
          </nav>

          <div className="relative ml-auto flex items-center gap-1">
            <LienKet
              href="/elearning/tim-kiem"
              toanTrang={toanTrang}
              aria-label="Tìm trong khoá của tôi"
              className="inline-flex size-10 items-center justify-center rounded-[10px] text-[color:var(--el-text2)] outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Search className="size-5" strokeWidth={1.5} aria-hidden />
            </LienKet>
            <NotificationBell userId={userId} resolveHref={elearningHref} viewAllHref="/elearning/thong-bao" />
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Menu tài khoản"
                className="flex min-h-11 items-center gap-2.5 rounded-[10px] px-2 py-1 text-left outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar ten={userName} />
                <span className="flex flex-col leading-4 max-[1180px]:hidden">
                  <span className="max-w-[12rem] truncate text-sm text-primary-ink">{userName}</span>
                  {vaiTro ? <span className="max-w-[12rem] truncate text-xs text-muted-foreground">{vaiTro}</span> : null}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[300px] max-w-[calc(100vw-2rem)] rounded-[14px] p-2">
                <div className="flex items-center gap-2.5 px-2.5 pb-2.5 pt-2">
                  <Avatar ten={userName} />
                  <span className="min-w-0 text-sm leading-[18px] text-foreground">
                    <span className="block truncate">{userName}</span>
                    {nguoi ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {[nguoi.maSo, nguoi.chucDanh, nguoi.coSo].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </span>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={toanTrang ? <a href="/elearning/du-lieu-cua-toi" /> : <Link href="/elearning/du-lieu-cua-toi" />}>
                  <Database className="mr-2 size-4" aria-hidden /> Dữ liệu của tôi
                </DropdownMenuItem>
                <DropdownMenuItem render={toanTrang ? <a href="/elearning/chung-nhan-cua-toi" /> : <Link href="/elearning/chung-nhan-cua-toi" />}>
                  <Award className="mr-2 size-4" aria-hidden /> Chứng nhận của tôi
                </DropdownMenuItem>
                {/* P8 — "Hướng dẫn sử dụng" theo thiết kế (NvMenu). */}
                <DropdownMenuItem render={toanTrang ? <a href="/elearning/huong-dan" /> : <Link href="/elearning/huong-dan" />}>
                  <BookOpen className="mr-2 size-4" aria-hidden /> Hướng dẫn sử dụng
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* Thiết kế: một dòng "Giao diện tối". Đang tối thì dòng đó thành "Giao diện sáng". */}
                <DropdownMenuItem onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}>
                  {resolved === "dark" ? <Sun className="mr-2 size-4" aria-hidden /> : <Moon className="mr-2 size-4" aria-hidden />}
                  {resolved === "dark" ? "Giao diện sáng" : "Giao diện tối"}
                </DropdownMenuItem>
                {theme !== "system" ? (
                  <DropdownMenuItem onClick={() => setTheme("system")}>
                    <Monitor className="mr-2 size-4" aria-hidden /> Theo hệ thống
                  </DropdownMenuItem>
                ) : null}
                {chuyenKhu ? (
                  <DropdownMenuItem render={<Link href={chuyenKhu.href} />}>
                    <Settings2 className="mr-2 size-4" aria-hidden /> {chuyenKhu.nhan}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem className="text-state-danger-ink focus:text-state-danger-ink" onClick={() => logoutToGate()}>
                  <LogOut className="mr-2 size-4" aria-hidden /> Đăng xuất
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Chừa chỗ cho thanh dưới trên điện thoại để nội dung cuối trang không bị che. */}
      <div id="noi-dung" className="min-w-0 max-[720px]:pb-24">
        {children}
      </div>

      {/* Thanh dưới — chỉ ≤ 720px. Biểu tượng + chữ (màu không đứng một mình); vùng bấm ≥ 44px. */}
      <nav
        aria-label="Điều hướng chính (điện thoại)"
        className="fixed inset-x-0 bottom-0 z-30 hidden justify-around gap-0.5 border-t border-border bg-card px-2 pb-[calc(6px+env(safe-area-inset-bottom))] pt-1.5 max-[720px]:flex print:hidden"
      >
        {muc.map((m) => {
          const mo = dangMo?.href === m.href;
          const Icon = ICON[m.bieuTuong] ?? House;
          return (
            <LienKet
              key={m.href}
              href={m.href}
              toanTrang={toanTrang}
              aria-current={mo ? "page" : undefined}
              className={cn(
                "flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[10px] px-1 text-[11px] leading-[14px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                mo ? "bg-secondary font-medium text-foreground" : "text-[color:var(--el-text2)]",
              )}
            >
              <Icon className="size-5" strokeWidth={1.5} aria-hidden />
              {nhanNav(m.nhan)}
            </LienKet>
          );
        })}
      </nav>
    </div>
  );
}
