import type { Metadata } from "next";
import { TrangLapTrinhRobot } from "@/components/public/khoa-hoc/trang-nhom";
import { BASE_URL } from "@/components/public/khoa-hoc/khoa-hoc-thuan";
import { layGiaNiemYet } from "@/components/public/khoa-hoc/khoa-hoc-loader";
import { THU_TU_KHOA_NAM } from "@/components/public/khoa-hoc/noi-dung-khoa";
import { dinhDangTien } from "@/lib/gia-cong-khai";
import { giaThangTuNam } from "@/components/public/khoa-hoc/khoa-hoc-thuan";

// Học phí và ưu đãi đọc từ DB — làm mới mỗi 60s (cùng nhịp với trang danh sách).
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const gia = (await Promise.all(THU_TU_KHOA_NAM.map((s) => layGiaNiemYet(s)))).filter((g): g is number => !!g);
  const tu = gia.length ? `học phí từ ${dinhDangTien(Math.min(...gia.map(giaThangTuNam)))}/tháng` : "học thử 1-1 miễn phí";
  const tieuDe = "Lập trình Robot – Lộ trình 5 năm | Khoá học Robotics Sata Robo Đà Nẵng";
  const moTa = `Lập trình Robot Lộ trình 5 năm: Lớp 1–8, 48 buổi/năm · 72 giờ/năm, ${tu}. Học thử 1-1 miễn phí.`;
  const url = `${BASE_URL}/khoa-hoc/laptrinhrobot`;
  return {
    title: { absolute: tieuDe },
    description: moTa,
    robots: { index: true, follow: true, "max-image-preview": "large" },
    alternates: { canonical: url },
    openGraph: { type: "website", locale: "vi_VN", siteName: "Sata Robo", title: tieuDe, description: moTa, url },
    twitter: { card: "summary_large_image", title: tieuDe, description: moTa },
  };
}

export default function LapTrinhRobotPage() {
  return <TrangLapTrinhRobot />;
}
