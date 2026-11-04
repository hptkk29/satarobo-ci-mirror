"use client";

import Link from "next/link";
import Image from "next/image";
import { Phone, Mail, MapPin, Plus } from "lucide-react";
import {
  SATA_ROBO_CONTACT,
  SATA_ROBO_PHONE,
  operationalLocations,
  upcomingLocations,
} from "@/lib/locations";
import { LEGAL_PAGES, LEGAL_INDEX_SLUG, legalHref } from "@/lib/legal-pages";
import { CongTyBlock } from "@/components/public/cong-ty-block";

// F-UI-4 — New footer. 4-col desktop / 1-col accordion mobile.
// Địa chỉ lấy từ SATA_ROBO_LOCATIONS (vẫn 2 cơ sở); SĐT và Zalo là MỘT số chung của công
// ty, `SATA_ROBO_PHONE`, từ 24/09/2026 — trước đó mỗi cơ sở một số riêng.
const SECTIONS = [
  {
    title: "Khoá học",
    links: [
      { label: "Lập trình Robot (offline)", href: "/khoa-hoc/laptrinhrobot" },
      {
        label: "Luyện thi RoboSim (online)",
        href: "/khoa-hoc/luyenthirobosim",
      },
      { label: "Tất cả khoá học", href: "/khoa-hoc" },
      // Ẩn tạm theo hồ sơ BCT mục 4 — xem app/(public)/hoc-cu/layout.tsx.
      // { label: "Học cụ STEM", href: "/hoc-cu" },
    ],
  },
  {
    title: "Sata Robo",
    links: [
      { label: "Về chúng tôi", href: "/ve-chung-toi" },
      { label: "Tin tức & Blog", href: "/tin-tuc" },
      { label: "Tuyển dụng", href: "/tuyen-dung" },
      { label: "Liên hệ", href: "/lien-he" },
    ],
  },
  {
    title: "Hỗ trợ",
    links: [
      { label: `Chat Zalo (${SATA_ROBO_PHONE.hien})`, href: SATA_ROBO_PHONE.zalo },
      { label: "Câu hỏi thường gặp", href: "/lien-he" },
    ],
  },
  {
    // 10 chính sách bắt buộc của hồ sơ Bộ Công Thương, sinh từ nguồn dùng chung
    // `lib/legal-pages.ts`. KHÔNG gõ tay nhãn ở đây: hướng dẫn BCT đòi "ghi đúng tên",
    // và chính chân trang này từng gọi cùng một trang bằng hai tên khác nhau
    // ("Chính sách bảo mật" ở cột, "Bảo mật" ở dải copyright bên dưới).
    title: "Chính sách",
    links: LEGAL_PAGES.map((p) => ({ label: p.label, href: legalHref(p.slug) })),
  },
];

const SOCIAL_LINKS = [
  {
    label: "Facebook",
    href: SATA_ROBO_CONTACT.facebook,
    bg: "bg-[#1877F2] hover:bg-[#0e64d3]",
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 fill-white"
        aria-hidden="true"
      >
        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
      </svg>
    ),
  },
  {
    label: "TikTok",
    href: SATA_ROBO_CONTACT.tiktok,
    bg: "bg-black hover:bg-neutral-800",
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 fill-white"
        aria-hidden="true"
      >
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.75a4.85 4.85 0 0 1-1.01-.06z" />
      </svg>
    ),
  },
  {
    label: "YouTube",
    href: SATA_ROBO_CONTACT.youtube,
    bg: "bg-[#FF0000] hover:bg-[#cc0000]",
    icon: (
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 fill-white"
        aria-hidden="true"
      >
        <path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.4 2.8 12 2.8 12 2.8s-4.4 0-6.8.2c-.6 0-1.9.1-3 1.3C1.3 5 1 7 1 7S.7 9.3.7 11.5v2.1c0 2.2.3 4.4.3 4.4s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.5 22.1 12 22.1 12 22.1s4.4 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.2.3-4.4v-2.1C23.3 9.3 23 7 23 7zM9.7 15.5V8.4l6.5 3.6-6.5 3.5z" />
      </svg>
    ),
  },
  {
    label: "Zalo",
    href: SATA_ROBO_PHONE.zalo,
    bg: "bg-[#0068FF] hover:bg-[#0050cc]",
    icon: (
      <span
        className="text-[10px] font-black leading-none text-white"
        aria-hidden="true"
      >
        Zalo
      </span>
    ),
  },
];

function isExternal(href: string) {
  return /^https?:\/\//.test(href);
}

