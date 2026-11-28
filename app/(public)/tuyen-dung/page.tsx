import type { Metadata } from "next";
import { db } from "@/lib/db";
import { breadcrumbJsonLd, jsonLdScript } from "@/lib/seo/jsonld";
import { getPageImage, pageImages } from "@/lib/page-images";
import { SATA_ROBO_CONTACT } from "@/lib/locations";
import { dinhDangNgay } from "@/components/blog/tin-tuc-thuan";
import {
  CachUngTuyen,
  CtaTuyenDung,
  DauMuc,
  GuiCvChuDong,
  LyDoChon,
  MotNgayOSata,
  TuyenDungHero,
} from "@/components/jobs/tuyen-dung-khung";
import { ViTriDangTuyen } from "@/components/jobs/vi-tri-dang-tuyen";
import { bieuTuongViTri, dinhDangLuong, tomTatMoTa, type ViTriItem } from "@/components/jobs/viec-lam-thuan";

export const revalidate = 60;

const BASE_URL = "https://satarobo.vn";
const HR_EMAIL = SATA_ROBO_CONTACT.emails.recruitment;

export const metadata: Metadata = {
  title: "Tuyển dụng — Cơ hội nghề nghiệp tại Sata Robo",
  description:
    "Sata Robo tuyển dụng giáo viên Robotics, Tư vấn tuyển sinh, Kế toán, Marketing, Telesales tại Đà Nẵng. Lương cạnh tranh, đào tạo bài bản.",
  alternates: { canonical: `${BASE_URL}/tuyen-dung` },
  openGraph: {
    title: "Tuyển dụng — Sata Robo",
    description: "Gia nhập đội ngũ Sata Robo — nơi đam mê giáo dục và công nghệ gặp nhau.",
    url: `${BASE_URL}/tuyen-dung`,
    siteName: "Sata Robo",
    images: [{ url: pageImages.careers.src, width: 1600, height: 900 }],
  },
};

// Ảnh trên thẻ nhân viên ở đầu trang: ảnh nội bộ của giao diện mới; quản trị vẫn đổi được bằng
// khoá `hero-image-url` của trang "tuyen-dung" (SitePageContent) như trước.
const ANH_THE_NHAN_VIEN = {
  src: "/pub/85fbe2407f3b02e50e40d7e94d1c1bb3.jpg",
  alt: "Giáo viên kèm học viên",
};

export default async function TuyenDungPage() {
  // Ảnh đầu trang + danh sách tin độc lập nhau ⇒ chạy song song.
  const [anh, jobs] = await Promise.all([
    getPageImage("tuyen-dung", ANH_THE_NHAN_VIEN),
    db.jobPosting
      .findMany({
        where: { status: "OPEN" },
        orderBy: [{ updatedAt: "desc" }],
        select: {
          slug: true,
          title: true,
          department: true,
          location: true,
          type: true,
          salary: true,
          salaryMin: true,
          salaryMax: true,
          salaryNote: true,
          description: true,
          closesAt: true,
        },
      })
      .catch(() => []),
  ]);

  const items: ViTriItem[] = jobs.map((j) => ({
    slug: j.slug,
    title: j.title,
    boPhan: j.department,
    diaDiem: j.location,
    hinhThuc: j.type,
    luong: dinhDangLuong(j),
    tomTat: tomTatMoTa(j.description),
    hanNop: j.closesAt ? dinhDangNgay(j.closesAt) : null,
    bieuTuong: bieuTuongViTri(j.title, j.department),
  }));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd([
              { name: "Trang chủ", url: "/" },
              { name: "Tuyển dụng", url: "/tuyen-dung" },
            ]),
          ),
        }}
      />

      <TuyenDungHero email={HR_EMAIL} anh={anh} />

      <LyDoChon />

      <section id="vi-tri" className="sec gridbg" style={{ backgroundColor: "var(--bg2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
        <div className="wrap">
          <DauMuc so="02" nhan="Vị trí đang tuyển" tieuDe="Cơ hội tại" tieuDeNhan="Sata Robo" sticker="7e643cba294434d8258e05d15f9c242c" hieuUng="a-blur" />
          <p className="mono" style={{ margin: "-24px 0 22px", fontSize: 11, color: "var(--muted)" }}>
            Đang mở: {items.length} vị trí.
          </p>
          <ViTriDangTuyen items={items} email={HR_EMAIL} />
          <GuiCvChuDong email={HR_EMAIL} />
        </div>
      </section>

      <CachUngTuyen email={HR_EMAIL} />
      <MotNgayOSata />
      <CtaTuyenDung email={HR_EMAIL} />
    </>
  );
}
