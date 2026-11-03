import type { Metadata } from "next";
import Link from "next/link";
import {
  ChevronRight,
  Lightbulb,
  Users,
  Shield,
  Target,
  Compass,
  Rocket,
  Sparkles as SparklesIcon,
  Building2,
  Phone,
  Mail,
  MapPin,
  Receipt,
  ArrowRight,
} from "lucide-react";
import { aboutPageJsonLd, breadcrumbJsonLd, jsonLdScript } from '@/lib/seo/jsonld';
import { HeroParticles } from "@/components/design-system/heroes/hero-particles";
import { SectionBase } from "@/components/design-system/sections/section-base";
import { Sparkles } from "@/components/design-system/effects/sparkles";
import { GlowOrb } from "@/components/design-system/effects/glow-orb";
import { CTAPrimary } from "@/components/design-system/ctas/cta-primary";
import { CTASecondary } from "@/components/design-system/ctas/cta-secondary";
import { tokens } from "@/lib/design-tokens";
import {
  SATA_ROBO_CONTACT,
  SATA_ROBO_PHONE,
  operationalLocations,
} from "@/lib/locations";
import { AutoCarousel } from "@/components/public/auto-carousel";
import { DoiNguSangLap } from "@/components/public/doi-ngu-sang-lap";
import { Reveal } from "@/components/motion/reveal";

const BASE_URL = "https://satarobo.vn";

export const metadata: Metadata = {
  title: "Câu chuyện thương hiệu Sata Robo | Tầm nhìn, Sứ mệnh, Giá trị cốt lõi",
  description:
    "Trung tâm đào tạo STEM – Lập trình Robotics & AI – Sata Robo. Khơi nguồn sáng tạo, chắp cánh tương lai.",
  alternates: { canonical: `${BASE_URL}/ve-chung-toi` },
  openGraph: {
    title: "Câu chuyện thương hiệu Sata Robo",
    description: "Khơi nguồn sáng tạo – Chắp cánh tương lai",
    url: `${BASE_URL}/ve-chung-toi`,
    siteName: "Sata Robo",
  },
};

const coreValues = [
  {
    icon: Lightbulb,
    title: "Sáng tạo",
    titleEn: "Innovation",
    description: "Không ngừng đổi mới phương pháp giáo dục và công nghệ học tập.",
    gradient: "from-orange-50 to-amber-50",
    borderColor: "border-orange-200",
    iconBg: "bg-orange-100",
    iconColor: "text-orange-600",
  },
  {
    icon: Users,
    title: "Gắn kết",
    titleEn: "Connection",
    description:
      "Xây dựng mối quan hệ bền chặt giữa học sinh, phụ huynh, giáo viên, đơn vị và đối tác giáo dục.",
    gradient: "from-purple-50 to-violet-50",
    borderColor: "border-purple-200",
    iconBg: "bg-purple-100",
    iconColor: "text-purple-600",
  },
  {
    icon: Shield,
    title: "Chính trực",
    titleEn: "Integrity",
    description: "Cam kết minh bạch và trung thực trong mọi hoạt động.",
    gradient: "from-green-50 to-emerald-50",
    borderColor: "border-green-200",
    iconBg: "bg-green-100",
    iconColor: "text-green-600",
  },
  {
    icon: Target,
    title: "Kỷ luật",
    titleEn: "Discipline",
    description: "Rèn luyện tính tự giác và kiên trì trong học tập và làm việc.",
    gradient: "from-blue-50 to-sky-50",
    borderColor: "border-blue-200",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
  },
];

