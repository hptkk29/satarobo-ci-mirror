import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";
import { breadcrumbJsonLd, jsonLdScript } from "@/lib/seo/jsonld";
import { HeroMinimal } from "@/components/design-system/heroes/hero-minimal";
import { SectionBase } from "@/components/design-system/sections/section-base";
import { CongTyBlock } from "@/components/public/cong-ty-block";
import { tokens } from "@/lib/design-tokens";
import { LEGAL_PAGES, LEGAL_PAGES_PHU, legalHref } from "@/lib/legal-pages";

// Trang MỤC LỤC 10 chính sách. Hai lý do tồn tại, cả hai đều cụ thể:
//  1. Cán bộ tiếp nhận hồ sơ BCT có MỘT url để kiểm đủ 10 chính sách, thay vì phải dò chân trang.
//  2. Ô tích "Chính sách hoạt động của website" (yêu cầu mục [4]) cần một đích để gắn link —
//     và cái tên đó KHÔNG có trong bộ 11 file gửi kèm, nên trỏ về mục lục là cách đọc ít suy
//     diễn nhất. ⚠️ Vẫn phải xác nhận lại với đơn vị tư vấn.
export const metadata: Metadata = {
  title: "Chính sách của website",
  description:
    "Toàn bộ chính sách áp dụng cho khách hàng khi giao dịch trên website satarobo.vn: bảo mật, giá, thanh toán, giao hàng, đổi trả, chấm dứt dịch vụ và quyền nghĩa vụ các bên.",
  alternates: { canonical: "https://satarobo.vn/chinh-sach" },
  openGraph: {
    title: "Chính sách của website | Sata Robo",
    description: "Toàn bộ chính sách áp dụng khi giao dịch trên satarobo.vn.",
    url: "https://satarobo.vn/chinh-sach",
    siteName: "Sata Robo",
  },
  robots: { index: true, follow: true },
};

export default function ChinhSachIndexPage() {
  const breadcrumb = breadcrumbJsonLd([
    { name: "Trang chủ", url: "/" },
    { name: "Chính sách của website", url: "/chinh-sach" },
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
            <span className="text-neutral-800 font-medium">Chính sách của website</span>
          </nav>
        </div>
      </div>

      <HeroMinimal
        eyebrow="PHÁP LÝ"
        title="Chính sách của website"
        subtitle="Toàn bộ chính sách áp dụng cho khách hàng khi giao dịch trên satarobo.vn"
      />

      <SectionBase theme="white" variant="narrow">
        <ol className="space-y-3">
          {LEGAL_PAGES.map((page, i) => (
            <li key={page.slug}>
              <Link
                href={legalHref(page.slug)}
                className="group flex items-start gap-3 rounded-xl border border-neutral-200 p-4 transition-colors hover:border-orange-300 hover:bg-orange-50/50"
              >
                <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-bold text-neutral-600 group-hover:bg-orange-100 group-hover:text-orange-700">
                  {i + 1}
                </span>
                <span className="font-medium text-neutral-800 group-hover:text-orange-700">
                  {page.label}
                </span>
                <ChevronRight className="ml-auto mt-0.5 h-4 w-4 flex-shrink-0 text-neutral-400 transition-transform group-hover:translate-x-0.5 group-hover:text-orange-600" />
              </Link>
            </li>
          ))}
        </ol>

        <h2 className="mb-3 mt-10 text-base font-bold text-neutral-800">Văn bản liên quan</h2>
        <ul className="space-y-2">
          {LEGAL_PAGES_PHU.map((page) => (
            <li key={page.slug}>
              <Link
                href={legalHref(page.slug)}
                className="inline-flex items-center gap-2 text-sm text-neutral-600 hover:text-orange-700"
              >
                <FileText className="h-4 w-4 text-neutral-400" />
                {page.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-10 rounded-xl border border-neutral-200 bg-neutral-50 p-5 text-neutral-700">
          <CongTyBlock />
        </div>
      </SectionBase>
    </>
  );
}
