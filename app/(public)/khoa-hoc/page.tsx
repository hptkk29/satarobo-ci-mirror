import type { Metadata } from "next";
import "@/app/(public)/pub-design/khoa-hoc.css";
import { TrangDanhSach } from "@/components/public/khoa-hoc/trang-danh-sach";
import { BASE_URL } from "@/components/public/khoa-hoc/khoa-hoc-thuan";

const TIEU_DE = "Khoá học Robotics cho trẻ lớp 1–8 tại Đà Nẵng | Sata Robo";
const MO_TA =
  "Khoá học Robotics & AI cho trẻ lớp 1–8 tại Đà Nẵng: chuyên sâu 48 buổi Sata3–Sata7, luyện thi RoboSim, Sata8 cam kết hoàn tiền. Lớp tối đa 12 bạn, học thử miễn phí.";

export const metadata: Metadata = {
  title: { absolute: TIEU_DE },
  description: MO_TA,
  robots: { index: true, follow: true, "max-image-preview": "large" },
  alternates: { canonical: `${BASE_URL}/khoa-hoc` },
  openGraph: {
    type: "website",
    locale: "vi_VN",
    siteName: "Sata Robo",
    title: TIEU_DE,
    description: MO_TA,
    url: `${BASE_URL}/khoa-hoc`,
  },
  twitter: { card: "summary_large_image", title: TIEU_DE, description: MO_TA },
};

// Học phí / ưu đãi đọc từ DB: làm mới mỗi 60s để đổi giá ở admin hiện ra trong vòng 1 phút.
export const revalidate = 60;

export default function CoursesPage() {
  return <TrangDanhSach />;
}
