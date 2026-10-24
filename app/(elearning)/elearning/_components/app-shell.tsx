"use client";

// Khung khu học tập nội bộ: thanh bên cố định (desktop, thu gọn được) / ngăn kéo (điện thoại) + thanh trên.
// Khuôn lấy từ `app/(teacher)/teacher/_components/app-shell.tsx` — hai site hành xử giống nhau, người dùng
// không phải học lại. Khác: ngăn kéo đóng thì `inert` (liên kết bên trong rời khỏi thứ tự Tab) và đóng bằng Esc.
//
// `.admin-scope` mang token tím/cam của DESIGN.md §1 (primary #610B8A, accent #FF8F2D). Khu này là khu QUẢN TRỊ nội
// bộ (eslint.config.mjs: "chuẩn admin"), nên dùng đúng token đó thay vì cam `:root` của site public.
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KhuMenu } from "./menu";
import { SidebarContent } from "./sidebar";
import { Topbar } from "./topbar";

/** Khoá localStorage cho trạng thái thu gọn — chỉ là tiện nghi từng người, không phải trạng thái cần giữ. */
const KHOA_THU_GON = "satarobo:elearning:thu-gon";

export function AppShell({
  userId,
  userName,
  khu,
  children,
}: {
  userId: string;
  userName: string;
  khu: KhuMenu[];
  children: React.ReactNode;
}) {
  const [ngan, setNgan] = useState(false);
  const [thuGon, setThuGon] = useState(false);

  // Đọc sau khi mount (không đọc ở khởi tạo: SSR luôn là bản mở rộng, đọc sớm là lệch hydrate).
  useEffect(() => {
    try {
      if (window.localStorage.getItem(KHOA_THU_GON) === "1") setThuGon(true);
    } catch {
      /* chế độ riêng tư / bị chặn: bỏ qua, vẫn dùng được */
    }
  }, []);

  const doiThuGon = useCallback(() => {
    setThuGon((v) => {
      const moi = !v;
      try {
        window.localStorage.setItem(KHOA_THU_GON, moi ? "1" : "0");
      } catch {
        /* như trên */
      }
      return moi;
    });
  }, []);

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
    <div className="admin-scope min-h-screen bg-muted print:bg-white">
      <a
        href="#noi-dung"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
      >
        Bỏ qua điều hướng, tới nội dung
      </a>

      {/* Thanh bên cố định — chỉ từ lg trở lên. `inert` khi ngăn kéo mở (xem ghi chú ở useEffect). */}
      <aside
        inert={ngan}
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden border-r border-border transition-[width] duration-200 lg:block print:hidden",
          thuGon ? "w-[4.5rem]" : "w-64",
        )}
      >
        <SidebarContent khu={khu} thuGon={thuGon} onToggleThuGon={doiThuGon} />
      </aside>

      {/* Ngăn kéo điện thoại. `inert` khi đóng: không nhận Tab, không nhận chuột. */}
      <div
        className={cn("fixed inset-0 z-40 lg:hidden", ngan ? "pointer-events-auto" : "pointer-events-none")}
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
          <SidebarContent khu={khu} onNavigate={() => setNgan(false)} />
        </div>
      </div>

      <div
        inert={ngan}
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-200 print:pl-0",
          thuGon ? "lg:pl-[4.5rem]" : "lg:pl-64",
        )}
      >
        <div className="sticky top-0 z-30 print:hidden">
          <Topbar userId={userId} userName={userName} khu={khu} onMenuClick={() => setNgan(true)} />
        </div>
        <div id="noi-dung" className="min-w-0 flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}
