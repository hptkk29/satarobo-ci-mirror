import Link from "next/link";
import Image from "next/image";
import {
  SATA_ROBO_CONTACT,
  SATA_ROBO_PHONE,
  operationalLocations,
} from "@/lib/locations";
import { LEGAL_PAGES, LEGAL_INDEX_SLUG, legalHref } from "@/lib/legal-pages";
import { CongTyBlock } from "@/components/public/cong-ty-block";
import { GIO_LAM_VIEC } from "@/components/public/gio-lam-viec";
import { cn } from "@/lib/utils";

// Chân trang của giao diện public mới (artifact "Website mới"): hai logo + mascot, 4 cột liên hệ,
// dải chính sách, dải chữ chạy, dòng bản quyền. Giữ ĐỦ nội dung pháp lý của repo:
// khối pháp nhân (CongTyBlock: MST, cơ quan cấp, huy hiệu BCT) và 10 chính sách bắt buộc sinh từ
// `lib/legal-pages.ts` (KHÔNG gõ tay nhãn — hướng dẫn BCT đòi ghi đúng tên).

const COT_LIEN_KET = "var(--muted)";
const lienKet = { color: COT_LIEN_KET, textDecoration: "none" } as const;

const KHOA_HOC_LINKS = [
  { label: "Sata1 · Sata2 · Luyện thi", href: "/khoa-hoc/luyenthirobosim" },
  { label: "Sata3 · Alpha", href: "/khoa-hoc/sata3" },
  { label: "Sata4 · Sata6 · Beta", href: "/khoa-hoc/sata4" },
  { label: "Sata5 · Sata7 · AI & IoT", href: "/khoa-hoc/sata5" },
];

const SOCIAL = [
  { label: "Facebook", href: SATA_ROBO_CONTACT.facebook },
  { label: "TikTok", href: SATA_ROBO_CONTACT.tiktok },
  { label: "YouTube", href: SATA_ROBO_CONTACT.youtube },
  { label: "Zalo", href: SATA_ROBO_PHONE.zalo },
];

function chayChu() {
  return (
    <div className="mq-track">
      <span>SATA ROBO</span>
      <span style={{ color: "#fe8f2d" }}>✦</span>
      <span>Nhà sáng chế robot nhí</span>
      <span style={{ color: "#fe8f2d" }}>✦</span>
      <span>SATA ROBO</span>
      <span style={{ color: "#fe8f2d" }}>✦</span>
      <span>Robotics &amp; AI Đà Nẵng</span>
    </div>
  );
}

