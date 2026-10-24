import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronRight, MessageCircle, Sparkles as SparklesIcon } from "lucide-react";
import { db } from "@/lib/db";
import { breadcrumbJsonLd, jsonLdScript } from '@/lib/seo/jsonld';
import { HeroParticles } from "@/components/design-system/heroes/hero-particles";
import { SectionBase } from "@/components/design-system/sections/section-base";
import { CTAPrimary } from "@/components/design-system/ctas/cta-primary";
import { CTASecondary } from "@/components/design-system/ctas/cta-secondary";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { tokens } from "@/lib/design-tokens";

const BASE_URL = "https://satarobo.vn";

export const metadata: Metadata = {
  title: "Học cụ Robotics ZMROBO | Sata Robo",
  description:
    "3 bộ học cụ Robotics ZMROBO chính hãng tại Sata Robo: Alpha Set (nhập môn), Beta Set (thi đấu), Intelligence Storm (AI nâng cao).",
  alternates: { canonical: `${BASE_URL}/hoc-cu` },
  openGraph: {
    title: "Học cụ Robotics ZMROBO — Sata Robo",
    description: "3 bộ học cụ chính hãng: Alpha / Beta / Intelligence Storm.",
    url: `${BASE_URL}/hoc-cu`,
    siteName: "Sata Robo",
  },
};

export const revalidate = 60;

type KitSpecs = { pieces?: string; age?: string; [k: string]: unknown };

const accents: { bg: string; border: string; text: string; btn: string }[] = [
  {
    bg: "from-orange-50 to-amber-50",
    border: "border-orange-200",
    text: "text-orange-600",
    btn: "bg-orange-500 hover:bg-orange-600",
  },
  {
    bg: "from-purple-50 to-violet-50",
    border: "border-purple-200",
    text: "text-purple-600",
    btn: "bg-purple-500 hover:bg-purple-600",
  },
  {
    bg: "from-blue-50 to-sky-50",
    border: "border-blue-200",
    text: "text-blue-600",
    btn: "bg-blue-500 hover:bg-blue-600",
  },
];

