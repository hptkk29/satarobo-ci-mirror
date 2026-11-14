// app/(portal)/portal/disc/[id]/page.tsx — chi tiết MỘT lần làm DISC. Chỉ đọc.
//
// IDOR: id lạ, id của người khác, bài chưa nhận, bài đã xoá ⇒ đều `notFound()` (cùng 404, không phân biệt).
// Quyền đọc nằm ở `docChiTietLuot(userId, id)`: `claimedUserId = userId` lấy từ PHIÊN.
import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";

import { PageHero } from "@/components/portal/page-header";
import { QuyenDuLieuDisc } from "@/components/disc-portal/quyen-du-lieu-disc";
import { ChiTietLuotDisc } from "@/components/disc-portal/chi-tiet-luot-disc";
import { docChiTietLuot, dungBaoCaoHtmlChoLuot } from "@/lib/disc/portal-doc";

import { yeuCauPhienDisc } from "../_lib/phien-disc";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Chi tiết kết quả DISC | Sata Robo",
  robots: { index: false },
};

export default async function DiscChiTietPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await yeuCauPhienDisc();
  const { id } = await params;
  const luot = await docChiTietLuot(userId, id);
  if (!luot) notFound();
  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHero icon={Sparkles} overline="Khám phá DISC" title="Kết quả DISC" subtitle="Chi tiết từng thành viên trong lần làm bài này" />
      <ChiTietLuotDisc luot={luot} coBaoCao={dungBaoCaoHtmlChoLuot(luot) !== null} />
      <QuyenDuLieuDisc idLuot={luot.id} choPhepTai={false} />
    </div>
  );
}
