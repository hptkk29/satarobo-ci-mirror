import type { ReactNode } from "react";
import Link from "next/link";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { PubThemeToggle } from "@/components/public/pub-theme-toggle";
import { LEGAL_INDEX_SLUG, legalHref } from "@/lib/legal-pages";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import "@/app/(public)/pub-design/xac-thuc.css";
import "./khung-bo-sung.css";

// Khung hai cột của Login / Activate / Forgot / Nhận kết quả DISC — CHÉP từ artifact (`.auth` > `aside.auth-art` + `.auth-main`).
// `tranh` là `<aside class="auth-art gridbg">…</aside>` của từng trang; `children` là nội dung `.auth-card`.
//
// ⚠️ Khác artifact có chủ ý: (1) thẻ mang thêm class `my-form` — lưới [BC-03] (tests/e2e/a0/auth-bo-cuc.spec.ts) đo hộp của nó;
// (2) dải cuối có thêm link "Chính sách của website" (mục lục 10 chính sách BCT phải tới được từ nơi người mua đứng, xem
// components/public/dai-link-phap-ly.tsx); (3) năm lấy từ giờ hiện tại thay cho "2026" gõ cứng; (4) Zalo lấy từ lib/locations.
// Dải này nằm TRONG DÒNG dưới thẻ (không `fixed`) — [BC-03].
export function KhungXacThuc({ tranh, children }: { tranh: ReactNode; children: ReactNode }) {
  return (
    <div className="auth">
      {tranh}
      <div className="auth-main">
        <div className="auth-top">
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: "10px", textDecoration: "none", color: "var(--text)" }}>
            <PubAnh id="7f3174f1b3c85f9cd78c9295c2624fe4" alt="Sata Robo" sizes="44px" priority style={{ width: "44px", height: "44px", borderRadius: "999px" }} />
            <span style={{ fontWeight: "700" }}>← Về trang chủ</span>
          </Link>
          <PubThemeToggle />
        </div>
        <div className="auth-card my-form">{children}</div>
        <p className="mono" style={{ margin: "18px 0 0", textAlign: "center", fontSize: "11px", color: "var(--muted)" }}>
          © {new Date().getFullYear()} Sata Robo ·{" "}
          <Link href={legalHref(LEGAL_INDEX_SLUG)} style={{ color: "var(--muted)" }}>
            Chính sách của website
          </Link>{" "}
          ·{" "}
          <Link href={legalHref("chinh-sach-bao-mat")} data-to="/chinh-sach-bao-mat" style={{ color: "var(--muted)" }}>
            Chính sách bảo mật
          </Link>{" "}
          ·{" "}
          <Link href={legalHref("dieu-khoan-su-dung")} data-to="/dieu-khoan-su-dung" style={{ color: "var(--muted)" }}>
            Điều khoản
          </Link>{" "}
          · Cần hỗ trợ?{" "}
          <a href={SATA_ROBO_PHONE.zalo} style={{ color: "var(--muted)" }}>
            Zalo
          </a>
        </p>
      </div>
    </div>
  );
}