export default async function HocCuPage() {
  const kits = await db.zMRoboKit
    .findMany({
      where: { isPublished: true },
      orderBy: { displayOrder: "asc" },
    })
    .catch(() => []);

  const breadcrumb = breadcrumbJsonLd([
    { name: "Trang chủ", url: "/" },
    { name: "Học cụ", url: "/hoc-cu" },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />

      <div className="bg-white border-b border-neutral-200 py-3">
        <div className={tokens.spacing.container}>
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1.5 text-sm text-neutral-500"
          >
            <Link href="/" className="hover:text-orange-600 transition-colors">
              Trang chủ
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-neutral-800 font-medium">Học cụ</span>
          </nav>
        </div>
      </div>

      {/* HERO SOFT-WARM */}
      <HeroParticles
        theme="soft-warm"
        eyebrow="HỌC CỤ"
        title="Học cụ Robotics ZMROBO chính hãng"
        subtitle="3 cấp độ học cụ phù hợp với mọi lứa tuổi — Từ nhập môn (6+) đến nâng cao AI"
        effects={{ particles: true, sparkles: true, glowOrbs: true, gridLines: false }}
      >
        <CTAPrimary href="#kits" size="lg">
          Xem 3 bộ học cụ
        </CTAPrimary>
        <CTASecondary href={SATA_ROBO_PHONE.zalo} size="lg">
          Chat Zalo
        </CTASecondary>
      </HeroParticles>

      {/* ABOUT ZMROBO */}
      <SectionBase
        theme="white"
        eyebrow="VỀ ZMROBO"
        title="Thương hiệu Robotics giáo dục hàng đầu thế giới"
      >
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <p className="text-lg text-neutral-700 leading-relaxed">
            <strong className="text-orange-600">ZMROBO</strong> (JoinMax Digital Technology Co., Ltd) thành lập năm 2002, chuyên về STEAM education, Robotics và AI. Với{" "}
            <strong>300+ patents</strong> và R&amp;D team mạnh, ZMROBO cung cấp giải pháp giáo dục K12 được sử dụng tại hàng nghìn trường quốc tế.
          </p>
          <p className="text-neutral-600">
            Sata Robo là{" "}
            <strong className="text-purple-700">đối tác phân phối chính thức</strong> của ZMROBO tại Đà Nẵng — cam kết hàng chính hãng, bảo hành đầy đủ, kèm chương trình đào tạo bài bản.
          </p>
        </div>
      </SectionBase>

      {/* 3 KITS DETAIL */}
      <section id="kits" className="bg-gradient-to-b from-white to-orange-50/30 py-16">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 mb-3 bg-orange-100 border border-orange-200 rounded-full px-4 py-1.5">
              <SparklesIcon className="w-4 h-4 text-orange-600" />
              <span className="text-xs font-bold uppercase tracking-wider text-orange-700">
                3 BỘ HỌC CỤ
              </span>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-neutral-900">
              Chọn bộ học cụ phù hợp với con bạn
            </h2>
          </div>
          {kits.length === 0 ? (
            <p className="text-center text-neutral-500 py-12">
              Đang cập nhật danh mục học cụ. Vui lòng liên hệ{" "}
              <a
                href={`tel:${SATA_ROBO_PHONE.tho}`}
                className="font-bold text-orange-600 hover:underline"
              >
                {SATA_ROBO_PHONE.hien}
              </a>{" "}
              để được tư vấn.
            </p>
          ) : (
            <div className="space-y-12 max-w-6xl mx-auto">
              {kits.map((kit, index) => {
                const accent = accents[index] ?? accents[0];
                const specs = (kit.specs ?? {}) as KitSpecs;
                const highlights = (kit.highlights ?? []) as string[];
                const isReverse = index % 2 === 1;
                const hasImage = Boolean(kit.mainImage);

                return (
                  <div
                    key={kit.id}
                    className={`bg-gradient-to-br ${accent.bg} rounded-3xl border-2 ${accent.border} overflow-hidden shadow-lg`}
                  >
                    <div className="grid grid-cols-1 lg:grid-cols-2">
                      <div
                        className={`relative aspect-square lg:aspect-auto min-h-[300px] bg-white ${isReverse ? "lg:order-2" : ""}`}
                      >
                        {hasImage ? (
                          <Image
                            src={kit.mainImage}
                            alt={kit.title}
                            fill
                            className="object-contain p-8"
                            sizes="(max-width: 768px) 100vw, 50vw"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-neutral-500 text-sm p-4 text-center">
                            Ảnh sản phẩm sẽ được upload qua admin
                          </div>
                        )}
                      </div>
                      <div className="p-6 md:p-10 flex flex-col justify-center">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                            {kit.brand} / {kit.series}
                          </span>
                          {kit.code && (
                            <span className="text-xs font-mono text-neutral-500">
                              {kit.code}
                            </span>
                          )}
                        </div>
                        <h3 className="text-3xl md:text-4xl font-black text-neutral-900 mb-2">
                          {kit.title}
                        </h3>
                        <p className={`text-lg font-semibold ${accent.text} mb-4`}>
                          {kit.subtitle}
                        </p>
                        <p className="text-neutral-700 mb-6 leading-relaxed">
                          {kit.shortDescription}
                        </p>
                        <div className="grid grid-cols-2 gap-3 mb-6">
                          <div className="bg-white rounded-xl p-3 border border-neutral-200">
                            <div className="text-xs uppercase tracking-wider text-neutral-500 mb-1">
                              Số chi tiết
                            </div>
                            <div className="font-bold text-neutral-900">
                              {specs.pieces ?? "—"}
                            </div>
                          </div>
                          <div className="bg-white rounded-xl p-3 border border-neutral-200">
                            <div className="text-xs uppercase tracking-wider text-neutral-500 mb-1">
                              Độ tuổi
                            </div>
                            <div className="font-bold text-neutral-900">
                              {specs.age ?? "—"}
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2 mb-6">
                          {highlights.slice(0, 4).map((h, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <span className={accent.text}>✓</span>
                              <span className="text-sm text-neutral-700">{h}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 mt-auto">
                          <div className="flex-1 bg-white rounded-xl px-4 py-3 border border-neutral-200">
                            <div className="text-xs uppercase tracking-wider text-neutral-500 mb-0.5">
                              Giá
                            </div>
                            <div className={`font-bold ${accent.text}`}>
                              {kit.priceDisplay}
                            </div>
                          </div>
                          <Link
                            href={`/lien-he?product=${kit.slug}`}
                            className={`inline-flex items-center justify-center gap-2 ${accent.btn} text-white font-bold px-6 py-3 rounded-xl transition-colors shadow-md`}
                          >
                            Tư vấn ngay
                            <ArrowRight className="w-4 h-4" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* COMPARISON TABLE */}
      <SectionBase
        theme="white"
        eyebrow="SO SÁNH"
        title="Bảng so sánh chi tiết 3 bộ học cụ"
        subtitle="Chọn bộ phù hợp với độ tuổi và mục tiêu của con"
      >
        <div className="max-w-5xl mx-auto -mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm border-collapse table-fixed">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[26%]" />
              <col className="w-[26%]" />
              <col className="w-[26%]" />
            </colgroup>
            <thead>
              <tr className="bg-neutral-50">
                <th className="px-4 py-3 text-left font-semibold text-neutral-700 border-b-2 border-neutral-200">
                  Tiêu chí
                </th>
                <th className="px-4 py-3 text-center font-semibold text-orange-600 border-b-2 border-orange-200">
                  Alpha
                </th>
                <th className="px-4 py-3 text-center font-semibold text-purple-600 border-b-2 border-purple-200">
                  Beta
                </th>
                <th className="px-4 py-3 text-center font-semibold text-blue-600 border-b-2 border-blue-200">
                  Intelligence Storm
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              <ComparisonRow label="Cấp độ" alpha="Nhập môn" beta="Thi đấu" storm="Nâng cao" />
              <ComparisonRow
                label="Số chi tiết"
                alpha="320-378 PCS"
                beta="133 PCS"
                storm="619 PCS"
              />
              <ComparisonRow
                label="Độ tuổi"
                alpha="6+"
                beta="6+ (có nền tảng)"
                storm="6+ (lý tưởng 10+)"
              />
              <ComparisonRow
                label="Lập trình"
                alpha="Thẻ OID (không máy tính)"
                beta="Tương thích Alpha"
                storm="Graphical + Python + C"
              />
              <ComparisonRow
                label="Cảm biến"
                alpha="7 loại"
                beta="Phụ thuộc lắp ráp"
                storm="8 sensor ports"
              />
              <ComparisonRow
                label="AI"
                alpha="—"
                beta="—"
                storm="Image Recognition + Gesture"
              />
              <ComparisonRow
                label="Mục tiêu"
                alpha="Học nền tảng"
                beta="Thi đấu Robotics"
                storm="AI + Python chuyên sâu"
              />
            </tbody>
          </table>
        </div>
      </SectionBase>

      {/* FINAL CTA */}
      <section className="bg-gradient-to-r from-orange-500 via-orange-600 to-purple-600 py-16">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-black text-white mb-4">
            Chưa biết chọn bộ nào phù hợp với con?
          </h2>
          <p className="text-lg text-white/90 mb-8 max-w-2xl mx-auto">
            Liên hệ Sata Robo để được tư vấn miễn phí — chúng tôi sẽ đánh giá độ
            tuổi và mục tiêu của con để gợi ý bộ học cụ phù hợp nhất.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href={SATA_ROBO_PHONE.zalo}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-white text-orange-600 font-bold px-6 py-3 rounded-xl hover:bg-orange-50 transition-colors shadow-lg"
            >
              <MessageCircle className="w-5 h-5" />
              Zalo {SATA_ROBO_PHONE.hien}
            </a>
            <Link
              href="/lien-he?subject=tu-van-hoc-cu"
              className="inline-flex items-center gap-2 bg-purple-700 text-white font-bold px-6 py-3 rounded-xl hover:bg-purple-800 transition-colors shadow-lg"
            >
              Tư vấn chọn bộ học cụ
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function ComparisonRow({
  label,
  alpha,
  beta,
  storm,
}: {
  label: string;
  alpha: string;
  beta: string;
  storm: string;
}) {
  return (
    <tr className="hover:bg-neutral-50/50 transition-colors">
      <td className="px-4 py-3 font-semibold text-neutral-700">{label}</td>
      <td className="px-4 py-3 text-center text-neutral-800">{alpha}</td>
      <td className="px-4 py-3 text-center text-neutral-800">{beta}</td>
      <td className="px-4 py-3 text-center text-neutral-800">{storm}</td>
    </tr>
  );
}
