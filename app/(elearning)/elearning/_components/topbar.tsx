"use client";

// Thanh trên QUẢN TRỊ — dựng theo `03-quan-tri/QtKhoaHoc.html` (`.hdr`): đường dẫn "Quản trị / nhóm / mục" · chuông · "Sang khu học tập" (biểu tượng) · avatar.
// ≤ 1000px thanh bên biến mất: thương hiệu + nút "Menu" (mở ngăn kéo) lên thanh trên, đường dẫn xuống hàng dưới.
//
// SAI KHÁC CÓ CHỦ ĐÍCH (DECISIONS.md D-20): thiết kế có ô "Tìm trong quản trị" và biểu tượng "Hướng dẫn sử dụng" — chưa có chức năng tìm cho khu quản trị và chưa có
// route hướng dẫn (P8) nên KHÔNG vẽ (một ô tìm không tìm được là lời hứa suông, luật 12). Avatar mở MENU (Dữ liệu của tôi · giao diện · Đăng xuất) thay vì chỉ là chữ.
import { usePathname } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { CircleHelp, Database, ExternalLink, LogOut, Menu, Monitor, Moon, Sun } from "lucide-react";
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
import { mucDangMo, type KhuMenu } from "./menu";
import { nhomThanhBen, viTriTrongThanhBen } from "./nhom-thanh-ben";

function chuCai(ten: string): string {
  const t = ten.trim().split(/\s+/).filter(Boolean);
  if (t.length === 0) return "?";
  const dau = t[0]?.[0] ?? "";
  const cuoi = t.length > 1 ? (t[t.length - 1]?.[0] ?? "") : "";
  return (dau + cuoi).toUpperCase();
}

