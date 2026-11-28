"use client";

// Khung QUẢN TRỊ của khu học tập nội bộ — theo `03-quan-tri/QtKhoaHoc.html`: thanh bên cố định 260px (từ 1001px) / ngăn kéo (≤ 1000px) + thanh trên.
// Khuôn ngăn kéo lấy từ `app/(teacher)/teacher/_components/app-shell.tsx`. Khác: ngăn kéo đóng thì `inert` (liên kết bên trong rời khỏi thứ tự Tab) và đóng bằng Esc.
//
// `.admin-scope` + `.elearning-root` (nền, token, sáng/tối) do `ElearningThemeRoot` ở layout mang — xem elearning-theme.tsx.
// Thiết kế KHÔNG có nút thu gọn thanh bên nên đã bỏ (V4, 19/11/2026) — thanh bên là điều hướng chính của khu, luôn đủ chữ.
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KhuMenu } from "./menu";
import { SidebarContent } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({
  userId,
  userName,
  vaiTro,
  phamVi,
  khu,
  chuyenKhu,
  children,
}: {
  userId: string;
  userName: string;
  /** Chú thích avatar ("Đào tạo · CS1"). */
  vaiTro?: string;
  /** "Phạm vi dữ liệu" ở đáy thanh bên. */
  phamVi?: string;
  khu: KhuMenu[];
  /** Lối sang khung nhân viên (menu tài khoản). */
  chuyenKhu?: { href: string; nhan: string };
  children: React.ReactNode;
}) {
  const [ngan, setNgan] = useState(false);

  // Ngăn kéo mở: đưa tiêu điểm vào nút Đóng, Esc để đóng; đóng xong trả tiêu điểm về nút mở menu. Phần còn lại của trang
  // `inert` trong lúc mở ⇒ Tab không thoát ra phía sau (bẫy tiêu điểm bản địa, không cần thư viện).
  const daMoNgan = useRef(false);
  useEffect(() => {
    if (!ngan) {
      if (daMoNgan.current) {
        daMoNgan.current = false;
        document.querySelector<HTMLElement>("[data-mo-menu]")?.focus();
      }
      return;
    }
    daMoNgan.current = true;
    document.querySelector<HTMLElement>("[data-dong-menu]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNgan(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ngan]);

  return (
    <div className="min-h-screen print:bg-white">
      {/* `inert` khi ngăn kéo mở: link này nằm NGOÀI vùng inert của nền nên trước đây vẫn nhận Tab — từ phần tử cuối của ngăn kéo,
          Tab rơi ra đây rồi mới quay lại, nên MỖI vòng Tab đều đi qua "Bỏ qua điều hướng" (và Enter nhảy nền phía sau modal). */}
      <a
        href="#noi-dung"
        inert={ngan}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
      >
        Bỏ qua điều hướng, tới nội dung
      </a>

      {/* Thanh bên cố định — chỉ từ 1001px. `inert` khi ngăn kéo mở (xem ghi chú ở useEffect). */}
      <aside
        inert={ngan}
        className="fixed inset-y-0 left-0 z-30 hidden w-[260px] border-r border-border min-[1001px]:block print:hidden"
      >
        <SidebarContent khu={khu} phamVi={phamVi} />
      </aside>

      {/* Ngăn kéo (≤ 1000px). `inert` khi đóng: không nhận Tab, không nhận chuột. */}
      <div
        className={cn("fixed inset-0 z-40 min-[1001px]:hidden", ngan ? "pointer-events-auto" : "pointer-events-none")}
        inert={!ngan}
      >
        <div
          className={cn(
            "absolute inset-0 bg-foreground/40 transition-opacity duration-200",
            ngan ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setNgan(false)}
          aria-hidden
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu điều hướng"
          className={cn(
            "absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-border shadow-xl transition-transform duration-200",
            ngan ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <button
            type="button"
            onClick={() => setNgan(false)}
            aria-label="Đóng menu"
            data-dong-menu
            className="absolute right-3 top-3 z-10 inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
          <SidebarContent khu={khu} phamVi={phamVi} onNavigate={() => setNgan(false)} />
        </div>
      </div>

      <div inert={ngan} className="flex min-h-screen flex-col min-[1001px]:pl-[260px] print:pl-0">
        <div className="sticky top-0 z-30 print:hidden">
          <Topbar userId={userId} userName={userName} vaiTro={vaiTro} khu={khu} chuyenKhu={chuyenKhu} onMenuClick={() => setNgan(true)} />
        </div>
        <div id="noi-dung" className="min-w-0 flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}
