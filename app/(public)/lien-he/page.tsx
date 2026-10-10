import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight, Phone, Mail, MapPin, Clock } from "lucide-react";
import { contactPageJsonLd, localBusinessJsonLd, breadcrumbJsonLd, jsonLdScript } from '@/lib/seo/jsonld';
import { ContactForm } from "./_components/contact-form";
import { SocialLinks } from "./_components/social-links";
import { SectionBase } from "@/components/design-system/sections/section-base";
import { CTAPrimary } from "@/components/design-system/ctas/cta-primary";
import { GlowOrb } from "@/components/design-system/effects/glow-orb";
import { getPageImage, pageImages } from "@/lib/page-images";
import { tokens } from "@/lib/design-tokens";
import {
  SATA_ROBO_CONTACT,
  operationalLocations,
  upcomingLocations,
  SATA_ROBO_PHONE,
} from "@/lib/locations";

const BASE_URL = "https://satarobo.vn";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Liên hệ — Sata Robo Đà Nẵng",
  description: `Liên hệ Sata Robo — Hotline ${SATA_ROBO_PHONE.hien}, email ${SATA_ROBO_CONTACT.emails.general}. 2 cơ sở tại Đà Nẵng.`,
  alternates: { canonical: `${BASE_URL}/lien-he` },
  openGraph: {
    title: "Liên hệ — Sata Robo",
    description: `Hotline ${SATA_ROBO_PHONE.hien} — phản hồi 30 phút giờ hành chính.`,
    url: `${BASE_URL}/lien-he`,
    siteName: "Sata Robo",
    images: [{ url: pageImages.contact.src, width: 1600, height: 900 }],
  },
};

const hqLocation =
  operationalLocations().find((l) => l.isHQ) ?? operationalLocations()[0];

const QUICK_INFO = [
  {
    icon: Phone,
    label: "Hotline",
    value: SATA_ROBO_PHONE.hien,
    href: `tel:${SATA_ROBO_PHONE.tho}`,
  },
  { icon: Mail, label: "Email", value: SATA_ROBO_CONTACT.emails.general, href: `mailto:${SATA_ROBO_CONTACT.emails.general}` },
  {
    icon: MapPin,
    label: "Địa chỉ",
    value: hqLocation.address,
    href: `https://maps.google.com/?q=${encodeURIComponent(hqLocation.address)}`,
  },
  { icon: Clock, label: "Giờ làm việc", value: hqLocation.workingHours, href: undefined as string | undefined },
];

