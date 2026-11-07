import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TrangKhoa } from "@/components/public/khoa-hoc/trang-khoa";
import { TAT_CA_SLUG_KHOA, layGiaNiemYet, layHocPhan } from "@/components/public/khoa-hoc/khoa-hoc-loader";
import { BASE_URL, moTaMetaKhoa, nhanGia, tongBuoiCuaKhoa } from "@/components/public/khoa-hoc/khoa-hoc-thuan";
import { NOI_DUNG_KHOA } from "@/components/public/khoa-hoc/noi-dung-khoa";

// Học phí đọc từ DB (Course.price / CoursePackage) — làm mới mỗi 60s để đổi giá ở admin hiện ra sớm.
export const revalidate = 60;

// Hai khoá có trang riêng (khoa-hoc/laptrinhrobot, khoa-hoc/luyenthirobosim) — segment tĩnh thắng
// segment động nên không bao giờ vào đây; chặn thêm cho chắc.
const DANH_RIENG = new Set(["laptrinhrobot", "luyenthirobosim"]);

export function generateStaticParams() {
  return TAT_CA_SLUG_KHOA.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug: raw } = await params;
  const slug = raw.toLowerCase();
  const nd = NOI_DUNG_KHOA[slug];
  if (!nd) return { title: "Không tìm thấy khóa học | Sata Robo" };
  const gia = await layGiaNiemYet(slug);
  const tong = tongBuoiCuaKhoa(layHocPhan(nd));
  const moTa = moTaMetaKhoa(nd, tong, gia ? nhanGia(nd.loai, gia).ngan : "liên hệ tư vấn");
  const url = `${BASE_URL}/khoa-hoc/${slug}`;
  return {
    title: { absolute: nd.trang.metaTitle },
    description: moTa,
    robots: { index: true, follow: true, "max-image-preview": "large" },
    alternates: { canonical: url },
    openGraph: { type: "website", locale: "vi_VN", siteName: "Sata Robo", title: nd.trang.metaTitle, description: moTa, url },
    twitter: { card: "summary_large_image", title: nd.trang.metaTitle, description: moTa },
  };
}

export default async function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await params;
  const slug = raw.toLowerCase();
  if (DANH_RIENG.has(slug) || !NOI_DUNG_KHOA[slug]) notFound();
  return <TrangKhoa slug={slug} />;
}
