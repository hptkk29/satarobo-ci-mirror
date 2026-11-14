import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isDiscEnabled } from "@/lib/flags";
import { DISC_ENGINE_READY } from "@/lib/disc/trang-thai";
import { layEngine } from "@/lib/disc/engine";
import { ensureDiscEngine } from "@/lib/disc/engine-dang-ky";
import { namHienTaiVN } from "@/lib/disc/ho-so";
import { boCauHoiTheoDoTuoi } from "@/components/public/disc/bo-cau-hoi";
import { GioiThieuDisc } from "@/components/public/disc/gioi-thieu";
import { breadcrumbJsonLd, jsonLdScript } from "@/lib/seo/jsonld";

// Cờ đọc từ env lúc CHẠY, không bake vào bản dựng: trang phải động.
export const dynamic = "force-dynamic";

const BASE_URL = "https://satarobo.vn";

export const metadata: Metadata = {
  title: "Khám phá DISC — Hiểu xu hướng hành vi của cả gia đình | Sata Robo",
  description:
    "Bài khám phá DISC miễn phí giúp ba mẹ và con hiểu cách mỗi người thường phản ứng, giao tiếp và học hỏi. Không phải chẩn đoán tâm lý hay đánh giá năng lực.",
  alternates: { canonical: `${BASE_URL}/disc` },
  openGraph: {
    title: "Khám phá DISC — Sata Robo",
    description: "Hiểu xu hướng hành vi của ba mẹ và con để đồng hành tốt hơn.",
    url: `${BASE_URL}/disc`,
    siteName: "Sata Robo",
    type: "website",
  },
};

// Giao diện theo artifact "Disc" (components/public/disc/). Trang chỉ chọn dữ liệu: số câu / thang trả lời lấy từ ĐỘNG CƠ
// (không có động cơ ⇒ không vẽ bảng "Bộ câu hỏi" và ô "Thử một câu", không dựng số liệu giả).
// `now` tiêm được để test; mặc định giờ thật (luật [DISC-QA-CLOCK-02]: giờ thật chỉ là MẶC ĐỊNH của `now`).
function duLieuTrang(now: Date = new Date()) {
  const engine = layEngine();
  const namNay = namHienTaiVN(now);
  const boCauHoi = engine ? boCauHoiTheoDoTuoi(engine, namNay) : null;
  const boPh = engine?.chonBoDe({ vai: "PH", namSinh: namNay - 38, namNay }) ?? null;
  const thangThu = boPh?.thang && boPh.thang.length > 0 ? boPh.thang.map((m) => m.nhan) : null;
  return { boCauHoi, thangThu };
}

export default function DiscLandingPage() {
  if (!isDiscEnabled()) notFound();
  ensureDiscEngine();

  const { boCauHoi, thangThu } = duLieuTrang();

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd([{ name: "Trang chủ", url: BASE_URL }, { name: "Khám phá DISC", url: `${BASE_URL}/disc` }])) }} />
      <GioiThieuDisc moBai={DISC_ENGINE_READY} boCauHoi={boCauHoi} thangThu={thangThu} />
    </>
  );
}
