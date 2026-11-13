import type { ReactNode } from "react";
import Link from "next/link";
import { breadcrumbJsonLd, jsonLdScript } from "@/lib/seo/jsonld";
import { LEGAL_INDEX_SLUG } from "@/lib/legal-pages";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { danhSachChinhSach, tachTieuDeGradient } from "./danh-sach-chinh-sach";
import { DAU_TRANG } from "./dau-trang";
import { NutIn } from "./nut-in";
import "./phap-ly-bosung.css";

// Khung chung của khu "Chính sách" — CHÉP từ artifact `ChinhSach-*` (CSS riêng `chung.css`, nạp bởi PubRoot):
// đầu trang (đường dẫn · h1 · câu dẫn · ngày cập nhật · linh vật + nút in) + thanh bên 13 trang + vùng nội dung
// `.prose` + khối liên hệ `.inline-cta`. Hiệu ứng (`load2/load3/bob/sv a-mask/a-iris/float`) là CỦA ARTIFACT,
// do `PubFx` (fx.js) điều khiển; không thêm hiệu ứng nào artifact không có.
// Dùng bởi `PhapLyTrang` (11 văn bản .md), trang mục lục `/chinh-sach` và Trung tâm quyền riêng tư.
//
// Chữ ở đầu trang lấy từ `dau-trang.ts` (chép nguyên văn artifact); chưa có trong đó thì rơi về `title`/`subtitle`
// của từng trang. Ngày cập nhật là NGÀY THẬT trong file văn bản (artifact ghi ngày mẫu + "Admin chỉnh sửa…").

export function KhungChinhSach({
  slug,
  title,
  subtitle,
  breadcrumbLabel,
  ngayCapNhat,
  children,
  hienNutIn = true,
  hienLienHe = true,
}: {
  slug: string;
  title: string;
  subtitle: string;
  breadcrumbLabel: string;
  /** dd/mm/yyyy lấy từ chính file văn bản; không có ⇒ không in dòng ngày. */
  ngayCapNhat?: string | null;
  children: ReactNode;
  hienNutIn?: boolean;
  /** Khối "Còn thắc mắc về chính sách?" cuối bài (artifact không vẽ ở trang mục lục). */
  hienLienHe?: boolean;
}) {
  const laMucLuc = slug === LEGAL_INDEX_SLUG;
  const dau = DAU_TRANG[slug];
  const tachDuPhong = tachTieuDeGradient(title);
  const h1Dau = dau ? dau.dau : tachDuPhong.dau;
  const h1Grad = dau ? dau.grad : tachDuPhong.cuoi;
  const lead = dau ? dau.lead : subtitle;
  const tenTrongDuongDan = dau ? dau.crumb : breadcrumbLabel;
  const breadcrumb = breadcrumbJsonLd([
    { name: "Trang chủ", url: "/" },
    ...(laMucLuc ? [] : [{ name: "Chính sách", url: `/${LEGAL_INDEX_SLUG}` }]),
    { name: breadcrumbLabel, url: `/${slug}` },
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }} />

      <header className="gridbg" style={{ borderBottom: "1px solid var(--line)", position: "relative", overflow: "hidden" }}>
        <div className="glow" aria-hidden="true" style={{ width: "560px", height: "560px", right: "-160px", top: "-240px" }}></div>
        <div
          className="wrap"
          style={{
            paddingTop: "clamp(40px,5vw,64px)",
            paddingBottom: "32px",
            position: "relative",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "end",
            gap: "24px",
            flexWrap: "wrap",
          }}
        >
          <div className="load2" style={{ maxWidth: "760px" }}>
            <nav className="crumb" aria-label="Breadcrumb">
              <Link href="/">Trang chủ</Link>
              <span aria-hidden="true">/</span>
              {laMucLuc ? (
                <span aria-current="page">{tenTrongDuongDan}</span>
              ) : (
                <>
                  <Link href={`/${LEGAL_INDEX_SLUG}`}>Chính sách</Link>
                  <span aria-hidden="true">/</span>
                  <span aria-current="page">{tenTrongDuongDan}</span>
                </>
              )}
            </nav>
            <h1 style={{ fontSize: "clamp(30px,3.6vw,50px)" }}>
              {h1Dau ? <>{h1Dau}{" "}</> : null}
              <span className="grad">{h1Grad}</span>
            </h1>
            <p className="lead" style={{ margin: "12px 0 0", color: "var(--muted)" }}>
              {lead}
            </p>
            {ngayCapNhat ? (
              <p className="mono" style={{ margin: "12px 0 0", fontSize: "12px", color: "var(--muted)" }}>
                Cập nhật lần cuối: {ngayCapNhat}
              </p>
            ) : null}
          </div>
          <div className="load3" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {dau ? (
              <PubAnh id={dau.linhVat} className="bob" alt="" aria-hidden="true" style={{ height: "auto", width: "110px", position: "relative" }} sizes="110px" />
            ) : null}
            {hienNutIn ? <NutIn /> : null}
          </div>
        </div>
      </header>

      <section className="sec" style={{ paddingTop: "40px" }}>
        <div className="wrap">
          <div className="pol-grid">
            <nav className="pol-nav" aria-label="Các chính sách">
              <span className="mono" style={{ fontSize: "11px", color: "var(--muted)", padding: "4px 12px 8px" }}>
                Chính sách &amp; điều khoản
              </span>
              {danhSachChinhSach().map((m) => (
                <Link
                  key={m.slug}
                  href={m.href}
                  className={m.slug === slug ? "on" : undefined}
                  aria-current={m.slug === slug ? "page" : undefined}
                >
                  {m.label}
                </Link>
              ))}
            </nav>

            <article className="prose" style={{ maxWidth: "860px" }}>
              {children}
              {hienLienHe ? (
                <div className="inline-cta sv a-iris">
                  <PubAnh
                    id="2e4a9309e1a6bfcb633b68ee102428e9"
                    className="float"
                    alt=""
                    aria-hidden="true"
                    style={{ height: "auto", width: "90px", flexShrink: "0" }}
                    sizes="90px"
                  />
                  <div>
                    <p style={{ margin: "0", fontWeight: "700", fontSize: "18px" }}>Còn thắc mắc về chính sách?</p>
                    <p style={{ margin: "4px 0 12px", color: "#f3e4ff", fontSize: "14px" }}>
                      Gọi {SATA_ROBO_PHONE.hien} hoặc nhắn Zalo – Sata Robo phản hồi trong giờ làm việc.
                    </p>
                    <Link href="/lien-he" className="btn btn-acc">
                      Liên hệ ngay
                    </Link>
                  </div>
                </div>
              ) : null}
            </article>
          </div>
        </div>
      </section>
    </>
  );
}