export default async function ContactPage() {
  const heroImage = await getPageImage("lien-he", pageImages.contact);
  const operational = operationalLocations();
  const upcoming = upcomingLocations();
  const centers = operational.map((loc) => ({
    id: loc.id,
    name: loc.name,
    address: loc.address,
    phone: SATA_ROBO_PHONE.e164,
    email: SATA_ROBO_CONTACT.emails.general,
  }));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(contactPageJsonLd()) }}
      />
      {centers.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(centers.map((c) => localBusinessJsonLd(c))),
          }}
        />
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd([
              { name: "Trang chủ", url: "/" },
              { name: "Liên hệ", url: "/lien-he" },
            ]),
          ),
        }}
      />

      <div className="bg-white border-b border-neutral-200 py-3">
        <div className={tokens.spacing.container}>
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-neutral-500">
            <Link href="/" className="hover:text-orange-600 transition-colors">Trang chủ</Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-neutral-800 font-medium">Liên hệ</span>
          </nav>
        </div>
      </div>

      {/* ─── Hero SOFT-WARM ─── */}
      <section className={`relative overflow-hidden ${tokens.vibrantBg.softWarm} py-16`}>
        <GlowOrb color="orange" position="bottom-right" size="lg" />
        <div className="container max-w-6xl mx-auto px-4 grid md:grid-cols-2 gap-12 items-center relative z-10">
          <div>
            <p className={`${tokens.typography.eyebrow} mb-3`}>LIÊN HỆ</p>
            <h1 className={`${tokens.typography.display.h2} mb-4`}>
              Liên hệ Sata Robo
            </h1>
            <p className={`${tokens.typography.body.lg} text-neutral-600 mb-6`}>
              Chúng tôi tư vấn 1-1 miễn phí và xếp buổi học thử 1-1 cho con — phản hồi trong 30 phút giờ hành chính
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <CTAPrimary href={`tel:${SATA_ROBO_PHONE.tho}`} magnetic>
                <Phone className="w-4 h-4" />
                <span>Gọi {SATA_ROBO_PHONE.hien}</span>
              </CTAPrimary>
            </div>
          </div>
          <div className="relative aspect-video rounded-2xl overflow-hidden shadow-xl">
            <Image
              src={heroImage.src}
              alt={heroImage.alt}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 50vw"
              priority
            />
          </div>
        </div>
      </section>

      {/* ─── Quick info WHITE ─── */}
      <SectionBase theme="white" eyebrow="THÔNG TIN NHANH" title="Cách liên hệ Sata Robo">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {QUICK_INFO.map((info) => {
            const content = (
              <div className="bg-white p-6 rounded-2xl border border-neutral-200 hover:border-orange-300 hover:shadow-md transition-all h-full">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-orange-50 text-orange-500 mb-4">
                  <info.icon className="w-6 h-6" />
                </div>
                <p className="text-xs uppercase tracking-wider text-neutral-500 font-semibold mb-1">
                  {info.label}
                </p>
                <p className="font-semibold text-neutral-900">{info.value}</p>
              </div>
            );
            return info.href ? (
              <a key={info.label} href={info.href} target={info.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">
                {content}
              </a>
            ) : (
              <div key={info.label}>{content}</div>
            );
          })}
        </div>
      </SectionBase>

      {/* ─── Form section SOFT-WARM ───
          KHÔNG bọc SectionBase: ContactForm tự render <section id="dang-ky">
          (đích nhảy của CTA "Đặt buổi học thử 1-1"). Bọc thêm sẽ thành section lồng
          section + tiêu đề đúp. */}
      <ContactForm />

      {/* ─── Centers grid SOFT-COOL ─── */}
      <SectionBase
        theme="soft-cool"
        eyebrow={`${operational.length} CƠ SỞ ĐANG HOẠT ĐỘNG`}
        title="Tìm cơ sở gần nhà"
        glowOrb={{ color: "purple", position: "bottom-right" }}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {operational.map((loc) => (
            <div
              key={loc.id}
              className={`relative bg-white rounded-2xl border-2 ${
                loc.isHQ ? "border-orange-300" : "border-purple-300"
              } p-6 shadow-lg hover:shadow-xl transition-shadow`}
            >
              {/* Badge "Trụ sở chính" đã gỡ theo hướng dẫn BCT (cấm chú thích nhãn đó
                  sau địa chỉ kinh doanh). Cờ `loc.isHQ` GIỮ NGUYÊN — nó còn dùng để chọn
                  cơ sở mặc định ở :39 và ở contact-form.tsx:78. */}
              <div className="flex items-start gap-3 mb-4">
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    loc.isHQ ? "bg-orange-100 text-orange-600" : "bg-purple-100 text-purple-600"
                  }`}
                >
                  <MapPin className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-xl text-neutral-900">{loc.name}</h3>
                  <p className="text-neutral-700 mt-1">{loc.address}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">{loc.district}</p>
                </div>
              </div>
              <div className="space-y-2 text-sm pt-4 border-t border-neutral-100">
                {/* Số CHUNG của công ty — cố ý KHÔNG còn tiền tố "{loc.code}", vì nhãn đó
                    nói số này là của riêng cơ sở đang xem. */}
                <a
                  href={`tel:${SATA_ROBO_PHONE.tho}`}
                  className="flex items-center gap-2 text-neutral-700 hover:text-orange-600"
                >
                  <Phone className="w-4 h-4" />
                  {SATA_ROBO_PHONE.hien}
                </a>
                <div className="flex items-center gap-2 text-neutral-600">
                  <Clock className="w-4 h-4" />
                  {loc.workingHours}
                </div>
                {loc.note && (
                  <p className="text-xs text-neutral-500 italic mt-2">{loc.note}</p>
                )}
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(loc.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-purple-700 hover:text-purple-800 mt-2"
                >
                  Chỉ đường →
                </a>
              </div>
            </div>
          ))}
        </div>

        {upcoming.length > 0 && (
          <div className="mt-12 max-w-5xl mx-auto">
            <div className="text-center mb-6">
              <span className="inline-block px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold uppercase tracking-wider">
                Sắp khai trương
              </span>
              <p className="mt-2 text-sm text-neutral-600">
                Mạng lưới đang mở rộng — phục vụ phụ huynh khu vực mới
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {upcoming.map((loc) => (
                <div
                  key={loc.id}
                  className="relative bg-white/70 rounded-2xl border-2 border-dashed border-amber-300 p-6"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-amber-100 text-amber-600">
                      <MapPin className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-xl text-neutral-900">{loc.name}</h3>
                      <p className="text-neutral-700 mt-1">{loc.address}</p>
                      <p className="text-xs text-neutral-500 mt-0.5">{loc.district}</p>
                      <p className="mt-3 text-sm font-semibold text-amber-700">
                        {loc.workingHours}
                      </p>
                      {loc.note && (
                        <p className="text-xs text-neutral-500 italic mt-1">{loc.note}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionBase>

      {/* ─── Social WHITE ─── */}
      <SectionBase theme="white" eyebrow="KẾT NỐI" title="Theo dõi Sata Robo" variant="narrow">
        <SocialLinks />
      </SectionBase>
    </>
  );
}