export function Topbar({
  userId,
  userName,
  vaiTro,
  khu,
  chuyenKhu,
  onMenuClick,
}: {
  userId: string;
  userName: string;
  /** Chú thích avatar: "Đào tạo · CS1" (hồ sơ nhân sự thật). */
  vaiTro?: string;
  khu: KhuMenu[];
  chuyenKhu?: { href: string; nhan: string };
  onMenuClick: () => void;
}) {
  const duongDan = usePathname() ?? "/elearning";
  // Rời trang bài bằng tải trang đầy đủ để bộ đo kịp gửi nhịp cuối — xem `lien-ket.tsx`.
  const toanTrang = laTrangBai(duongDan);
  const dangMo = mucDangMo(khu, duongDan);
  const nhom = nhomThanhBen(khu);
  const viTri = dangMo ? viTriTrongThanhBen(nhom, dangMo.href) : null;
  const diemVao = nhom[0]?.muc[0]?.href ?? "/elearning";
  const { theme, resolved, setTheme } = useElearningTheme();

  return (
    <header className="flex min-h-14 flex-wrap items-center gap-2 border-b border-border bg-background px-[clamp(16px,4vw,40px)] max-[1000px]:min-h-12">
      <LienKet
        href="/elearning"
        toanTrang={toanTrang}
        aria-label="Cổng Elearning · Sata Robo — trang tổng quan"
        className="mr-auto hidden items-center gap-2.5 rounded-lg py-2 text-primary-ink outline-none focus-visible:ring-2 focus-visible:ring-ring max-[1000px]:flex"
      >
        <Image src="/brand/logo-satarobo-tron.png" alt="" width={32} height={32} className="size-8 flex-none rounded-full" />
        <span className="whitespace-nowrap text-[15px] font-medium leading-[18px]">
          Cổng Elearning
          <span className="block text-[13px] font-normal leading-4 text-[color:var(--el-text2)]">Sata Robo</span>
        </span>
      </LienKet>

      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Mở menu điều hướng"
        data-mo-menu
        className="hidden h-8 items-center justify-center gap-2 rounded-lg border border-input bg-card px-3 text-[13px] font-medium text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring max-[1000px]:inline-flex"
      >
        <Menu className="size-[18px]" aria-hidden />
        Menu
      </button>

      {/* Đường dẫn. ≤ 1000px xuống hàng riêng (thiết kế: `.hdr` flex-wrap). */}
      <nav aria-label="Đường dẫn" className="min-w-0 flex-1 max-[1000px]:order-last max-[1000px]:basis-full max-[1000px]:pb-2">
        <ol className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <li>
            <LienKet href={diemVao} toanTrang={toanTrang} className="rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              Quản trị
            </LienKet>
          </li>
          {viTri ? (
            <>
              <li aria-hidden>/</li>
              {viTri.nhom ? (
                <>
                  <li className="font-medium text-foreground">{viTri.nhom}</li>
                  <li aria-hidden>/</li>
                </>
              ) : null}
              <li aria-current="page" className="font-medium text-foreground">
                {viTri.nhan}
              </li>
            </>
          ) : null}
        </ol>
      </nav>

      <div className="flex items-center gap-1">
        {/* P8 — biểu tượng trợ giúp theo thiết kế: dẫn tới hướng dẫn quản trị (có thật, không phải lời hứa suông). */}
        <Link
          href="/elearning/huong-dan-quan-tri"
          aria-label="Hướng dẫn sử dụng"
          title="Hướng dẫn sử dụng"
          className="inline-flex size-10 items-center justify-center rounded-[10px] text-[color:var(--el-text2)] outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring max-[720px]:hidden"
        >
          <CircleHelp className="size-5" strokeWidth={1.5} aria-hidden />
        </Link>
        <NotificationBell userId={userId} resolveHref={elearningHref} viewAllHref="/elearning/thong-bao" />
        {chuyenKhu ? (
          <Link
            href={chuyenKhu.href}
            aria-label={chuyenKhu.nhan}
            title={chuyenKhu.nhan}
            className="inline-flex size-10 items-center justify-center rounded-[10px] text-[color:var(--el-text2)] outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring max-[720px]:hidden"
          >
            <ExternalLink className="size-5" strokeWidth={1.5} aria-hidden />
          </Link>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Menu tài khoản"
            title={[userName, vaiTro].filter(Boolean).join(" · ")}
            className="flex min-h-11 items-center rounded-[10px] px-1.5 outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden
              className={cn("inline-flex size-8 flex-none items-center justify-center rounded-full bg-secondary text-xs font-medium text-[color:var(--el-text2)]")}
            >
              {chuCai(userName)}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[260px] max-w-[calc(100vw-2rem)] rounded-[14px] p-2">
            <div className="px-2.5 pb-2.5 pt-2 text-sm leading-[18px] text-foreground">
              <span className="block truncate">{userName}</span>
              {vaiTro ? <span className="block truncate text-xs text-muted-foreground">{vaiTro}</span> : null}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={toanTrang ? <a href="/elearning/du-lieu-cua-toi" /> : <Link href="/elearning/du-lieu-cua-toi" />}>
              <Database className="mr-2 size-4" aria-hidden /> Dữ liệu của tôi
            </DropdownMenuItem>
            {chuyenKhu ? (
              <DropdownMenuItem render={<Link href={chuyenKhu.href} />}>
                <ExternalLink className="mr-2 size-4" aria-hidden /> {chuyenKhu.nhan}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}>
              {resolved === "dark" ? <Sun className="mr-2 size-4" aria-hidden /> : <Moon className="mr-2 size-4" aria-hidden />}
              {resolved === "dark" ? "Giao diện sáng" : "Giao diện tối"}
            </DropdownMenuItem>
            {theme !== "system" ? (
              <DropdownMenuItem onClick={() => setTheme("system")}>
                <Monitor className="mr-2 size-4" aria-hidden /> Theo hệ thống
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem className="text-state-danger-ink focus:text-state-danger-ink" onClick={() => logoutToGate()}>
              <LogOut className="mr-2 size-4" aria-hidden /> Đăng xuất
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
