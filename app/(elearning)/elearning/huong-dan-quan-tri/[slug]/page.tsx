import { notFound } from "next/navigation";
import { timHuongDan } from "@/lib/elearning/huong-dan";
import { congHuongDanQuanTri } from "../../_components/huong-dan-quan-tri-cong";
import { HuongDanChiTiet } from "../../_components/huong-dan-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Hướng dẫn quản trị | Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const chan = await congHuongDanQuanTri();
  if (chan) return chan;
  // Slug của khu nhân viên mở bằng đường dẫn quản trị ⇒ 404.
  if (!timHuongDan("quan-tri", slug)) notFound();
  return <HuongDanChiTiet khu="quan-tri" slug={slug} />;
}
