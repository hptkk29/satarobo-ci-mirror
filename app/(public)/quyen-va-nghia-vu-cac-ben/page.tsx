import type { Metadata } from "next";
import { PhapLyTrang } from "@/components/public/phap-ly/phap-ly-trang";

export const metadata: Metadata = {
  title: "Quyền và nghĩa vụ của các bên",
  description:
    "Quyền và nghĩa vụ của Sata Robo và của khách hàng khi mua hàng hóa, dịch vụ trên website satarobo.vn.",
  alternates: { canonical: "https://satarobo.vn/quyen-va-nghia-vu-cac-ben" },
  openGraph: {
    title: "Quyền và nghĩa vụ của các bên | Sata Robo",
    description: "Quyền và nghĩa vụ của Sata Robo và khách hàng.",
    url: "https://satarobo.vn/quyen-va-nghia-vu-cac-ben",
    siteName: "Sata Robo",
  },
  robots: { index: true, follow: true },
};

export default function QuyenVaNghiaVuCacBenPage() {
  return (
    <PhapLyTrang
      slug="quyen-va-nghia-vu-cac-ben"
      title="Quyền và nghĩa vụ của các bên"
      subtitle="Quyền và nghĩa vụ của Sata Robo và của khách hàng khi giao dịch trên website"
      breadcrumbLabel="Quyền & nghĩa vụ các bên"
    />
  );
}