export function SiteFooter() {
  const ops = operationalLocations().length;
  const upcoming = upcomingLocations().length;

  return (
    <footer className="bg-zinc-950 text-gray-300">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3 lg:grid-cols-5 lg:gap-12">
          {/* Brand column */}
          <div>
            <Link
              href="/"
              aria-label="Sata Robo — Trang chủ"
              className="mb-4 inline-flex items-center rounded-xl bg-white px-3 py-2 shadow-sm transition-shadow hover:shadow-md"
            >
              <Image
                src="/brand/logo-satarobo.jpg"
                alt="Sata Robo"
                width={160}
                height={48}
                className="h-10 w-auto object-contain"
              />
            </Link>
            <p className="mb-4 text-sm leading-relaxed text-gray-400">
              Trung tâm đào tạo STEM – Lập trình Robotics & AI – Sata Robo.
              {ops > 0 ? ` ${ops} cơ sở đang hoạt động` : ""}
              {upcoming > 0 ? ` · ${upcoming} sắp khai trương` : ""}.
            </p>
            <div className="space-y-3 text-sm">
              {/* Số điện thoại nằm NGOÀI vòng lặp cơ sở [24/09/2026] — một số cho cả công
                  ty. Để bên trong là in ra hai lần, mỗi cơ sở một lần. */}
              <a
                href={`tel:${SATA_ROBO_PHONE.tho}`}
                className="flex items-center gap-2 transition-colors hover:text-orange-400"
              >
                <Phone className="h-4 w-4 text-orange-400" />
                {SATA_ROBO_PHONE.hien}
              </a>
              {operationalLocations().map((c) => (
                <div key={c.code} className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
                    {c.code} — {c.name}
                  </p>
                  <div className="flex items-start gap-2 text-gray-400">
                    <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-400" />
                    <span>{c.address}</span>
                  </div>
                </div>
              ))}
              <a
                href={`mailto:${SATA_ROBO_CONTACT.emails.general}`}
                className="flex items-center gap-2 break-all transition-colors hover:text-orange-400"
              >
                <Mail className="h-4 w-4 flex-shrink-0 text-orange-400" />
                {SATA_ROBO_CONTACT.emails.general}
              </a>
            </div>
          </div>

          {/* Link sections — 2 render trees để giữ state đúng theo viewport:
              - Mobile (< md): <details> default closed, user tap để mở.
              - Desktop (≥ md): plain block luôn hiển thị.
              Tách 2 cây tránh tình trạng "đóng trên mobile xong resize
              desktop vẫn đóng" của approach 1-tree-with-CSS. */}
          {SECTIONS.map((section) => {
            const renderLinks = (
              <ul className="space-y-2">
                {section.links.map((link) => (
                  <li key={link.href}>
                    {isExternal(link.href) ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-gray-400 transition-colors hover:text-orange-400"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-gray-400 transition-colors hover:text-orange-400"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            );
            return (
              <div key={section.title}>
                {/* Mobile accordion — default đóng (không có `open` attr) */}
                <details className="group border-b border-gray-800 pb-3 md:hidden">
                  <summary className="flex list-none cursor-pointer items-center justify-between py-2">
                    <h3 className="font-semibold text-white">
                      {section.title}
                    </h3>
                    <Plus className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-45" />
                  </summary>
                  <div className="pt-3">{renderLinks}</div>
                </details>

                {/* Desktop block — luôn hiển thị, không có toggle */}
                <div className="hidden md:block">
                  <h3 className="mb-4 font-semibold text-white">
                    {section.title}
                  </h3>
                  {renderLinks}
                </div>
              </div>
            );
          })}
        </div>

        {/* Social + Trust */}
        <div className="mt-12 flex flex-col items-start justify-between gap-6 border-t border-gray-800 pt-8 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">Theo dõi:</span>
            {SOCIAL_LINKS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.label}
                className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${s.bg}`}
              >
                {s.icon}
              </a>
            ))}
          </div>
          <CongTyBlock className="max-w-md text-gray-400 sm:text-right" />
        </div>
      </div>

      {/* Copyright bar */}
      <div className="border-t border-gray-800 bg-zinc-900">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 text-xs text-gray-400 sm:flex-row sm:px-6 lg:px-8">
          <p>
            © {new Date().getFullYear()} {SATA_ROBO_CONTACT.shortName}. Bảo lưu
            mọi quyền.
          </p>
          {/* Dải này TRƯỚC 21/09/2026 có 4 nhãn VIẾT TẮT ("Điều khoản", "Bảo mật", "Hoàn
              trả") — không nhãn nào khớp tên bắt buộc của hồ sơ BCT, và cùng một trang lại
              mang tên khác với cột "Chính sách" phía trên. Nay chỉ còn một lối vào mục lục,
              nơi in đủ 10 tên đúng; hết chỗ cho tên trôi. */}
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href={legalHref(LEGAL_INDEX_SLUG)}
              className="transition-colors hover:text-orange-400"
            >
              Chính sách của website
            </Link>
            <Link
              href="/dieu-khoan-su-dung"
              className="transition-colors hover:text-orange-400"
            >
              Điều khoản sử dụng
            </Link>
            <Link
              href="/quyen-rieng-tu"
              className="transition-colors hover:text-orange-400"
            >
              Quyền riêng tư
            </Link>
          </div>
        </div>
      </div>

      {/* Mobile bottom padding để StickyMobileCta không che footer cuối */}
      <div className="h-20 lg:hidden" aria-hidden />
    </footer>
  );
}
