import { HuongDanDanhSach } from "../_components/huong-dan-view";

/** HƯỚNG DẪN SỬ DỤNG — nhân viên (P8). Chỉ là nội dung tĩnh trong khung nhân viên; đăng nhập do layout của khu gác. */
export const metadata = {
  title: "Hướng dẫn sử dụng | Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <HuongDanDanhSach khu="nhan-vien" />;
}
