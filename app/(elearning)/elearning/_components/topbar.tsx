"use client";

// Thanh trên khu học tập nội bộ: nút mở menu (điện thoại) · đường dẫn (khu › mục) · tìm khoá của tôi · chuông · tài khoản.
//
// ⚠️ Ô tìm KHÔNG hứa hơn những gì nó làm: nó tìm trong "Khoá của tôi" (GET /elearning/khoa-cua-toi?q=). Placeholder
// nói đúng như vậy — một ô "Tìm mọi thứ" mà chỉ tìm được khoá của mình là lời hứa suông (luật 12).
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronDown, LogOut, Menu, Search, ShieldCheck } from "lucide-react";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutToGate } from "@/lib/auth/logout-client";
import { elearningHref } from "@/lib/elearning/notification-href";
import { mucDangMo, type KhuMenu } from "./menu";
import { LienKet, laTrangBai } from "./lien-ket";

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
  khu,
  onMenuClick,
}: {
  userId: string;
  userName: string;
  khu: KhuMenu[];
  onMenuClick: () => void;
}) {
  const duongDan = usePathname() ?? "/elearning";
  // Rời trang bài bằng tải trang đầy đủ để bộ đo kịp gửi nhịp cuối — xem `lien-ket.tsx`.
  const toanTrang = laTrangBai(duongDan);
  const dangMo = mucDangMo(khu, duongDan);
  const khuHienTai = khu.find((k) => k.id === dangMo?.khu);
  const muc = khuHienTai?.muc.find((m) => m.href === dangMo?.href);

  return (
    <header className="flex h-16 items-center gap-2 border-b border-border bg-card px-4 sm:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Mở menu điều hướng"
        data-mo-menu
        className="-ml-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>

      {/* Đường dẫn co theo chỗ còn lại: 768–1023px (ngăn kéo, chưa có thanh bên) chỉ giữ MỤC đang mở; từ 1024px thêm khu;
          từ 1280px thêm "Học tập nội bộ". Không để nó chen ô tìm xuống còn một biểu tượng. */}
      <nav aria-label="Vị trí" className="hidden min-w-0 shrink text-sm md:block">
        <ol className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
          <li className="hidden xl:block">
            <LienKet href="/elearning" toanTrang={toanTrang} className="inline-flex min-h-6 items-center rounded hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              Học tập nội bộ
            </LienKet>
          </li>
          {khuHienTai && muc ? (
            <>
              <li aria-hidden className="hidden xl:block">/</li>
              <li className="hidden truncate lg:block">{khuHienTai.nhan}</li>
              <li aria-hidden className="hidden lg:block">/</li>
              <li className="truncate font-medium text-foreground" aria-current="page">
                {muc.nhan}
              </li>
            </>
          ) : (
            <li className="truncate font-medium text-foreground xl:hidden">Học tập nội bộ</li>
          )}
        </ol>
      </nav>

      <form
        action="/elearning/khoa-cua-toi"
        method="GET"
        role="search"
        className="ml-auto hidden min-w-[9rem] max-w-xs flex-1 sm:flex"
      >
        <div className="relative w-full">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            name="q"
            placeholder="Tìm trong khoá của tôi"
            aria-label="Tìm trong khoá của tôi"
            className="h-10 w-full rounded-lg border border-border bg-muted pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary focus:bg-card focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </form>

      <div className="ml-auto flex items-center gap-1 sm:ml-0 sm:gap-2">
        <NotificationBell
          userId={userId}
          resolveHref={elearningHref}
          viewAllHref="/elearning/thong-bao"
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Menu tài khoản"
            className="flex min-h-11 items-center gap-2 rounded-lg px-2 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                {chuCai(userName)}
              </AvatarFallback>
            </Avatar>
            <span className="hidden max-w-[10rem] truncate text-sm font-medium text-foreground lg:block">
              {userName}
            </span>
            <ChevronDown className="hidden h-4 w-4 text-muted-foreground lg:block" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem render={
                toanTrang ? <a href="/elearning/du-lieu-cua-toi" /> : <Link href="/elearning/du-lieu-cua-toi" />
              }
            >
              <ShieldCheck className="mr-2 h-4 w-4" aria-hidden /> Dữ liệu của tôi
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-state-danger-ink focus:text-state-danger-ink"
              onClick={() => logoutToGate()}
            >
              <LogOut className="mr-2 h-4 w-4" aria-hidden /> Đăng xuất
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
