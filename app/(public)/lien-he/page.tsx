import type { Metadata } from "next";
import { contactPageJsonLd, localBusinessJsonLd, breadcrumbJsonLd, jsonLdScript } from "@/lib/seo/jsonld";
import { pageImages } from "@/lib/page-images";
import {
  SATA_ROBO_CONTACT,
  operationalLocations,
  SATA_ROBO_PHONE,
} from "@/lib/locations";
import { LienHeNoiDung } from "./noi-dung";

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

// Giao diện chép từ Contact.dc.html (artifact "Sata Robo — Website mới"): xem ./noi-dung.tsx. Hiệu ứng nào
// artifact có thì giữ (fx.js lo); số liệu/giờ/địa chỉ đọc từ lib/locations.
export default function ContactPage() {
  const centers = operationalLocations().map((loc) => ({
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

      <LienHeNoiDung />
    </>
  );
}
