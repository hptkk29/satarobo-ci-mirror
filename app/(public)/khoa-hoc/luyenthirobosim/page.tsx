import type { Metadata } from "next";
import { TrangLuyenThiOnline } from "@/components/public/khoa-hoc/trang-nhom";
import { BASE_URL } from "@/components/public/khoa-hoc/khoa-hoc-thuan";

// Nội dung và học phí của khoá online lấy từ dữ liệu bảng R1/R2 trong repo — làm mới mỗi 5 phút.
export const revalidate = 300;

const TIEU_DE = "Online · SataWorld – Luyện thi RoboSim Bảng R1 & R2 | Khoá học Robotics Sata Robo Đà Nẵng";
const MO_TA =
  "Online · SataWorld Luyện thi RoboSim Bảng R1 & R2: R1: lớp 3–5 · R2: lớp 6–9, 18 buổi · 9 giờ, học phí 490.000đ/bảng. Học thử 1-1 miễn phí.";

export const metadata: Metadata = {
  title: { absolute: TIEU_DE },
  description: MO_TA,
  robots: { index: true, follow: true, "max-image-preview": "large" },
  alternates: { canonical: `${BASE_URL}/khoa-hoc/luyenthirobosim` },
  openGraph: { type: "website", locale: "vi_VN", siteName: "Sata Robo", title: TIEU_DE, description: MO_TA, url: `${BASE_URL}/khoa-hoc/luyenthirobosim` },
  twitter: { card: "summary_large_image", title: TIEU_DE, description: MO_TA },
};

export default function LuyenThiRoboSimPage() {
  return <TrangLuyenThiOnline />;
}
