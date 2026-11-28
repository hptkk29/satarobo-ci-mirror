import { notFound } from "next/navigation";
import { timHuongDan } from "@/lib/elearning/huong-dan";
import { HuongDanChiTiet } from "../../_components/huong-dan-view";

export const metadata = {
  title: "Hướng dẫn | Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Slug của khu quản trị mở bằng đường dẫn nhân viên ⇒ 404 (không lộ nội dung quản trị).
  if (!timHuongDan("nhan-vien", slug)) notFound();
  return <HuongDanChiTiet khu="nhan-vien" slug={slug} />;
}
