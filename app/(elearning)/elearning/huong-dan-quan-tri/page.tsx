import { congHuongDanQuanTri } from "../_components/huong-dan-quan-tri-cong";
import { HuongDanDanhSach } from "../_components/huong-dan-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Hướng dẫn quản trị | Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page() {
  return (await congHuongDanQuanTri()) ?? <HuongDanDanhSach khu="quan-tri" />;
}
