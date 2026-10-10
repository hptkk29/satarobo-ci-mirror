import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  ChevronRight,
  ArrowRight,
  CheckCircle2,
  GraduationCap,
  Sparkles,
  ShieldCheck,
  Phone,
} from "lucide-react";
import { db } from "@/lib/db";
import { itemListJsonLd, breadcrumbJsonLd, jsonLdScript } from '@/lib/seo/jsonld';
import { BorderBeam } from "@/components/magic/border-beam";
import { Particles } from "@/components/magic/particles";
import { FadeIn } from "@/components/motion/fade-in";
import { RevealOnScroll } from "@/components/motion/reveal-on-scroll";
import {
  SectionEyebrow,
  SectionHeading,
  SectionLead,
} from "@/components/design-system/sections/section-primitives";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { giaHienThi } from "@/lib/gia-cong-khai";

const BASE_URL = "https://satarobo.vn";

export const metadata: Metadata = {
  title: "Khoá học Robotics & STEM — Sata Robo Đà Nẵng",
  description:
    "2 khoá học chủ lực tại Sata Robo: Lập trình Robot (Sata1-8) và Luyện thi RoboSim — robot vật lý, lớp ≤12 HV, cam kết hoàn 100%, 2 cơ sở Đà Nẵng.",
  openGraph: {
    title: "Khoá học Robotics & STEM — Sata Robo",
    description: "Lập trình Robot (Sata1-8) và Luyện thi RoboSim.",
    url: `${BASE_URL}/khoa-hoc`,
    siteName: "Sata Robo",
  },
  alternates: { canonical: `${BASE_URL}/khoa-hoc` },
};

export const revalidate = 60;

const COMPARISON = [
  {
    label: "Hình thức",
    laptrinhrobot: "Offline tại trung tâm",
    luyenthirobosim: "Học Online qua nền tảng SataWorld",
  },
  {
    label: "Đối tượng",
    laptrinhrobot: "Học sinh lớp 1-8",
    luyenthirobosim: "Học sinh đã biết cơ bản, muốn học luyện thi để thi đấu",
  },
  {
    label: "Thời lượng",
    laptrinhrobot: "12 tháng (48 buổi)",
    luyenthirobosim: "1 tháng (18 buổi video + coaching)",
  },
  {
    label: "Sĩ số",
    laptrinhrobot: "≤ 12 học viên / lớp",
    luyenthirobosim: "Không giới hạn (online)",
  },
  {
    label: "Thiết bị",
    laptrinhrobot: "Các Robot Education vật lý",
    luyenthirobosim: "Ứng dụng RoboSim trên máy tính Windows",
  },
  {
    label: "Mục tiêu",
    laptrinhrobot: "Nền tảng Robotics + tư duy lập trình",
    luyenthirobosim: "Pass vòng loại Sáng tạo Robotics (RoboSim)",
  },
  // ⚠️ Hàng "Giá" KHÔNG nằm ở đây nữa. Trước 21/09/2026 nó là hằng gõ tay
  // ("Chỉ từ 1.485.000đ" / "Chỉ từ 490.000đ") trong khi thẻ khoá học cách đó ~190 dòng
  // in chuỗi cứng "Liên hệ" — cùng một trang, hai con số khác nhau cho cùng một khoá.
  // Nay nó được chèn trong `CoursesPage` từ cùng nguồn với thẻ (`giaHienThi`).
];

const COMMITMENTS = [
  "Giáo trình WRO chuẩn quốc tế — 3 năm tinh chỉnh",
  "Hoàn 100% học phí sau buổi học đầu tiên nếu con không phù hợp",
  "Lớp ≤12 học viên — giáo viên theo sát từng con",
  "Lab Robotics đầy đủ — robot Education vật lý, sensor, controller",
  "Cộng đồng phụ huynh 2,000+ chia sẻ kinh nghiệm",
  "2 cơ sở Đà Nẵng — thuận tiện đưa đón con đi học",
];