export function SiteFooter({ className }: { className?: string } = {}) {
  const coSo = operationalLocations();
  return (
    <footer
      className={cn("gridbg", className)}
      style={{ borderTop: "1px solid var(--line)", overflow: "hidden", backgroundColor: "var(--bg2)", position: "relative" }}
    >
      <div className="wrap" style={{ paddingTop: 48, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 24, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <span style={{ background: "#ffffff", borderRadius: 20, padding: "10px 14px", boxShadow: "0 10px 24px var(--shadow)", display: "inline-flex" }}>
            <Image
              src="/pub/071eb890bef5414d06fbf3b2706502f3.png"
              alt="Sata Robo"
              width={972}
              height={994}
              style={{ width: 120, height: "auto", display: "block" }}
            />
          </span>
          <div>
            <p style={{ margin: 0, fontFamily: "var(--font-unbounded), 'Unbounded', sans-serif", fontWeight: 600, fontSize: "clamp(22px,2.4vw,32px)", lineHeight: 1.2 }}>
              <span style={{ color: "#fe8f2d" }}>SATA</span> <span style={{ color: "var(--purT)" }}>ROBO</span>
            </p>
            <p style={{ margin: "6px 0 0", color: "var(--muted)", maxWidth: 440 }}>
              Trung tâm Robotics &amp; AI cho trẻ lớp 1–8 tại Đà Nẵng. Giờ làm việc: {GIO_LAM_VIEC}.
            </p>
          </div>
        </div>
        <Image
          className="bob xs-hide"
          src="/pub/da7446f042256bc74bcdfe2e701329c9.webp"
          alt=""
          aria-hidden="true"
          width={642}
          height={714}
          style={{ width: 140, height: "auto", filter: "drop-shadow(0 14px 18px rgba(0,0,0,.3))" }}
        />
      </div>

      <div className="wrap foot" style={{ paddingTop: 36, paddingBottom: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, color: "var(--muted)" }}>
          {coSo.map((c, i) => (
            <div key={c.code} style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: i === 0 ? 0 : 8 }}>
              <strong style={{ color: "var(--text)" }}>{c.code} — {c.name.replace(/^Cơ sở \d+ - /, "")}</strong>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Sata Robo ${c.address}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: COT_LIEN_KET }}
              >
                {c.address}
              </a>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <strong>Khoá học</strong>
          {KHOA_HOC_LINKS.map((l) => (
            <Link key={l.href} href={l.href} style={lienKet}>
              {l.label}
            </Link>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <strong>Sata Robo</strong>
          <Link href="/ve-chung-toi" style={lienKet}>Về chúng tôi</Link>
          <Link href="/tin-tuc" style={lienKet}>Tin tức</Link>
          <Link href="/tuyen-dung" style={lienKet}>Tuyển dụng</Link>
          <Link href="/lien-he" style={lienKet}>Liên hệ</Link>
          <Link href={legalHref(LEGAL_INDEX_SLUG)} style={lienKet}>Chính sách</Link>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, color: "var(--muted)" }}>
          <strong style={{ color: "var(--text)" }}>{SATA_ROBO_CONTACT.companyName.replace("Công ty Cổ phần", "CTCP")}</strong>
          <span>MST {SATA_ROBO_CONTACT.businessCode}</span>
          <a href={`tel:${SATA_ROBO_PHONE.tho}`} style={{ color: COT_LIEN_KET }}>{SATA_ROBO_PHONE.hien}</a>
          <a href={`mailto:${SATA_ROBO_CONTACT.emails.general}`} style={{ color: COT_LIEN_KET }}>{SATA_ROBO_CONTACT.emails.general}</a>
          <span>{GIO_LAM_VIEC}</span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
            {SOCIAL.map((s) => (
              <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" style={{ color: COT_LIEN_KET }}>
                {s.label}
              </a>
            ))}
          </span>
        </div>
      </div>

      {/* Thông tin pháp nhân bắt buộc (hồ sơ Bộ Công Thương): MST, cơ quan cấp, ngày cấp, địa chỉ, huy hiệu. */}
      <div className="wrap" style={{ paddingBottom: 18, color: "var(--muted)" }}>
        <CongTyBlock />
      </div>

      <nav className="wrap pol-links" aria-label="Chính sách & điều khoản">
        <Link href={legalHref(LEGAL_INDEX_SLUG)}>Chính sách của website</Link>
        {LEGAL_PAGES.map((p) => (
          <Link key={p.slug} href={legalHref(p.slug)}>
            {p.label}
          </Link>
        ))}
        <Link href="/dieu-khoan-su-dung">Điều khoản sử dụng</Link>
        <Link href="/quyen-rieng-tu">Quyền riêng tư</Link>
      </nav>

      <div style={{ borderTop: "1px solid var(--line)", overflow: "hidden", position: "relative" }}>
        <div
          className="marquee-big"
          aria-hidden="true"
          style={{ display: "flex", gap: 48, whiteSpace: "nowrap", fontFamily: "var(--font-unbounded), 'Unbounded', sans-serif", fontWeight: 600, fontSize: "clamp(56px,9vw,128px)", lineHeight: 1.3, letterSpacing: "-0.04em", color: "var(--line2)" }}
        >
          {chayChu()}
          {chayChu()}
        </div>
      </div>
      <p className="mono" style={{ margin: 0, textAlign: "center", fontSize: 11, color: "var(--muted)", padding: "14px 20px 100px" }}>
        © {new Date().getFullYear()} {SATA_ROBO_CONTACT.shortName} · Bảo lưu mọi quyền
      </p>
    </footer>
  );
}
