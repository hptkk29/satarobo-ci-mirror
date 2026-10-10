"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Menu, X, Phone, ChevronRight, ArrowRight, LogIn } from "lucide-react";
import { SATA_ROBO_PHONE } from "@/lib/locations";

// F-UI-4 — Right-slide drawer cho mobile. Replace mobile half của
// <Header /> (Sheet trigger trước đó). Nav data dùng slug thực tế
// trong repo (laptrinhrobot / luyenthirobosim) — KHÔNG dùng spec stub
// SP1/SP2/SP3 (route chưa tồn tại).
interface NavChild {
  label: string;
  href: string;
}

interface NavItem {
  label: string;
  href: string;
  children?: NavChild[];
}

const NAV_ITEMS: NavItem[] = [
  { label: "Trang chủ", href: "/" },
  { label: "Về chúng tôi", href: "/ve-chung-toi" },
  {
    label: "Khoá học",
    href: "/khoa-hoc",
    children: [
      { label: "Lập trình Robot (offline)", href: "/khoa-hoc/laptrinhrobot" },
      {
        label: "Luyện thi RoboSim (online)",
        href: "/khoa-hoc/luyenthirobosim",
      },
      { label: "Tất cả khoá học", href: "/khoa-hoc" },
    ],
  },
  // Ẩn tạm theo hồ sơ BCT mục 4 — trang 404 bằng app/(public)/hoc-cu/layout.tsx.
  // Bỏ comment CÙNG LÚC với mục tương ứng ở components/public/header.tsx, nếu không ca
  // [PUBLIC-NAV-T02] sẽ đỏ vì hai cây điều hướng lệch nhau.
  // { label: "Học cụ", href: "/hoc-cu" },
  { label: "Tin tức", href: "/tin-tuc" },
  { label: "Tuyển dụng", href: "/tuyen-dung" },
  { label: "Liên hệ", href: "/lien-he" },
];

