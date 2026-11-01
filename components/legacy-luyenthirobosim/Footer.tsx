"use client";

import Image from "next/image";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { LEGAL_PAGES, LEGAL_INDEX_SLUG, legalHref } from "@/lib/legal-pages";
import { CongTyBlock } from "@/components/public/cong-ty-block";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer role="contentinfo">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Image
              src="/brand/logo-satarobo.jpg"
              alt="Logo Sata Robo"
              className="footer-brand-logo"
              loading="lazy"
              width={72}
              height={72}
            />
            <p className="footer-brand__desc">
              Sata Robo — Đơn vị luyện thi Robotics chuyên biệt.<br />
              Khoá Luyện Thi RBT2026 dành cho học sinh Tiểu học và THCS toàn quốc.
            </p>
            {/* Khối pháp nhân theo hướng dẫn BCT mục 2 — ảnh minh hoạ trong file hướng dẫn
                khoanh ĐỎ đúng cột thương hiệu này.
                ⚠️ PHẢI là phần tử ANH EM của `.footer-brand__desc`, KHÔNG đặt bên trong nó:
                `_styles/legacy.css` ẩn `.footer-brand__desc` ở ≤480px, nhét vào trong là
                thông tin pháp nhân biến mất trên điện thoại — đúng thứ hồ sơ đòi phải có.
                `block` để không bị `.footer-brand` (flex-row ở ≤480px) xếp ngang cạnh logo. */}
            <CongTyBlock className="footer-brand__legal block" />
          </div>

          <nav aria-label="Khoá học">
            <h4>Khoá học</h4>
            <ul className="footer-links">
              <li>
                <a href="#courses">
                  <span className="fi">🟦</span> Khoá Luyện Thi R1 — Tiểu học
                </a>
              </li>
              <li>
                <a href="#courses">
                  <span className="fi">🟪</span> Khoá Luyện Thi R2 — THCS
                </a>
              </li>
              <li>
                <a href="#faq">
                  <span className="fi">❓</span> Câu hỏi thường gặp
                </a>
              </li>
              <li>
                <a
                  href="https://sataworld.vn"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <span className="fi">🌐</span> sataworld.vn
                </a>
              </li>
            </ul>
          </nav>

          <address>
            <h4>Liên hệ</h4>
            <ul className="footer-links">
              <li>
                <a href={`tel:${SATA_ROBO_PHONE.tho}`} aria-label="Gọi Sata Robo">
                  <span className="fi">📞</span> {SATA_ROBO_PHONE.hien}
                </a>
              </li>
              <li>
                <a
                  href={SATA_ROBO_PHONE.zalo}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Chat Zalo Sata Robo"
                >
                  <span className="fi">💬</span> Zalo {SATA_ROBO_PHONE.hien}
                </a>
              </li>
              <li>
                <a href="mailto:thongtin@satarobo.vn" aria-label="Gửi email cho Sata Robo">
                  <span className="fi">✉️</span> thongtin@satarobo.vn
                </a>
              </li>
              <li className="footer-hide-mobile">
                <a
                  href="https://maps.google.com/?q=211+Nguy%E1%BB%85n+H%E1%BB%AFu+Th%E1%BB%8D,+%C4%90%C3%A0+N%E1%BA%B5ng"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Xem địa chỉ Sata Robo trên Google Maps"
                >
                  {/* Đã gỡ nhãn "(Trụ sở chính)": hướng dẫn BCT cấm chú thích đó sau địa chỉ
                      kinh doanh, và nhãn này còn sai sự thật — trụ sở đăng ký của pháp nhân
                      MST 0402301783 là 258 Lê Thanh Nghị (đo từ hoá đơn thật). */}
                  <span className="fi">📍</span> 211 Nguyễn Hữu Thọ, Đà Nẵng
                </a>
              </li>
              <li>
                <a
                  href="http://facebook.com/Satarobo"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Facebook Sata Robo"
                >
                  <span className="fi">📘</span> Facebook: Sata Robo
                </a>
              </li>
            </ul>
          </address>
        </div>

        <div className="footer-bottom">
          <p>
            © {year}{" "}
            <a href="https://sataworld.vn/" rel="noopener noreferrer" target="_blank">
              Sata Robo
            </a>.
            {" "}Tất cả quyền được bảo lưu.
          </p>
          <p>
            <a href={legalHref(LEGAL_INDEX_SLUG)}>Chính sách của website</a>
            {" | "}
            <a href="/dieu-khoan-su-dung">Điều khoản sử dụng</a>
          </p>
        </div>

        {/* 10 chính sách bắt buộc. Đặt thành NAV riêng dưới dải copyright thay vì thêm cột
            thứ 4 vào `.footer-grid` — cột thứ 4 buộc phải sửa `grid-template-columns` và cả
            ba breakpoint trong legacy.css (file CSS global dùng chung cho toàn landing). */}
        <nav aria-label="Chính sách của website" className="footer-legal-nav">
          <ul className="footer-links">
            {LEGAL_PAGES.map((p) => (
              <li key={p.slug}>
                <a href={legalHref(p.slug)}>{p.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