export default function VeChungToiPage() {
  const breadcrumb = breadcrumbJsonLd([
    { name: "Trang chủ", url: "/" },
    { name: "Về chúng tôi", url: "/ve-chung-toi" },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(aboutPageJsonLd()) }}
      />
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
            <span className="text-neutral-800 font-medium">Về chúng tôi</span>
          </nav>
        </div>
      </div>

      {/* HERO - TWILIGHT */}
      <HeroParticles
        theme="twilight"
        eyebrow="VỀ CHÚNG TÔI"
        title="Câu chuyện thương hiệu Sata Robo"
        subtitle="Khơi nguồn sáng tạo – Chắp cánh tương lai"
        effects={{ particles: true, sparkles: true, glowOrbs: true, gridLines: false }}
      >
        <CTAPrimary href="/khoa-hoc" size="lg" magnetic>
          Khám phá khoá học
        </CTAPrimary>
        <CTASecondary href="/lien-he" size="lg">
          Liên hệ tư vấn
        </CTASecondary>
      </HeroParticles>

      {/* SECTION 0 - ĐỘI NGŨ SÁNG LẬP */}
      <SectionBase
        theme="white"
        eyebrow="ĐỘI NGŨ SÁNG LẬP"
        title="Những người đặt nền móng cho Sata Robo"
      >
        <DoiNguSangLap />
      </SectionBase>

      {/* SECTION 1 - CÂU CHUYỆN */}
      <SectionBase
        theme="white"
        eyebrow="CÂU CHUYỆN CỦA CHÚNG TÔI"
        title="Hành trình khơi mầm sáng tạo cho thế hệ trẻ Việt Nam"
      >
        <div className="max-w-3xl mx-auto space-y-6">
          <Reveal variant="blur" delay={0.00}>
          <p className="text-lg text-neutral-700 leading-relaxed">
            Chúng tôi tin rằng trong mỗi đứa trẻ đều có một{" "}
            <strong className="text-purple-700">tiềm năng vô hạn</strong>, chỉ
            chờ được khơi dậy bằng tri thức và trải nghiệm thực tế. Thực tế hiện
            nay, nhiều em vẫn phải học trong khuôn khổ lý thuyết khô khan, thiếu
            môi trường thực hành, thiếu những sân chơi để tự tin cọ xát cùng bạn
            bè quốc tế. Chính khoảng trống ấy khiến tư duy sáng tạo và niềm đam
            mê công nghệ chưa được nuôi dưỡng trọn vẹn.
          </p>
          </Reveal>
          <Reveal variant="blur" delay={0.12}>
          <p className="text-lg text-neutral-700 leading-relaxed">
            <strong className="text-orange-600">
              Sata Robo ra đời để lấp đầy khoảng trống đó.
            </strong>{" "}
            Chúng tôi mang đến các chương trình học Robotics và công nghệ sinh
            động, gắn liền với thực tiễn, cùng những cuộc thi từ cấp trường đến
            quốc tế. Đây không chỉ là sân chơi bổ ích mà còn là hành trình để
            học sinh rèn luyện tư duy logic, khả năng sáng tạo, tinh thần hợp
            tác và bản lĩnh hội nhập – phù hợp với định hướng STEM mà Nhà nước
            khuyến khích.
          </p>
          </Reveal>
          <Reveal variant="blur" delay={0.24}>
          <p className="text-lg text-neutral-700 leading-relaxed">
            Chúng tôi tin rằng khi gieo những hạt mầm trải nghiệm hôm nay, ngày
            mai sẽ{" "}
            <strong className="text-purple-700">
              nảy nở một thế hệ trẻ vững vàng hơn, sáng tạo hơn và nhân văn hơn.
            </strong>
          </p>
          </Reveal>
          <Reveal variant="pop" delay={0.2} className="text-center pt-6">
            <div>
            <div className="inline-flex items-center gap-3 bg-gradient-to-r from-orange-50 to-purple-50 border border-orange-200 rounded-full px-6 py-3 shadow-sm">
              <ArrowRight className="h-5 w-5 text-orange-500" aria-hidden="true" />
              <p className="text-neutral-800 font-semibold">
                Hãy đồng hành cùng chúng tôi để phát triển tư duy cho thế hệ trẻ
                Việt Nam!
              </p>
            </div>
            </div>
          </Reveal>
        </div>
      </SectionBase>

      {/* SECTION 2 - TẦM NHÌN */}
      <SectionBase
        theme="soft-cool"
        eyebrow="TẦM NHÌN"
        title="Tầm nhìn của chúng tôi"
        glowOrb={{ color: "purple", position: "top-right" }}
      >
        <div className="max-w-4xl mx-auto">
          <Reveal variant="wipe-right">
          <div className="relative bg-white rounded-3xl border-2 border-purple-200 shadow-xl overflow-hidden">
            <div className="h-2 bg-gradient-to-r from-purple-500 to-violet-500" />
            <div className="p-8 md:p-12">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-purple-100 flex items-center justify-center">
                  <Compass className="w-7 h-7 text-purple-600" />
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-purple-600 mb-1">
                    Vision
                  </div>
                  <h3 className="text-2xl md:text-3xl font-bold text-neutral-900">
                    Tầm nhìn
                  </h3>
                </div>
              </div>
              <blockquote className="border-l-4 border-purple-400 pl-6 py-2 mb-6">
                <p className="text-xl md:text-2xl text-neutral-800 italic leading-relaxed font-medium">
                  &ldquo;Trở thành đơn vị tiên phong trong lĩnh vực{" "}
                  <span className="text-purple-700 font-bold">Robotics giáo dục</span>
                  , kiến tạo sân chơi quốc tế và nuôi dưỡng thế hệ trẻ Việt Nam
                  trở thành{" "}
                  <span className="text-purple-700 font-bold">công dân toàn cầu</span>{" "}
                  sáng tạo, nhân văn và tự tin hội nhập.&rdquo;
                </p>
              </blockquote>
              <Reveal variant="slide-left" delay={0.35}>
              <div className="bg-purple-50 rounded-xl p-5 border border-purple-100">
                <p className="text-sm text-neutral-700 leading-relaxed">
                  <strong className="text-purple-700">Ý nghĩa:</strong> Không
                  chỉ dừng lại ở đào tạo Robotics, mà còn hướng tới xây dựng thế
                  hệ trẻ tự tin, sáng tạo, gắn với sứ mệnh giáo dục quốc gia và
                  tầm nhìn toàn cầu.
                </p>
              </div>
              </Reveal>
            </div>
          </div>
          </Reveal>
        </div>
      </SectionBase>

      {/* SECTION 3 - SỨ MỆNH */}
      <SectionBase
        theme="soft-warm"
        eyebrow="SỨ MỆNH"
        title="Sứ mệnh của Sata Robo"
        glowOrb={{ color: "orange", position: "bottom-left" }}
      >
        <div className="max-w-4xl mx-auto">
          <Reveal variant="flip-up">
          <div className="relative bg-white rounded-3xl border-2 border-orange-200 shadow-xl overflow-hidden">
            <div className="h-2 bg-gradient-to-r from-orange-500 to-amber-400" />
            <div className="p-8 md:p-12">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-orange-100 flex items-center justify-center">
                  <Rocket className="w-7 h-7 text-orange-600" />
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-1">
                    Mission
                  </div>
                  <h3 className="text-2xl md:text-3xl font-bold text-neutral-900">
                    Sứ mệnh
                  </h3>
                </div>
              </div>
              <blockquote className="border-l-4 border-orange-400 pl-6 py-2 mb-6">
                <p className="text-xl md:text-2xl text-neutral-800 italic leading-relaxed font-medium">
                  &ldquo;Mang đến các giải pháp{" "}
                  <span className="text-orange-600 font-bold">
                    học tập, trải nghiệm và thi đấu Robotics
                  </span>{" "}
                  hiện đại, gắn liền với thực tiễn, nhằm phát triển tư duy, khơi
                  gợi đam mê sáng tạo, và xây dựng{" "}
                  <span className="text-orange-600 font-bold">
                    thế hệ trẻ có trí tuệ, kỹ năng và bản lĩnh hội nhập quốc tế.
                  </span>
                  &rdquo;
                </p>
              </blockquote>
              <Reveal variant="slide-right" delay={0.35}>
              <div className="bg-orange-50 rounded-xl p-5 border border-orange-100">
                <p className="text-sm text-neutral-700 leading-relaxed">
                  <strong className="text-orange-600">Ý nghĩa:</strong> Nhấn
                  mạnh giải pháp toàn diện:{" "}
                  <strong>học – trải nghiệm – thi đấu</strong>; đồng thời gắn
                  với giá trị tư duy, sáng tạo và hội nhập.
                </p>
              </div>
              </Reveal>
            </div>
          </div>
          </Reveal>
        </div>
      </SectionBase>

      {/* SECTION 4 - 4 GIÁ TRỊ CỐT LÕI */}
      <SectionBase
        theme="white"
        eyebrow="GIÁ TRỊ CỐT LÕI"
        title="4 giá trị định hình Sata Robo"
        subtitle="Mỗi quyết định, mỗi hành động của chúng tôi đều xuất phát từ 4 giá trị cốt lõi này"
      >
        {/* Mobile + tablet: auto-rotating carousel */}
        <Reveal variant="slide-right" className="lg:hidden max-w-6xl mx-auto">
          <AutoCarousel
            loop={false}
            align="center"
            slideClassName="flex-[0_0_100%]"
            showArrows={false}
          >
            {coreValues.map((value, index) => {
              const Icon = value.icon;
              return (
                <div
                  key={value.title}
                  className={`relative h-full bg-gradient-to-br ${value.gradient} rounded-2xl border-2 ${value.borderColor} p-6`}
                >
                  <div className="absolute -top-3 -right-3 w-8 h-8 bg-white rounded-full border-2 border-neutral-200 flex items-center justify-center text-xs font-black text-neutral-700 shadow-sm">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div className={`w-14 h-14 rounded-2xl ${value.iconBg} flex items-center justify-center mb-4`}>
                    <Icon className={`w-7 h-7 ${value.iconColor}`} />
                  </div>
                  <h3 className="text-xl font-bold text-neutral-900 mb-1">{value.title}</h3>
                  <div className={`text-xs uppercase tracking-wider font-semibold ${value.iconColor} mb-3`}>
                    {value.titleEn}
                  </div>
                  <p className="text-sm text-neutral-700 leading-relaxed">{value.description}</p>
                </div>
              );
            })}
          </AutoCarousel>
        </Reveal>

        {/* Desktop: 4-col grid */}
        <div className="hidden lg:grid lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {coreValues.map((value, index) => {
            const Icon = value.icon;
            return (
              <Reveal key={value.title} variant="pop" delay={index * 0.1}>
              <div
                className={`group relative h-full bg-gradient-to-br ${value.gradient} rounded-2xl border-2 ${value.borderColor} p-6 hover:shadow-xl hover:-translate-y-1 transition-all duration-300`}
              >
                <div className="absolute -top-3 -right-3 w-8 h-8 bg-white rounded-full border-2 border-neutral-200 flex items-center justify-center text-xs font-black text-neutral-700 shadow-sm">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div className={`w-14 h-14 rounded-2xl ${value.iconBg} flex items-center justify-center mb-4`}>
                  <Icon className={`w-7 h-7 ${value.iconColor}`} />
                </div>
                <h3 className="text-xl font-bold text-neutral-900 mb-1">
                  {value.title}
                </h3>
                <div
                  className={`text-xs uppercase tracking-wider font-semibold ${value.iconColor} mb-3`}
                >
                  {value.titleEn}
                </div>
                <p className="text-sm text-neutral-700 leading-relaxed">
                  {value.description}
                </p>
              </div>
              </Reveal>
            );
          })}
        </div>
      </SectionBase>

      {/* SECTION 4.5 - THÔNG TIN CÔNG TY */}
      <SectionBase
        theme="soft-cool"
        eyebrow="THÔNG TIN CÔNG TY"
        title="Hệ thống cơ sở Sata Robo tại Đà Nẵng"
        subtitle={`${operationalLocations().length} cơ sở đang hoạt động tại Đà Nẵng`}
      >
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Hàng 1 — Pháp nhân (full-width). Layout 2 cột nội bộ:
              trái = công ty + MST, phải = 3 liên hệ. */}
          <Reveal variant="wipe-left">
          <div className="relative overflow-hidden rounded-2xl border-2 border-purple-200 bg-white p-6 shadow-sm md:p-8">
            <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-purple-100/60 blur-3xl" />
            <div className="relative grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-10">
              {/* Cột trái — Pháp nhân */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-purple-700">
                  <Building2 className="h-5 w-5" />
                  <h3 className="text-sm font-bold uppercase tracking-wider">
                    Pháp nhân
                  </h3>
                </div>
                <p className="text-lg font-bold leading-snug text-neutral-900">
                  {SATA_ROBO_CONTACT.companyName}
                </p>
                <p className="flex items-start gap-2 text-sm text-neutral-700">
                  <Receipt className="mt-0.5 h-4 w-4 shrink-0 text-purple-500" />
                  <span>
                    <span className="text-neutral-500">Mã số thuế:</span>{" "}
                    <span className="font-mono font-semibold">
                      {SATA_ROBO_CONTACT.taxCode}
                    </span>
                  </span>
                </p>
              </div>

              {/* Cột phải — Liên hệ */}
              <div className="flex flex-col gap-2.5 text-sm md:border-l md:border-neutral-200 md:pl-10">
                <a
                  href={`tel:${SATA_ROBO_PHONE.tho}`}
                  className="group flex items-center gap-3 rounded-lg p-2 -mx-2 transition-colors hover:bg-orange-50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-600 group-hover:bg-orange-200">
                    <Phone className="h-4 w-4" />
                  </span>
                  <span className="font-semibold text-neutral-800 group-hover:text-orange-700">
                    {SATA_ROBO_PHONE.hien}
                  </span>
                </a>
                <a
                  href={`mailto:${SATA_ROBO_CONTACT.emails.general}`}
                  className="group flex items-center gap-3 rounded-lg p-2 -mx-2 transition-colors hover:bg-orange-50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-600 group-hover:bg-orange-200">
                    <Mail className="h-4 w-4" />
                  </span>
                  <span className="break-all text-neutral-800 group-hover:text-orange-700">
                    {SATA_ROBO_CONTACT.emails.general}
                  </span>
                </a>
                <a
                  href={`mailto:${SATA_ROBO_CONTACT.emails.recruitment}`}
                  className="group flex items-center gap-3 rounded-lg p-2 -mx-2 transition-colors hover:bg-purple-50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-600 group-hover:bg-purple-200">
                    <Mail className="h-4 w-4" />
                  </span>
                  <span className="break-all text-neutral-800 group-hover:text-purple-700">
                    {SATA_ROBO_CONTACT.emails.recruitment}
                  </span>
                </a>
              </div>
            </div>
          </div>

          </Reveal>

          {/* Hàng 2 — 2 cơ sở 1 hàng, cùng kích thước */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-stretch">
            {operationalLocations().map((loc, i) => (
              <Reveal
                key={loc.id}
                variant={i % 2 === 0 ? "slide-left" : "slide-right"}
                delay={0.1 + i * 0.1}
              >
              <div
                className={`group relative flex h-full flex-col rounded-2xl border-2 bg-white p-6 shadow-sm transition-all hover:shadow-md ${
                  loc.isHQ
                    ? "border-orange-200 hover:border-orange-300"
                    : "border-purple-200 hover:border-purple-300"
                }`}
              >
                <div className="mb-3 flex items-center justify-between">
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                      loc.isHQ
                        ? "bg-orange-100 text-orange-600"
                        : "bg-purple-100 text-purple-600"
                    }`}
                  >
                    <MapPin className="h-5 w-5" />
                  </span>
                  {/* Badge "HQ · Trụ sở chính" đã gỡ theo hướng dẫn BCT. Cờ isHQ giữ nguyên. */}
                </div>
                <h4 className="text-base font-bold text-neutral-900">
                  {loc.name}
                </h4>
                <p className="mt-2 text-sm leading-relaxed text-neutral-700">
                  {loc.address}
                </p>
                <p className="mt-auto pt-3 text-xs text-neutral-500">
                  {loc.district} · {loc.workingHours}
                </p>
              </div>
              </Reveal>
            ))}
          </div>
        </div>
      </SectionBase>

      {/* SECTION 5 - SLOGAN BANNER */}
      <section className="relative overflow-hidden bg-gradient-to-br from-orange-50 via-white to-purple-50 py-16">
        <Sparkles density="high" colors={["orange", "purple"]} />
        <GlowOrb color="orange" position="top-left" size="xl" />
        <GlowOrb color="purple" position="bottom-right" size="xl" />

        <div className="container max-w-5xl mx-auto px-4 text-center relative z-10">
          <Reveal variant="swing" className="inline-block">
          <div className="inline-flex items-center gap-2 mb-6 bg-white/80 backdrop-blur border border-purple-200 rounded-full px-5 py-2 shadow-sm">
            <SparklesIcon className="w-4 h-4 text-purple-600" />
            <span className="text-xs font-bold uppercase tracking-wider text-purple-700">
              Slogan
            </span>
          </div>
          </Reveal>
          <Reveal variant="mask-up" delay={0.1} className="mb-6">
          <h2 className="text-3xl md:text-5xl lg:text-6xl font-black leading-tight">
            <span className="bg-gradient-to-r from-orange-500 to-purple-600 bg-clip-text text-transparent">
              &ldquo;Khơi nguồn sáng tạo
            </span>
            <br />
            <span className="bg-gradient-to-r from-purple-600 to-orange-500 bg-clip-text text-transparent">
              – Chắp cánh tương lai&rdquo;
            </span>
          </h2>
          </Reveal>
          <Reveal variant="blur" delay={0.25}>
          <p className="text-lg md:text-xl text-neutral-600 mb-10 max-w-3xl mx-auto leading-relaxed">
            Đồng hành cùng Sata Robo trên hành trình nuôi dưỡng tư duy sáng tạo
            và đam mê công nghệ cho thế hệ trẻ Việt Nam.
          </p>
          </Reveal>
          <Reveal variant="pop" delay={0.35}>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <CTAPrimary href="/khoa-hoc" size="lg" magnetic>
              Khám phá khoá học
            </CTAPrimary>
            <CTASecondary
              href="/lien-he"
              size="lg"
              className="cta-shine cta-shine-purple"
            >
              Đặt buổi học thử 1-1 miễn phí
            </CTASecondary>
          </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