export function MobileNavDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  /** `createPortal` cần `document` — server không có. Xem khối chú thích ở chỗ dùng. */
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setIsOpen(false);
    setExpandedItem(null);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Mở menu"
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-neutral-700 transition-colors hover:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/*
        ⚠️ LỚP PHỦ PHẢI ĐI QUA PORTAL RA `document.body` — ĐỪNG BỎ, ĐÂY LÀ BẢN VÁ CỦA MỘT LỖI
        HIỂN THỊ THẬT (13/09/2026), và nhìn mã thì nó vô hình.

        Drawer này được mount BÊN TRONG `components/public/header.tsx`, mà header đó mang
        `backdrop-blur`. Theo spec Filter Effects, một element có `backdrop-filter` khác `none`
        trở thành KHỐI CHỨA cho mọi con `position: fixed`. Đo thật trong trình duyệt:

            tổ tiên chặn = <header>, backdropFilter = blur(8px), cao = 65px

        Hệ quả: `inset-0` của nền mờ và `h-full` của panel tính theo hộp 65px của header thay vì
        theo màn hình ⇒ panel cụt giữa chừng, nền mờ không phủ hết trang, và `<nav flex-1>` bị
        bóp còn CHIỀU CAO 0 — 7 mục menu vẫn nằm nguyên trong DOM nhưng không ai thấy. Triệu
        chứng nhìn hệt như "drawer mở ra mà trống", nên rất dễ đi tìm nhầm ở `NAV_ITEMS`.

        Portal đưa lớp phủ ra thẳng `<body>`, nên nó thoát khỏi mọi tổ tiên bị lọc/biến hình.
        Cách này giữ nguyên thiết kế kính mờ của header — gỡ `backdrop-blur` cũng chữa được
        nhưng đó là đổi nhận diện của cả site public để vá một lỗi bố cục.

        `mounted` là để `createPortal` chỉ chạy sau khi gắn: trên server không có `document`.
      */}
      {mounted &&
        createPortal(
          <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden"
              onClick={() => setIsOpen(false)}
              aria-hidden
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 z-50 flex h-full w-[85vw] max-w-sm flex-col bg-white shadow-2xl lg:hidden"
              role="dialog"
              aria-label="Menu điều hướng"
            >
              <div className="flex items-center justify-between border-b border-gray-100 p-4">
                <Link
                  href="/"
                  onClick={() => setIsOpen(false)}
                  aria-label="Sata Robo — Trang chủ"
                  className="flex items-center"
                >
                  <Image
                    src="/brand/logo-satarobo.jpg"
                    alt="Sata Robo"
                    width={160}
                    height={48}
                    className="h-9 w-auto object-contain"
                  />
                </Link>
                <button
                  onClick={() => setIsOpen(false)}
                  aria-label="Đóng menu"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-gray-100"
                >
                  <X className="h-5 w-5 text-gray-600" />
                </button>
              </div>

              <nav className="flex-1 overflow-y-auto p-4">
                <ul className="space-y-1">
                  {NAV_ITEMS.map((item) => {
                    const active = isActive(item.href);
                    const isExpanded = expandedItem === item.label;
                    const hasChildren = !!item.children?.length;
                    return (
                      <li key={item.href}>
                        {hasChildren ? (
                          <>
                            <button
                              onClick={() =>
                                setExpandedItem(isExpanded ? null : item.label)
                              }
                              aria-expanded={isExpanded}
                              className={`flex w-full items-center justify-between rounded-lg p-3 font-medium transition-colors ${
                                active
                                  ? "bg-orange-50 text-orange-700"
                                  : "text-gray-700 hover:bg-gray-50"
                              }`}
                            >
                              <span>{item.label}</span>
                              <ChevronRight
                                className={`h-4 w-4 transition-transform ${
                                  isExpanded ? "rotate-90" : ""
                                }`}
                              />
                            </button>
                            <AnimatePresence>
                              {isExpanded && (
                                <motion.ul
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="ml-4 mt-1 space-y-1 overflow-hidden border-l-2 border-orange-100 pl-2"
                                >
                                  {item.children!.map((child) => (
                                    <li key={child.href}>
                                      <Link
                                        href={child.href}
                                        onClick={() => setIsOpen(false)}
                                        className={`block rounded p-2 text-sm transition-colors ${
                                          pathname === child.href
                                            ? "font-semibold text-orange-600"
                                            : "text-gray-600 hover:bg-orange-50 hover:text-orange-600"
                                        }`}
                                      >
                                        {child.label}
                                      </Link>
                                    </li>
                                  ))}
                                </motion.ul>
                              )}
                            </AnimatePresence>
                          </>
                        ) : (
                          <Link
                            href={item.href}
                            onClick={() => setIsOpen(false)}
                            className={`block rounded-lg p-3 font-medium transition-colors ${
                              active
                                ? "bg-orange-50 text-orange-700"
                                : "text-gray-700 hover:bg-gray-50"
                            }`}
                          >
                            {item.label}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </nav>

              <div className="space-y-2 border-t border-gray-100 bg-gray-50 p-4">
                <Link
                  href="/lien-he?free-trial=true"
                  onClick={() => setIsOpen(false)}
                  className="cta-pulse cta-shine flex w-full items-center justify-center gap-2 rounded-full bg-gradient-sata-warm py-3 font-semibold text-white transition-opacity hover:opacity-90"
                >
                  Đặt buổi học thử
                  <ArrowRight className="h-4 w-4" />
                </Link>

                {/* ĐĂNG NHẬP — trước đây CHỈ có ở `components/public/header.tsx`, mà khối đó
                    mang `hidden lg:flex` ⇒ trên điện thoại KHÔNG có đường nào vào `/login` từ
                    site public. Drawer này là nửa mobile của chính cái header đó, nên mọi hành
                    động CHÍNH của header phải có mặt ở đây — có ca test canh đúng điều đó.
                    Tím violet-500 giữ đúng bản desktop: đăng nhập là hành động THỨ CẤP, không
                    được cạnh tranh với CTA cam ở trên. */}
                <Link
                  href="/login"
                  onClick={() => setIsOpen(false)}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-violet-500 py-3 font-semibold text-white transition-colors hover:bg-violet-600"
                >
                  <LogIn className="h-4 w-4" />
                  Đăng nhập
                </Link>

                <a
                  href={`tel:${SATA_ROBO_PHONE.tho}`}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-orange-300 py-3 font-semibold text-orange-700 transition-colors hover:bg-orange-50"
                >
                  <Phone className="h-4 w-4" />
                  {SATA_ROBO_PHONE.hien}
                </a>
              </div>
            </motion.aside>
          </>
        )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