export default async function CoursesPage() {
  const courses = await db.course
    .findMany({
      where: { isPublished: true },
      orderBy: { displayOrder: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        code: true,
        shortDescription: true,
        description: true,
        price: true,
        priceDisplay: true,
        durationDisplay: true,
        studentCount: true,
        thumbnail: true,
      },
    })
    .catch(() => []);

  // Hàng "Giá" của bảng so sánh — dựng từ CÙNG hàm với thẻ khoá học ở trên, để hai chỗ
  // trên cùng một trang không thể in hai con số khác nhau (lỗi đã có trước 21/09/2026).
  // `find` theo slug vì bảng so sánh cố định hai cột laptrinhrobot / luyenthirobosim.
  const giaTheoSlug = (slug: string) => {
    const c = courses.find((x) => x.slug === slug);
    return c ? giaHienThi(c) : giaHienThi({ slug });
  };
  const bangSoSanh = [
    ...COMPARISON,
    {
      label: "Giá",
      laptrinhrobot: giaTheoSlug("laptrinhrobot"),
      luyenthirobosim: giaTheoSlug("luyenthirobosim"),
    },
  ];

  const itemListData = courses.map((c, i) => ({
    position: i + 1,
    name: `${c.code ?? ""} — ${c.name}`.trim().replace(/^—\s*/, ""),
    url: `${BASE_URL}/khoa-hoc/${c.slug}`,
  }));

  const breadcrumb = breadcrumbJsonLd([
    { name: "Trang chủ", url: "/" },
    { name: "Khoá học", url: "/khoa-hoc" },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(itemListJsonLd(itemListData)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />

      <div className="bg-white border-b border-neutral-200 py-3">
        <div className="container mx-auto px-4 max-w-7xl">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-neutral-500">
            <Link href="/" className="hover:text-orange-600 transition-colors">
              Trang chủ
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-neutral-800 font-medium">Khoá học</span>
          </nav>
        </div>
      </div>

      {/* HERO */}
      <section className="relative overflow-hidden bg-gradient-to-br from-orange-50 via-white to-purple-50 py-16">
        <Particles
          className="absolute inset-0"
          quantity={40}
          ease={80}
          color="#7C3AED"
          refresh={false}
        />
        <div className="container mx-auto px-4 max-w-5xl relative z-10">
          <FadeIn>
            <div className="text-center">
              <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur border border-purple-200 rounded-full px-4 py-1.5 mb-6 shadow-sm">
                <Sparkles className="w-4 h-4 text-purple-600" />
                <span className="text-xs font-bold uppercase tracking-wider text-purple-700">
                  Học + Thực Hành + Thi Đấu + Thành tích
                </span>
              </div>
              <h1 className="text-4xl md:text-5xl font-black text-neutral-900 mb-4 leading-tight">
                Học để phát triển tư duy là đương nhiên, nhưng sẽ phải gắn liền với thi đấu. Lấy kết quả thi đấu là thước đo đánh giá hiệu quả. Đó là triết lý giáo dục của Sata Robo.
              </h1>
              <p className="text-lg text-neutral-600 mb-8 max-w-2xl mx-auto">
                Tại Sata Robo, chúng tôi đào tạo và có cam kết đầu ra. Học viên được học để hiểu, thực hành để thành thạo, và thi đấu để khẳng định năng lực. Thành tích thi đấu là thước đo khách quan nhất cho hiệu quả đào tạo của chúng tôi.
              </p>
              <div className="flex flex-wrap gap-2 justify-center text-xs mb-8">
                {["Lộ trình rõ ràng", "Hoàn 100% nếu không hài lòng", "2 cơ sở Đà Nẵng"].map(
                  (text) => (
                    <span
                      key={text}
                      className="inline-flex items-center gap-1.5 bg-white border border-green-200 text-green-700 font-semibold px-3 py-1.5 rounded-full shadow-sm"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {text}
                    </span>
                  ),
                )}
              </div>
              <Link
                href="/lien-he?free-trial=true"
                className="cta-pulse cta-shine inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold px-6 py-3 rounded-xl hover:-translate-y-0.5 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:outline-none"
              >
                Đặt buổi học thử 1-1 miễn phí
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* PRODUCTS */}
      <section className="bg-white py-16">
        <div className="container mx-auto px-4 max-w-7xl">
          <SectionEyebrow icon={GraduationCap} label="2 khoá học chủ lực" tone="orange" />
          <SectionHeading>Chọn khoá phù hợp với con bạn</SectionHeading>
          <SectionLead>
            Bấm vào card để xem chi tiết lộ trình, học phí và cách đăng ký
          </SectionLead>

          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto md:items-stretch">
            {courses.map((c, i) => (
              <RevealOnScroll
                key={c.id}
                direction="up"
                distance={24}
                delay={i * 0.08}
                className="h-full"
              >
                <Link
                  href={`/khoa-hoc/${c.slug}`}
                  className="group relative flex h-full flex-col bg-white rounded-2xl border border-neutral-200 overflow-hidden hover:shadow-[0_12px_40px_rgba(0,0,0,0.1)] hover:-translate-y-1 transition-all duration-300 focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:outline-none"
                >
                  <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none rounded-2xl overflow-hidden">
                    <BorderBeam size={90} duration={8} colorFrom="#F97316" colorTo="#7C3AED" />
                  </span>

                  <div className="aspect-video relative overflow-hidden bg-gradient-to-br from-orange-50 to-purple-50">
                    {c.thumbnail ? (
                      <Image
                        src={c.thumbnail}
                        alt={c.name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                        sizes="(max-width: 768px) 100vw, 50vw"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-orange-300">
                        <GraduationCap className="w-20 h-20" />
                      </div>
                    )}
                    {c.code && (
                      <div className="absolute top-3 left-3 px-3 py-1 bg-white/95 backdrop-blur rounded-full text-xs font-bold text-orange-600 shadow-sm">
                        {c.code}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col p-6 md:p-8">
                    <h3 className="text-2xl font-bold text-neutral-900 mb-1 group-hover:text-orange-600 transition-colors">
                      {c.name}
                    </h3>
                    <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-gradient-warm">
                      Học &amp; Thi Robotics 2026
                    </p>
                    {/* Show shortDescription đầy đủ — không line-clamp; dài bao nhiêu cũng hiện. */}
                    <p className="text-neutral-600 mb-5 leading-relaxed">
                      {c.shortDescription ?? c.description ?? ""}
                    </p>

                    <div className="mt-auto flex flex-col gap-4">
                      <div className="flex items-center gap-4 text-sm text-neutral-500">
                        {c.durationDisplay && (
                          <span className="flex items-center gap-1.5">
                            <Sparkles className="w-4 h-4" />
                            {c.durationDisplay}
                          </span>
                        )}
                        {c.studentCount > 0 && (
                          <span className="flex items-center gap-1.5">
                            {c.studentCount.toLocaleString()} học viên
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-xl font-bold text-orange-600">
                          {giaHienThi(c)}
                        </span>
                        <span className="ml-auto inline-flex items-center gap-1.5 text-sm font-bold text-purple-700 group-hover:gap-2.5 transition-all">
                          Xem chi tiết
                          <ArrowRight className="w-4 h-4" />
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              </RevealOnScroll>
            ))}
          </div>
        </div>
      </section>

      {/* COMPARISON */}
      <section className="bg-neutral-50 py-16">
        <div className="container mx-auto px-4 max-w-5xl">
          <SectionEyebrow icon={Sparkles} label="So sánh" tone="purple" />
          <SectionHeading>Lập trình Robot vs Luyện thi RoboSim</SectionHeading>
          <SectionLead>Bảng tổng hợp để chọn nhanh khoá phù hợp</SectionLead>

          <RevealOnScroll direction="up" distance={20}>
            <div className="mt-10 overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left">
                  <tr>
                    <th className="px-5 py-4 font-semibold text-neutral-700">Tiêu chí</th>
                    <th className="px-5 py-4 font-semibold text-orange-600">
                      Lập trình Robot
                    </th>
                    <th className="px-5 py-4 font-semibold text-purple-700">
                      Luyện thi RoboSim
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {bangSoSanh.map((row) => (
                    <tr key={row.label} className="hover:bg-neutral-50/60">
                      <td className="px-5 py-4 font-semibold text-neutral-700">
                        {row.label}
                      </td>
                      <td className="px-5 py-4 text-neutral-700">{row.laptrinhrobot}</td>
                      <td className="px-5 py-4 text-neutral-700">{row.luyenthirobosim}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </RevealOnScroll>
        </div>
      </section>

      {/* COMMITMENTS */}
      <section className="bg-white py-16">
        <div className="container mx-auto px-4 max-w-6xl">
          <SectionEyebrow icon={ShieldCheck} label="Cam kết" tone="orange" />
          <SectionHeading>Tại sao chọn Sata Robo</SectionHeading>

          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
            {COMMITMENTS.map((point, i) => (
              <RevealOnScroll key={point} direction="up" distance={16} delay={i * 0.04}>
                <div className="flex items-start gap-3 p-5 rounded-xl border border-neutral-200 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300 h-full">
                  <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-orange-400 text-white flex items-center justify-center shadow-md shadow-orange-500/30">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <p className="text-sm text-neutral-700 leading-relaxed">{point}</p>
                </div>
              </RevealOnScroll>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="relative overflow-hidden bg-gradient-to-r from-orange-500 to-purple-600 py-16">
        <Particles
          className="absolute inset-0"
          quantity={30}
          ease={70}
          color="#ffffff"
          refresh={false}
        />
        <div className="container mx-auto px-4 max-w-4xl text-center text-white relative z-10">
          <FadeIn>
            <h2 className="text-3xl md:text-4xl font-black mb-4">
              Chưa biết chọn khoá nào?
            </h2>
            <p className="text-lg mb-8 opacity-95 max-w-2xl mx-auto">
              Đặt buổi học thử 1-1 miễn phí — chuyên gia Sata Robo sẽ giúp anh chị tìm lộ trình
              phù hợp nhất cho con
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/lien-he?free-trial=true"
                className="cta-pulse-white cta-shine cta-shine-warm inline-flex items-center justify-center gap-2 bg-white text-orange-600 font-bold px-8 py-4 rounded-xl hover:bg-orange-50 text-lg hover:-translate-y-0.5 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
              >
                Đặt buổi học thử 1-1 miễn phí
                <ArrowRight className="w-5 h-5" />
              </Link>
              <a
                href={`tel:${SATA_ROBO_PHONE.tho}`}
                className="inline-flex items-center justify-center gap-2 bg-white/10 backdrop-blur text-white border-2 border-white/50 font-bold px-6 py-4 rounded-xl hover:bg-white/20 text-lg transition-all duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
              >
                <Phone className="w-6 h-6" />
                {SATA_ROBO_PHONE.hien}
              </a>
            </div>
          </FadeIn>
        </div>
      </section>
    </>
  );
}
