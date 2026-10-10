"use client";

// Phase 4.UI.RESET.1 — emails switched to thongtin@/tuyendung@satarobo.vn; HQ = 258 Lê Thanh Nghị.

import Image from "next/image";
import { Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { LEGAL_PAGES, LEGAL_INDEX_SLUG, legalHref } from "@/lib/legal-pages";
import { CongTyBlock } from "@/components/public/cong-ty-block";

// Inline SVG icons — Facebook + Youtube not exported by this lucide-react version
function Facebook({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}
function Youtube({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}
import { locations } from "./_data/locations";

export default function Footer() {
  const hqLocation = locations.find((l) => l.isHQ) || locations[0];

  return (
    <footer className="bg-text-dark text-white pt-10 pb-5 sm:pt-14 sm:pb-6">
      <div className="container-site">
        {/* Mobile: compact 2-section layout */}
        <div className="sm:hidden mb-8">
          <div className="flex items-center justify-between mb-5 pb-5 border-b border-white/10">
            <div>
              <Image
                src="/brand/logo-satarobo.jpg"
                alt="Sata Robo"
                className="h-10 w-auto object-contain bg-white rounded-lg p-1.5"
                width={140}
                height={40}
              />
              <p className="text-xs text-gray-400 italic mt-1.5">&ldquo;Khơi Nguồn Sáng Tạo&rdquo;</p>
            </div>
            <div className="flex gap-2">
              <a href="https://facebook.com/Satarobo" target="_blank" rel="noopener noreferrer" aria-label="Facebook"
                className="w-9 h-9 rounded-lg bg-white/10 hover:bg-primary-orange flex items-center justify-center transition">
                <Facebook className="w-4 h-4" />
              </a>
              <a href="https://www.youtube.com/@SataRobo" target="_blank" rel="noopener noreferrer" aria-label="Youtube"
                className="w-9 h-9 rounded-lg bg-white/10 hover:bg-primary-orange flex items-center justify-center transition">
                <Youtube className="w-4 h-4" />
              </a>
              <a href={SATA_ROBO_PHONE.zalo} target="_blank" rel="noopener noreferrer" aria-label="Zalo Sata Robo"
                className="w-9 h-9 rounded-lg bg-white/10 hover:bg-primary-purple flex items-center justify-center transition">
                <MessageCircle className="w-4 h-4" />
              </a>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mb-5">
            <div>
              <h4 className="font-black text-xs uppercase tracking-wider text-primary-orange mb-3">Chương Trình</h4>
              <ul className="space-y-2 text-xs text-gray-300">
                <li><a href="#roadmap" className="hover:text-primary-orange transition">Lộ Trình 5 Năm</a></li>
                <li><a href="#awards" className="hover:text-primary-orange transition">Sata Robo Championship</a></li>
                <li><a href="#gifts" className="hover:text-primary-orange transition">Ưu Đãi & Quà Tặng</a></li>
                <li><a href="/khoa-hoc/luyenthirobosim" className="hover:text-primary-orange transition">Luyện Thi RoboSim →</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-black text-xs uppercase tracking-wider text-primary-orange mb-3">Liên Hệ</h4>
              <ul className="space-y-2 text-xs text-gray-300">
                <li className="flex items-center gap-1.5">
                  <Phone className="w-3 h-3 text-primary-orange flex-shrink-0" />
                  <a href={`tel:${SATA_ROBO_PHONE.tho}`} className="hover:text-primary-orange transition">{SATA_ROBO_PHONE.hien}</a>
                </li>
                <li className="flex items-center gap-1.5">
                  <Mail className="w-3 h-3 text-primary-orange flex-shrink-0" />
                  <a href="mailto:thongtin@satarobo.vn" className="hover:text-primary-orange transition text-[10px]">thongtin@satarobo.vn</a>
                </li>
                <li className="flex items-start gap-1.5">
                  <MapPin className="w-3 h-3 text-primary-orange flex-shrink-0 mt-0.5" />
                  <span className="text-[10px] leading-tight">211 Nguyễn Hữu Thọ, Đà Nẵng</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-primary-orange flex-shrink-0" />
                  <span>T2–T7: 8:00–20:00</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Desktop: 4-column layout */}
        <div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
          <div className="lg:col-span-1">
            <div className="flex items-center mb-4">
              <Image
                src="/brand/logo-satarobo.jpg"
                alt="Sata Robo"
                className="h-14 w-auto object-contain bg-white rounded-xl p-2"
                width={180}
                height={56}
              />
            </div>
            <p className="text-sm text-gray-300 italic mb-4 leading-relaxed">
              &ldquo;Khơi Nguồn Sáng Tạo<br />Chắp Cánh Tương Lai&rdquo;
            </p>
            <p className="text-xs text-gray-400 leading-relaxed">
              Tiên phong Robotics giáo dục tại Đà Nẵng.
            </p>
            {/* Khối pháp nhân đầy đủ theo hướng dẫn BCT mục 2 (tên HOA · mã số doanh nghiệp
                kèm cơ quan cấp + ngày cấp · địa chỉ đầy đủ · 2 số điện thoại · email). */}
            <CongTyBlock className="mt-4 text-gray-400" />
            <div className="flex gap-3 mt-5">
              <a href="https://facebook.com/Satarobo" target="_blank" rel="noopener noreferrer" aria-label="Facebook"
                className="w-9 h-9 rounded-lg bg-white/10 hover:bg-primary-orange flex items-center justify-center transition">
                <Facebook className="w-4 h-4" />
              </a>
              <a href="https://www.youtube.com/@SataRobo" target="_blank" rel="noopener noreferrer" aria-label="Youtube"
                className="w-9 h-9 rounded-lg bg-white/10 hover:bg-primary-orange flex items-center justify-center transition">
                <Youtube className="w-4 h-4" />
              </a>
              <a href={SATA_ROBO_PHONE.zalo} target="_blank" rel="noopener noreferrer" aria-label="Zalo Sata Robo"
                className="w-9 h-9 rounded-lg bg-white/10 hover:bg-primary-purple flex items-center justify-center transition">
                <MessageCircle className="w-4 h-4" />
              </a>
            </div>
          </div>

          <div>
            <h4 className="font-black text-sm uppercase tracking-wider text-primary-orange mb-4">Về Học Viện</h4>
            <ul className="space-y-2.5 text-sm text-gray-300">
              <li><a href="#" className="hover:text-primary-orange transition">Triết Lý Đào Tạo</a></li>
              <li><a href="#teaching-method" className="hover:text-primary-orange transition">Phương Pháp Giảng Dạy</a></li>
              <li><a href="#" className="hover:text-primary-orange transition">Đội Ngũ Giảng Viên</a></li>
              <li><a href="#commitment" className="hover:text-primary-orange transition">Cam Kết Minh Bạch</a></li>
              <li><a href="#testimonials" className="hover:text-primary-orange transition">Phụ Huynh Nói Gì</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-black text-sm uppercase tracking-wider text-primary-orange mb-4">Chương Trình</h4>
            <ul className="space-y-2.5 text-sm text-gray-300">
              <li><a href="#roadmap" className="hover:text-primary-orange transition">Lộ Trình 5 Năm</a></li>
              <li><a href="/khoa-hoc/luyenthirobosim" className="hover:text-primary-orange transition">Khoá Luyện Thi RoboSim →</a></li>
              <li><a href="#awards" className="hover:text-primary-orange transition">Sata Robo Championship</a></li>
              <li><a href="#gifts" className="hover:text-primary-orange transition">Ưu Đãi & Quà Tặng</a></li>
              <li><a href="#locations" className="hover:text-primary-orange transition">2 Cơ Sở Đà Nẵng</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-black text-sm uppercase tracking-wider text-primary-orange mb-4">Liên Hệ</h4>
            <ul className="space-y-3 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <Phone className="w-4 h-4 text-primary-orange flex-shrink-0 mt-0.5" />
                <a href={`tel:${SATA_ROBO_PHONE.tho}`} className="hover:text-primary-orange transition">Zalo / Hotline: {SATA_ROBO_PHONE.hien}</a>
              </li>
              <li className="flex items-start gap-2">
                <Mail className="w-4 h-4 text-primary-orange flex-shrink-0 mt-0.5" />
                <a href="mailto:thongtin@satarobo.vn" className="hover:text-primary-orange transition">thongtin@satarobo.vn</a>
              </li>
              <li className="flex items-start gap-2">
                <Mail className="w-4 h-4 text-primary-purple flex-shrink-0 mt-0.5" />
                <a href="mailto:tuyendung@satarobo.vn" className="hover:text-primary-purple transition">tuyendung@satarobo.vn</a>
              </li>
              <li className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-primary-orange flex-shrink-0 mt-0.5" />
                <span>{hqLocation.address}</span>
              </li>
              <li className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-primary-orange flex-shrink-0 mt-0.5" />
                <span>T2 – T7: 8:00 – 20:00</span>
              </li>
            </ul>
          </div>
        </div>

        {/* 10 chính sách bắt buộc của hồ sơ BCT — HÀNG RIÊNG full-width, không nhét vào
            hàng copyright bên dưới: hàng đó là `justify-between` một dòng và KHÔNG có
            `flex-wrap`, nên 10 link sẽ tràn ngang cả desktop lẫn điện thoại.
            Chân trang này có hai cây markup (mobile/desktop) nhưng dải đáy dùng chung,
            nên đặt ở đây là sửa MỘT chỗ. */}
        <nav
          aria-label="Chính sách của website"
          className="border-t border-white/10 pt-4 sm:pt-6"
        >
          <ul className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs text-gray-400 sm:grid-cols-2 lg:grid-cols-3">
            {LEGAL_PAGES.map((p) => (
              <li key={p.slug}>
                <a href={legalHref(p.slug)} className="hover:text-primary-orange transition">
                  {p.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-white/10 mt-4 pt-4 sm:pt-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-400">
          <div>
            © 2026{" "}
            <strong className="text-white">
              Công ty Cổ phần Công nghệ Giáo dục Sata Robo
            </strong>
            .
          </div>
          <div className="flex items-center gap-3">
            <a href={legalHref(LEGAL_INDEX_SLUG)} className="hover:text-primary-orange transition">
              Chính sách của website
            </a>
            <span>|</span>
            <a href="/dieu-khoan-su-dung" className="hover:text-primary-orange transition">
              Điều khoản sử dụng
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
