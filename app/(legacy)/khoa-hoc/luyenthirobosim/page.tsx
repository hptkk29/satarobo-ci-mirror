import type { Metadata } from "next";
import LuyenThiRobosimClient from "./client-page";
import { getTestimonials } from "@/lib/testimonials";

const BASE_URL = "https://satarobo.vn";

// ISR: trang marketing tĩnh, regen mỗi 5' để pick up cảm nhận từ DB.
export const revalidate = 300; // ISR_DETAIL (convention list=60/detail=300, xem lib/isr.ts)

export const metadata: Metadata = {
  title:
    "Luyện thi RBT2026 — Giải Đề Vòng Loại Robotics trên RoboSim | R1 & R2",
  description:
    "Khoá luyện thi RBT2026 duy nhất cho con thực hành trên chính đề thi vòng loại. R1 cho lớp 3-5, R2 cho lớp 6-9. Luyện đến đâu — biết đến đó. Đăng ký ngay.",
  keywords:
    "luyện thi rbt2026, robosim, khoá r1, khoá r2, đề thi vòng loại robotics, sáng tạo robotics toàn quốc, lập trình robot tiểu học, lập trình robot thcs",
  alternates: { canonical: `${BASE_URL}/khoa-hoc/luyenthirobosim` },
  openGraph: {
    title: "Luyện thi RBT2026 — Giải Đề Vòng Loại trên RoboSim",
    description:
      "R1 cho Tiểu học. R2 cho THCS. Học bằng chính đề thi vòng loại RBT2026.",
    url: `${BASE_URL}/khoa-hoc/luyenthirobosim`,
    siteName: "Sata Robo",
    type: "website",
    locale: "vi_VN",
  },
};

export default async function LuyenThiRobosimPage() {
  const rows = await getTestimonials("luyenthirobosim");
  const testimonials = rows.length
    ? rows.map((r, i) => ({
        id: `t${i + 1}`,
        initials: r.avatar,
        name: r.name,
        role: r.role,
        quote: `"${r.content}"`,
        videoId: r.videoId ?? "",
        avatarBg: r.avatarColor,
      }))
    : undefined;
  return <LuyenThiRobosimClient testimonials={testimonials} />;
}
